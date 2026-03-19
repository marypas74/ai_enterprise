import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findOne, insertOne } from '../../database/index.js';
import { convertPdfToHtml, convertHtmlToPdf } from './pdfEditorService.js';
import fs from 'fs/promises';
import path from 'path';

interface AttachmentRow {
  id: number;
  conversation_id: number;
  user_id: number;
  file_name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  content_type: string;
  processing_status: string;
  conv_user_id: number;
}

const convertSchema = z.object({
  attachmentId: z.number().int().positive(),
});

const saveSchema = z.object({
  attachmentId: z.number().int().positive(),
  html: z.string().min(1),
  filename: z.string().optional(),
});

export async function pdfEditorRoutes(fastify: FastifyInstance) {

  // POST /tools/pdf-editor/convert
  fastify.post('/tools/pdf-editor/convert', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const body = convertSchema.parse(request.body);

    const attachment = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [body.attachmentId, userId, userId]
    );

    if (!attachment) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }
    if (attachment.mime_type !== 'application/pdf') {
      return reply.status(400).send({ error: 'Il file non e un PDF' });
    }

    const stat = await fs.stat(attachment.file_path).catch(() => null);
    if (!stat) {
      return reply.status(404).send({ error: 'File non trovato su disco' });
    }
    if (stat.size > 50 * 1024 * 1024) {
      return reply.status(413).send({ error: 'Il file e troppo grande (max 50MB)' });
    }

    try {
      const { html, tempDir } = await convertPdfToHtml(attachment.file_path, userId);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return { html, filename: attachment.original_name };
    } catch (error: unknown) {
      const status = (error instanceof Error && (error as Error & { statusCode?: number }).statusCode) || 500;
      const message = error instanceof Error ? error.message : 'Errore di conversione';
      return reply.status(status).send({ error: message });
    }
  });

  // POST /tools/pdf-editor/save
  fastify.post('/tools/pdf-editor/save', {
    onRequest: [(fastify as any).authenticate],
    bodyLimit: 100 * 1024 * 1024,
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const body = saveSchema.parse(request.body);

    const original = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [body.attachmentId, userId, userId]
    );

    if (!original) {
      return reply.status(404).send({ error: 'Allegato originale non trovato' });
    }

    try {
      // Sanitize HTML: strip script tags and event handlers to prevent XSS
      const sanitizedHtml = body.html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');

      const { pdfBuffer, tempDir } = await convertHtmlToPdf(sanitizedHtml, userId);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

      const baseName = body.filename
        ? path.basename(body.filename, '.pdf')
        : path.basename(original.original_name, '.pdf');
      const newFileName = `${baseName}_edited_${Date.now()}.pdf`;
      const dir = path.dirname(original.file_path);
      const newFilePath = path.join(dir, newFileName);

      await fs.writeFile(newFilePath, pdfBuffer);

      const newId = await insertOne(
        fastify.db,
        `INSERT INTO chat_attachments
         (conversation_id, user_id, file_name, original_name, file_path, file_size, mime_type, content_type, processing_status)
         VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', 'document', 'completed')`,
        [original.conversation_id, userId, newFileName, `${baseName}_edited.pdf`, newFilePath, pdfBuffer.length]
      );

      fastify.log.info(`[PDFEditor] Saved edited PDF: ${newFileName} (${pdfBuffer.length} bytes)`);

      return { attachmentId: newId, filename: `${baseName}_edited.pdf`, size: pdfBuffer.length };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore di salvataggio';
      return reply.status(500).send({ error: message });
    }
  });
}
