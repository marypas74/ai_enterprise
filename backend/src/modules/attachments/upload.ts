/**
 * Attachment Upload Routes
 * Handles file upload, retrieval, listing, deletion, context, supported types, conversion, and search
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, findMany, insertOne } from '../../database/index.js';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { convertTextToDocx, convertPdfToDocx } from '../../services/DocumentProcessorService.js';
import { searchSimilar } from '../../services/VectorStoreService.js';
import { eventBus } from '../../services/EventBusService.js';
import { queueAttachmentProcessing } from './processing.js';
import type { AttachmentConfig, ChatAttachment } from './types.js';

// Validation schemas
const attachmentContextSchema = z.object({
  attachmentIds: z.array(z.number()).min(1),
});

// Storage path for attachments
const ATTACHMENTS_ROOT = process.env.ATTACHMENTS_ROOT || '/app/attachments';

/**
 * Helper: Ensure attachments directory exists
 */
async function ensureAttachmentsDir(userId: number, conversationId: number): Promise<string> {
  const dir = path.join(ATTACHMENTS_ROOT, `user_${userId}`, `conv_${conversationId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Helper: Generate unique filename
 */
function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const hash = crypto.randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return `${base}_${timestamp}_${hash}${ext}`;
}

/**
 * Register upload-related attachment routes
 */
export async function registerUploadRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Upload attachments for a conversation
   * POST /api/attachments/upload
   */
  fastify.post('/upload', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Upload file attachments for chat conversation',
      tags: ['attachments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;

      // Parse multipart form data
      const parts = request.parts();
      let conversationId: number | null = null;
      const uploadedFiles: any[] = [];

      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'conversationId') {
          conversationId = Number(part.value);
        } else if (part.type === 'file') {
          // SECURITY: Stream file directly to disk to prevent memory exhaustion
          // (previously buffered entire file in memory — up to 500MB with 10 files)
          const tempName = `_upload_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${path.extname(part.filename || '')}`;
          const tempPath = path.join(ATTACHMENTS_ROOT, tempName);
          await fs.mkdir(ATTACHMENTS_ROOT, { recursive: true });
          const writeStream = createWriteStream(tempPath);
          await pipeline(part.file, writeStream);
          const stat = await fs.stat(tempPath);

          uploadedFiles.push({
            fieldname: part.fieldname,
            filename: part.filename,
            mimetype: part.mimetype,
            tempPath,
            size: stat.size,
          });
        }
      }

      if (uploadedFiles.length === 0) {
        return reply.status(400).send({ error: 'No files uploaded' });
      }

      // conversationId is optional - allow uploads before conversation is created
      if (conversationId) {
        const conversation = await findOne<{ id: number; user_id: number }>(
          fastify.db,
          'SELECT id, user_id FROM conversations WHERE id = ?',
          [conversationId]
        );

        if (!conversation || conversation.user_id !== userId) {
          return reply.status(403).send({ error: 'Conversation not found or access denied' });
        }
      }

      // Load allowed file types
      const allowedTypes = await findAll<AttachmentConfig>(
        fastify.db,
        'SELECT * FROM attachment_config WHERE is_enabled = TRUE'
      );
      const allowedMimeTypes = new Map(allowedTypes.map(t => [t.mime_type, t]));

      // Process each file
      const attachments: any[] = [];
      const dir = await ensureAttachmentsDir(userId, conversationId || 0);

      for (const file of uploadedFiles) {
        // Check if mime type is allowed
        const config = allowedMimeTypes.get(file.mimetype);
        if (!config) {
          fastify.log.warn(`[Attachments] Rejected file type: ${file.mimetype}`);
          continue; // Skip unsupported file types
        }

        // Check file size (now from disk stat, not buffer)
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > config.max_size_mb) {
          fastify.log.warn(`[Attachments] File too large: ${fileSizeMB}MB > ${config.max_size_mb}MB`);
          await fs.unlink(file.tempPath).catch(() => {});
          continue;
        }

        // Move temp file to final destination
        const uniqueName = generateUniqueFilename(file.filename);
        const filePath = path.join(dir, uniqueName);
        await fs.rename(file.tempPath, filePath);

        // Insert into database
        const insertedId = await insertOne(
          fastify.db,
          `INSERT INTO chat_attachments
           (conversation_id, user_id, file_name, original_name, file_path, file_size, mime_type, content_type, processing_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [conversationId, userId, uniqueName, file.filename, filePath, file.size, file.mimetype, config.content_type]
        );

        attachments.push({
          id: insertedId,
          fileName: uniqueName,
          originalName: file.filename,
          mimeType: file.mimetype,
          contentType: config.content_type,
          size: file.size,
          status: 'pending',
        });

        fastify.log.info(`[Attachments] Uploaded: ${file.filename} -> ${filePath}`);

        // Hook: on_document_upload
        eventBus.emit('on_document_upload', {
          attachmentId: insertedId, originalName: file.filename, mimeType: file.mimetype,
          contentType: config.content_type, size: file.size, userId,
        }, { userId }).catch(() => {});

        // Queue for processing (async)
        queueAttachmentProcessing(fastify, insertedId, config.processor);
      }

      return {
        success: true,
        attachments,
        count: attachments.length,
      };
    } catch (error: any) {
      fastify.log.error(`[Attachments] Upload error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get attachment status
   * GET /api/attachments/:id
   */
  fastify.get('/:id', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const attachmentId = Number(request.params.id);

      const attachment = await findOne<ChatAttachment>(
        fastify.db,
        'SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?',
        [attachmentId, userId]
      );

      if (!attachment) {
        return reply.status(404).send({ error: 'Attachment not found' });
      }

      return {
        success: true,
        attachment: {
          id: attachment.id,
          conversationId: attachment.conversation_id,
          fileName: attachment.file_name,
          originalName: attachment.original_name,
          mimeType: attachment.mime_type,
          contentType: attachment.content_type,
          size: attachment.file_size,
          status: attachment.processing_status,
          processedContent: attachment.processed_content,
          error: attachment.processing_error,
          createdAt: attachment.created_at,
          processedAt: attachment.processed_at,
        },
      };
    } catch (error: any) {
      fastify.log.error(`[Attachments] Get error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get all attachments for a conversation
   * GET /api/attachments/conversation/:conversationId
   */
  fastify.get('/conversation/:conversationId', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const conversationId = Number(request.params.conversationId);

      // Verify conversation access
      const conversation = await findOne<{ user_id: number }>(
        fastify.db,
        'SELECT user_id FROM conversations WHERE id = ?',
        [conversationId]
      );

      if (!conversation || conversation.user_id !== userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const attachments = await findAll<ChatAttachment>(
        fastify.db,
        'SELECT * FROM chat_attachments WHERE conversation_id = ? ORDER BY created_at DESC',
        [conversationId]
      );

      return {
        success: true,
        attachments: attachments.map(a => ({
          id: a.id,
          fileName: a.file_name,
          originalName: a.original_name,
          mimeType: a.mime_type,
          contentType: a.content_type,
          size: a.file_size,
          status: a.processing_status,
          hasContent: !!a.processed_content,
          createdAt: a.created_at,
        })),
        count: attachments.length,
      };
    } catch (error: any) {
      fastify.log.error(`[Attachments] List error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Delete an attachment
   * DELETE /api/attachments/:id
   */
  fastify.delete('/:id', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const attachmentId = Number(request.params.id);

      const attachment = await findOne<ChatAttachment>(
        fastify.db,
        'SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?',
        [attachmentId, userId]
      );

      if (!attachment) {
        return reply.status(404).send({ error: 'Attachment not found' });
      }

      // Delete file
      try {
        await fs.unlink(attachment.file_path);
      } catch (e) {
        fastify.log.warn(`[Attachments] Could not delete file: ${attachment.file_path}`);
      }

      // Delete from database
      await fastify.db.execute('DELETE FROM chat_attachments WHERE id = ?', [attachmentId]);

      fastify.log.info(`[Attachments] Deleted: ${attachment.original_name}`);

      return { success: true };
    } catch (error: any) {
      fastify.log.error(`[Attachments] Delete error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get processed content for message context
   * POST /api/attachments/context
   */
  fastify.post('/context', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const { attachmentIds } = attachmentContextSchema.parse(request.body);

      // Wait for processing to complete (up to 30 seconds)
      const placeholders = attachmentIds.map(() => '?').join(',');
      let attachments: ChatAttachment[] = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        attachments = await findAll<ChatAttachment>(
          fastify.db,
          `SELECT id, original_name, content_type, processing_status, processed_content
           FROM chat_attachments
           WHERE id IN (${placeholders}) AND user_id = ?`,
          [...attachmentIds, userId]
        );
        const allDone = attachments.every(a => a.processing_status === 'completed' || a.processing_status === 'failed');
        if (allDone || attachments.length === 0) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      // Filter to completed only
      attachments = attachments.filter(a => a.processing_status === 'completed');

      // Build context string for AI
      const contextParts = attachments
        .filter(a => a.processed_content)
        .map(a => {
          return `[Allegato: ${a.original_name} (${a.content_type})]\n${a.processed_content}\n[Fine allegato]`;
        });

      return {
        success: true,
        context: contextParts.join('\n\n'),
        processedCount: attachments.length,
        totalCount: attachmentIds.length,
      };
    } catch (error: any) {
      fastify.log.error(`[Attachments] Context error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get supported file types
   * GET /api/attachments/supported-types
   */
  fastify.get('/supported-types', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const types = await findAll<AttachmentConfig>(
        fastify.db,
        'SELECT mime_type, content_type, max_size_mb FROM attachment_config WHERE is_enabled = TRUE'
      );

      // Group by content type
      const grouped: Record<string, any[]> = {};
      for (const t of types) {
        if (!grouped[t.content_type]) {
          grouped[t.content_type] = [];
        }
        grouped[t.content_type].push({
          mimeType: t.mime_type,
          maxSizeMB: t.max_size_mb,
        });
      }

      return {
        success: true,
        types: grouped,
        acceptedMimeTypes: types.map(t => t.mime_type),
      };
    } catch (error: any) {
      fastify.log.error(`[Attachments] Types error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Convert a processed attachment to DOCX
   * POST /api/attachments/:id/convert
   */
  fastify.post('/:id/convert', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const attachmentId = Number(request.params.id);

      const attachment = await findOne<ChatAttachment>(
        fastify.db,
        'SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?',
        [attachmentId, userId]
      );

      if (!attachment) {
        return reply.status(404).send({ error: 'Attachment not found' });
      }

      if (!attachment.processed_content || attachment.processing_status !== 'completed') {
        return reply.status(400).send({ error: 'Attachment not yet processed or processing failed' });
      }

      const outputDir = path.dirname(attachment.file_path);
      const baseName = path.basename(attachment.original_name, path.extname(attachment.original_name));
      const isPdf = attachment.mime_type === 'application/pdf' ||
        attachment.original_name?.toLowerCase().endsWith('.pdf');

      let docxBuffer: Buffer;

      if (isPdf) {
        // PDF→DOCX: smart conversion with structure preservation
        const { convertPdfToDocxSmart, convertPdfToDocxOcr } = await import('../../services/document-processing/PDFConversionService.js');
        const pdfBuffer = await fs.readFile(attachment.file_path);

        try {
          docxBuffer = await convertPdfToDocxSmart(pdfBuffer, baseName);
          fastify.log.info(`[Attachments] PDF→DOCX smart: ${attachment.original_name}`);
        } catch (smartErr) {
          fastify.log.warn(`[Attachments] Smart conversion failed, falling back to OCR: ${smartErr}`);
          docxBuffer = await convertPdfToDocxOcr(pdfBuffer, baseName);
          fastify.log.info(`[Attachments] PDF→DOCX OCR fallback: ${attachment.original_name}`);
        }
      } else {
        // Non-PDF: generate DOCX from extracted text
        const docxPath = path.join(outputDir, `${baseName}_converted.docx`);
        await convertTextToDocx(
          attachment.processed_content,
          docxPath,
          attachment.original_name
        );
        docxBuffer = await fs.readFile(docxPath);
        fastify.log.info(`[Attachments] Text→DOCX: ${attachment.original_name}`);
      }

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      reply.header('Content-Disposition', `attachment; filename="${baseName}_converted.docx"`);
      return reply.send(docxBuffer);
    } catch (error: any) {
      fastify.log.error(`[Attachments] Convert error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * RAG Search across attachments
   * POST /api/attachments/search
   */
  fastify.post('/search', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest<{ Body: { query: string; attachmentIds?: number[]; limit?: number } }>, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const { query, attachmentIds, limit = 5 } = request.body;

      if (!query || query.trim().length === 0) {
        return reply.status(400).send({ error: 'Query is required' });
      }

      // First try semantic search (Layer 3)
      let results = await searchSimilar(fastify.db, query, {
        attachmentIds,
        limit,
        scoreThreshold: 0.3,
      });

      let method = 'semantic';

      // If no vector results, fall back to full-text search (Layer 2)
      if (results.length === 0) {
        method = 'fulltext';
        const ftResults = await findMany<{ attachment_id: number; content: string; chunk_index: number; metadata: string }>(
          fastify.db,
          `SELECT dc.attachment_id, dc.content, dc.chunk_index, dc.metadata
           FROM document_chunks dc
           JOIN chat_attachments ca ON dc.attachment_id = ca.id
           WHERE ca.user_id = ? AND MATCH(dc.content) AGAINST(? IN NATURAL LANGUAGE MODE)
           LIMIT ?`,
          [userId, query, limit]
        );

        results = ftResults.map((r, i) => ({
          chunkId: i,
          attachmentId: r.attachment_id,
          content: r.content,
          score: 1.0,
          metadata: JSON.parse(r.metadata || '{}'),
        }));
      }

      return reply.send({
        query,
        results,
        count: results.length,
        method,
      });
    } catch (error: any) {
      fastify.log.error(`[Attachments] Search error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });
}
