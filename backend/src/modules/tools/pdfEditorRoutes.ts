import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { findOne, insertOne } from '../../database/index.js';
import { convertPdfToHtml, convertHtmlToPdf } from './pdfEditorService.js';
import fs from 'fs/promises';
import path from 'path';
import * as mupdf from 'mupdf';

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
    config: { requestTimeout: 20 * 60 * 1000 }, // 20 min — Vision OCR processes pages sequentially
  }, async (request, reply) => {
    // Extend connection timeout for long OCR processing
    request.raw.socket.setTimeout(20 * 60 * 1000);
    const userId = (request as any).user.id;
    const parsed = convertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const body = parsed.data;

    const attachment = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       LEFT JOIN conversations c ON a.conversation_id = c.id
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
      const { html, tempDir, method } = await convertPdfToHtml(attachment.file_path, userId);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return { html, filename: attachment.original_name, method };
    } catch (error: unknown) {
      const status = (error instanceof Error && (error as Error & { statusCode?: number }).statusCode) || 500;
      const message = error instanceof Error ? error.message : 'Errore di conversione';
      fastify.log.error(`[PDFEditor] Convert failed (${status}): ${message}`);
      return reply.status(status).send({ error: message });
    }
  });

  // POST /tools/pdf-editor/save
  fastify.post('/tools/pdf-editor/save', {
    onRequest: [(fastify as any).authenticate],
    bodyLimit: 100 * 1024 * 1024,
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const body = parsed.data;

    const original = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       LEFT JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [body.attachmentId, userId, userId]
    );

    if (!original) {
      return reply.status(404).send({ error: 'Allegato originale non trovato' });
    }

    try {
      // Sanitize HTML using sanitize-html library (regex-based approaches are bypassable)
      const sanitizedHtml = sanitizeHtml(body.html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'sup', 'sub', 'u', 's']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          '*': ['style', 'class', 'id'],
          img: ['src', 'alt', 'width', 'height'],
          td: ['colspan', 'rowspan'],
          th: ['colspan', 'rowspan'],
        },
        allowedSchemes: ['data', 'https', 'http'],
      });

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

  // GET /tools/pdf-info/:attachmentId — returns page count for inline PDF viewer
  fastify.get('/tools/pdf-info/:attachmentId', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const { attachmentId } = request.params as { attachmentId: string };
    const id = parseInt(attachmentId, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid attachment ID' });

    const attachment = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       LEFT JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [id, userId, userId]
    );
    if (!attachment) return reply.status(404).send({ error: 'Allegato non trovato' });
    if (attachment.mime_type !== 'application/pdf') return reply.status(400).send({ error: 'Non è un PDF' });

    try {
      const pdfData = await fs.readFile(attachment.file_path);
      const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
      const totalPages = doc.countPages();
      return { totalPages };
    } catch (err: any) {
      fastify.log.error(`[PDFEditor] pdf-info error: ${err.message}`);
      return reply.status(500).send({ error: 'Errore lettura PDF' });
    }
  });

  // GET /tools/pdf-page/:attachmentId/:page — renders a PDF page as PNG for inline viewer
  fastify.get('/tools/pdf-page/:attachmentId/:page', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const params = request.params as { attachmentId: string; page: string };
    const id = parseInt(params.attachmentId, 10);
    const pageNum = parseInt(params.page, 10);
    if (isNaN(id) || isNaN(pageNum)) return reply.status(400).send({ error: 'Invalid parameters' });

    const zoom = parseFloat((request.query as { zoom?: string }).zoom || '1');

    const attachment = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       LEFT JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [id, userId, userId]
    );
    if (!attachment) return reply.status(404).send({ error: 'Allegato non trovato' });
    if (attachment.mime_type !== 'application/pdf') return reply.status(400).send({ error: 'Non è un PDF' });

    try {
      const pdfData = await fs.readFile(attachment.file_path);
      const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
      const totalPages = doc.countPages();
      if (pageNum < 1 || pageNum > totalPages) {
        return reply.status(400).send({ error: `Pagina ${pageNum} fuori range (1-${totalPages})` });
      }

      const page = doc.loadPage(pageNum - 1);
      const scaledZoom = 2 * zoom; // 2x base for good quality
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scaledZoom, scaledZoom), mupdf.ColorSpace.DeviceRGB, false, true);
      const pngBuffer = pixmap.asPNG();

      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.send(Buffer.from(pngBuffer));
    } catch (err: any) {
      fastify.log.error(`[PDFEditor] pdf-page error: ${err.message}`);
      return reply.status(500).send({ error: 'Errore rendering pagina PDF' });
    }
  });
}
