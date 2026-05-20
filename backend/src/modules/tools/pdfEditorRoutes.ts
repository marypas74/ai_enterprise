import { FastifyInstance } from 'fastify';
import { findOne } from '../../database/index.js';
import fs from 'fs/promises';
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

export async function pdfEditorRoutes(fastify: FastifyInstance) {

  // GET /tools/pdf-info/:attachmentId — returns page count for inline PDF viewer
  fastify.get('/tools/pdf-info/:attachmentId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      fastify.log.error(`[PDFEditor] pdf-info error: ${err.message}`);
      return reply.status(500).send({ error: 'Errore lettura PDF' });
    }
  });

  // GET /tools/pdf-page/:attachmentId/:page — renders a PDF page as PNG for inline viewer
  fastify.get('/tools/pdf-page/:attachmentId/:page', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      fastify.log.error(`[PDFEditor] pdf-page error: ${err.message}`);
      return reply.status(500).send({ error: 'Errore rendering pagina PDF' });
    }
  });
}
