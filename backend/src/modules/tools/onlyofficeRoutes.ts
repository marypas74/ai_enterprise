import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { findOne, insertOne } from '../../database/index.js';
import {
  initOnlyOfficeRedis,
  createSession,
  getSession,
  updateSessionSaved,
  buildEditorConfig,
  downloadEditedFile,
  convertDocxToPdf,
  verifyOnlyOfficeJwt,
  getPublicUrl,
  isConfigured,
} from './onlyofficeService.js';

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

const sessionSchema = z.object({
  attachmentId: z.number().int().positive(),
});

export async function onlyofficeRoutes(fastify: FastifyInstance) {

  // Initialize Redis for shared session storage across replicas
  initOnlyOfficeRedis(fastify.redis);

  // POST /tools/pdf-editor/onlyoffice-session — create editing session
  fastify.post('/tools/pdf-editor/onlyoffice-session', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    if (!isConfigured()) {
      return reply.status(503).send({ error: 'OnlyOffice non configurato' });
    }

    const userId = (request as any).user.id;
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }

    const attachment = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       LEFT JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [parsed.data.attachmentId, userId, userId]
    );

    if (!attachment) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }
    if (attachment.mime_type !== 'application/pdf') {
      return reply.status(400).send({ error: 'Il file non è un PDF' });
    }

    const stat = await fs.stat(attachment.file_path).catch(() => null);
    if (!stat) {
      return reply.status(404).send({ error: 'File non trovato su disco' });
    }
    if (stat.size > 50 * 1024 * 1024) {
      return reply.status(413).send({ error: 'Il file è troppo grande (max 50MB)' });
    }

    const session = await createSession(
      attachment.id,
      userId,
      attachment.file_path,
      attachment.original_name,
      attachment.conversation_id,
    );

    // Use internal K8s URL for callbacks (OnlyOffice -> backend within cluster)
    const backendInternalUrl = 'http://backend:3000';
    const editorConfig = buildEditorConfig(session, backendInternalUrl);

    return {
      editorConfig,
      publicUrl: getPublicUrl(),
      documentKey: session.documentKey,
    };
  });

  // GET /tools/pdf-editor/document/:documentKey — serve DOCX to OnlyOffice
  fastify.get('/tools/pdf-editor/document/:documentKey', async (request, reply) => {
    // Strip .docx extension if present (OnlyOffice needs URLs ending in .docx)
    const rawKey = (request.params as { documentKey: string }).documentKey;
    const documentKey = rawKey.replace(/\.docx$/, '');

    // Verify OnlyOffice JWT from Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      try {
        verifyOnlyOfficeJwt(token);
      } catch {
        return reply.status(401).send({ error: 'Invalid token' });
      }
    }

    const session = await getSession(documentKey);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const fileStat = await fs.stat(session.docxPath).catch(() => null);
    if (!fileStat) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const editableName = session.originalName.replace(/\.pdf$/i, '.docx');
    const fileBuffer = await fs.readFile(session.docxPath);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${editableName}"`)
      .header('Content-Length', fileStat.size)
      .send(fileBuffer);
  });

  // POST /tools/pdf-editor/onlyoffice-callback — receive save callback from OnlyOffice
  fastify.post('/tools/pdf-editor/onlyoffice-callback', {
    config: { requestTimeout: 120000 },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Verify JWT from body (JWT_IN_BODY=true in OnlyOffice config)
    if (body.token) {
      try {
        verifyOnlyOfficeJwt(body.token as string);
      } catch {
        return reply.status(401).send({ error: 1 });
      }
    }

    const status = body.status as number;
    const key = body.key as string;
    const url = body.url as string | undefined;

    console.log(`[OnlyOffice] Callback: key=${key}, status=${status}`);

    const session = await getSession(key);
    if (!session) {
      console.warn(`[OnlyOffice] Session not found for key: ${key}`);
      return { error: 0 };
    }

    // Status codes:
    // 1 = document being edited
    // 2 = document ready to save
    // 4 = document closed with no changes
    // 6 = document save error
    if (status === 2 && url) {
      try {
        console.log(`[OnlyOffice] Downloading edited DOCX from: ${url}`);
        const docxBuffer = await downloadEditedFile(url);

        const baseName = path.basename(session.originalName, '.pdf');
        const dir = path.dirname(session.filePath);

        // Save the edited DOCX to a temp file
        const tempDocxPath = path.join(dir, `${baseName}_edited_${Date.now()}.docx`);
        await fs.writeFile(tempDocxPath, docxBuffer);

        // Convert edited DOCX back to PDF using LibreOffice
        console.log(`[OnlyOffice] Converting edited DOCX to PDF...`);
        const pdfPath = await convertDocxToPdf(tempDocxPath, dir);

        // Read the generated PDF
        const pdfBuffer = await fs.readFile(pdfPath);

        // Clean up temp DOCX
        await fs.unlink(tempDocxPath).catch(() => {});

        // Rename the PDF to a proper filename
        const newFileName = `${baseName}_edited_${Date.now()}.pdf`;
        const newFilePath = path.join(dir, newFileName);
        await fs.rename(pdfPath, newFilePath);

        const newId = await insertOne(
          fastify.db,
          `INSERT INTO chat_attachments
           (conversation_id, user_id, file_name, original_name, file_path, file_size, mime_type, content_type, processing_status)
           VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', 'document', 'completed')`,
          [session.conversationId, session.userId, newFileName, `${baseName}_edited.pdf`, newFilePath, pdfBuffer.length]
        );

        await updateSessionSaved(key, newId, `${baseName}_edited.pdf`);
        console.log(`[OnlyOffice] Saved edited PDF: ${newFileName} (${pdfBuffer.length} bytes, attachmentId=${newId})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[OnlyOffice] Failed to save edited file: ${msg}`);
      }
    }

    // OnlyOffice expects { error: 0 } on success
    return { error: 0 };
  });

  // GET /tools/pdf-editor/onlyoffice-session/:documentKey/status — check save status
  fastify.get('/tools/pdf-editor/onlyoffice-session/:documentKey/status', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const { documentKey } = request.params as { documentKey: string };

    const session = await getSession(documentKey);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return {
      status: session.status,
      newAttachmentId: session.newAttachmentId,
      newFilename: session.newFilename,
    };
  });
}
