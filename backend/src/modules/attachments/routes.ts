/**
 * Chat Attachments API
 * Handles file uploads for chat conversations with pre-processing worker
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, findMany, insertOne, updateOne } from '../../database/index.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import * as pdfUrl from 'pdf-parse';
import {
  extractWithOCR,
  extractPdfWithOCR,
  extractOfficeContent,
  extractExcelContent,
  convertTextToDocx
} from '../../services/DocumentProcessorService.js';
import { chunkDocument } from '../../services/ChunkingService.js';
import { indexChunks } from '../../services/VectorStoreService.js';
import { searchSimilar } from '../../services/VectorStoreService.js';

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Handle both ES module default export and CommonJS export
  const parse = (pdfUrl as any).default || pdfUrl;
  const data = await parse(buffer);
  return data.text || '';
}

// Storage path for attachments
const ATTACHMENTS_ROOT = process.env.ATTACHMENTS_ROOT || '/app/attachments';

// Schemas
const uploadSchema = z.object({
  conversationId: z.number(),
});

const processSchema = z.object({
  attachmentId: z.number(),
});

// Types
interface AttachmentConfig {
  mime_type: string;
  content_type: string;
  max_size_mb: number;
  processor: string;
  is_enabled: boolean;
}

interface ChatAttachment {
  id: number;
  conversation_id: number;
  message_id: number | null;
  user_id: number;
  file_name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  content_type: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_content: string | null;
  processing_error: string | null;
  created_at: Date;
  processed_at: Date | null;
}

// Helper: Ensure attachments directory exists
async function ensureAttachmentsDir(userId: number, conversationId: number): Promise<string> {
  const dir = path.join(ATTACHMENTS_ROOT, `user_${userId}`, `conv_${conversationId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Helper: Generate unique filename
function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const hash = crypto.randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return `${base}_${timestamp}_${hash}${ext}`;
}

// Helper: Detect content type from MIME
function detectContentType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('msword')) return 'document';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'data';
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('python') ||
    mimeType.includes('java') || mimeType.includes('json') || mimeType.includes('xml') ||
    mimeType.includes('yaml') || mimeType.includes('html') || mimeType.includes('css')) return 'code';
  if (mimeType.startsWith('text/')) return 'document';
  return 'other';
}

export async function attachmentRoutes(fastify: FastifyInstance) {
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
          // Get file buffer
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          uploadedFiles.push({
            fieldname: part.fieldname,
            filename: part.filename,
            mimetype: part.mimetype,
            buffer,
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

        // Check file size
        const fileSizeMB = file.buffer.length / (1024 * 1024);
        if (fileSizeMB > config.max_size_mb) {
          fastify.log.warn(`[Attachments] File too large: ${fileSizeMB}MB > ${config.max_size_mb}MB`);
          continue;
        }

        // Save file
        const uniqueName = generateUniqueFilename(file.filename);
        const filePath = path.join(dir, uniqueName);
        await fs.writeFile(filePath, file.buffer);

        // Insert into database
        const insertedId = await insertOne(
          fastify.db,
          `INSERT INTO chat_attachments
           (conversation_id, user_id, file_name, original_name, file_path, file_size, mime_type, content_type, processing_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [conversationId, userId, uniqueName, file.filename, filePath, file.buffer.length, file.mimetype, config.content_type]
        );

        attachments.push({
          id: insertedId,
          fileName: uniqueName,
          originalName: file.filename,
          mimeType: file.mimetype,
          contentType: config.content_type,
          size: file.buffer.length,
          status: 'pending',
        });

        fastify.log.info(`[Attachments] Uploaded: ${file.filename} -> ${filePath}`);

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
      const { attachmentIds } = request.body as { attachmentIds: number[] };

      if (!attachmentIds || !Array.isArray(attachmentIds)) {
        return reply.status(400).send({ error: 'attachmentIds array required' });
      }

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

      // Generate DOCX from processed content
      const outputDir = path.dirname(attachment.file_path);
      const baseName = path.basename(attachment.original_name, path.extname(attachment.original_name));
      const docxPath = path.join(outputDir, `${baseName}_converted.docx`);

      await convertTextToDocx(
        attachment.processed_content,
        docxPath,
        attachment.original_name
      );

      fastify.log.info(`[Attachments] Converted to DOCX: ${docxPath}`);

      // Send file as download
      const docxBuffer = await fs.readFile(docxPath);
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

/**
 * Queue attachment for async processing
 * This is a simplified in-process queue - for production use BullMQ with Redis
 */
async function queueAttachmentProcessing(fastify: FastifyInstance, attachmentId: number, processor: string) {
  // Process asynchronously
  setImmediate(async () => {
    try {
      // Mark as processing
      await updateOne(
        fastify.db,
        'UPDATE chat_attachments SET processing_status = ? WHERE id = ?',
        ['processing', attachmentId]
      );

      // Get attachment
      const attachment = await findOne<ChatAttachment>(
        fastify.db,
        'SELECT * FROM chat_attachments WHERE id = ?',
        [attachmentId]
      );

      if (!attachment) return;

      // Process based on type
      let content: string | null = null;

      switch (processor) {
        case 'text-read':
        case 'code-read':
          content = await fs.readFile(attachment.file_path, 'utf-8');
          // Limit content size for context
          if (content.length > 50000) {
            content = content.substring(0, 50000) + '\n... [contenuto troncato per dimensione]';
          }
          break;

        case 'json-parse':
          const jsonContent = await fs.readFile(attachment.file_path, 'utf-8');
          try {
            const parsed = JSON.parse(jsonContent);
            content = JSON.stringify(parsed, null, 2);
            if (content.length > 50000) {
              content = content.substring(0, 50000) + '\n... [JSON troncato]';
            }
          } catch {
            content = jsonContent.substring(0, 50000);
          }
          break;

        case 'csv-parse':
          const csvContent = await fs.readFile(attachment.file_path, 'utf-8');
          const lines = csvContent.split('\n').slice(0, 100); // First 100 rows
          content = lines.join('\n');
          if (csvContent.split('\n').length > 100) {
            content += '\n... [altre righe omesse]';
          }
          break;

        case 'image-ocr':
          // Real OCR via tesseract.js
          try {
            const imgBuffer = await fs.readFile(attachment.file_path);
            let ocrText = await extractWithOCR(imgBuffer);
            if (ocrText.length > 50000) {
              ocrText = ocrText.substring(0, 50000) + '\n... [testo OCR troncato per dimensione]';
            }
            content = ocrText.trim()
              ? `[OCR da immagine: ${attachment.original_name}]\n${ocrText}`
              : `[Immagine: ${attachment.original_name}] - Nessun testo rilevato dall'OCR.`;
          } catch (ocrError: any) {
            content = `[Immagine: ${attachment.original_name}] - Errore OCR: ${ocrError.message}`;
          }
          break;

        case 'pdf-extract':
          try {
            const pdfBuffer = await fs.readFile(attachment.file_path);
            let pdfText = await extractPdfText(pdfBuffer);

            // If pdf-parse returns empty text, fall back to OCR (scanned PDF)
            if (!pdfText.trim()) {
              fastify.log.info(`[Attachments] PDF text empty for ${attachment.original_name}, trying OCR...`);
              try {
                pdfText = await extractPdfWithOCR(pdfBuffer);
              } catch (ocrFallbackError: any) {
                fastify.log.warn(`[Attachments] OCR fallback failed: ${ocrFallbackError.message}`);
              }
            }

            if (pdfText.length > 50000) {
              pdfText = pdfText.substring(0, 50000) + '\n... [contenuto PDF troncato per dimensione]';
            }
            content = pdfText.trim()
              ? pdfText
              : `[Documento PDF: ${attachment.original_name}] - Il PDF non contiene testo estraibile.`;
          } catch (pdfError: any) {
            content = `[Documento PDF: ${attachment.original_name}] - Errore estrazione testo: ${pdfError.message}`;
          }
          break;

        case 'office-extract':
          try {
            const officeBuffer = await fs.readFile(attachment.file_path);
            let officeText = await extractOfficeContent(officeBuffer, attachment.mime_type);
            if (officeText.length > 50000) {
              officeText = officeText.substring(0, 50000) + '\n... [contenuto troncato per dimensione]';
            }
            content = officeText.trim()
              ? officeText
              : `[Documento Office: ${attachment.original_name}] - Nessun testo estraibile.`;
          } catch (officeError: any) {
            content = `[Documento Office: ${attachment.original_name}] - Errore estrazione: ${officeError.message}`;
          }
          break;

        case 'excel-extract':
          try {
            const xlsBuffer = await fs.readFile(attachment.file_path);
            let xlsText = await extractExcelContent(xlsBuffer);
            if (xlsText.length > 50000) {
              xlsText = xlsText.substring(0, 50000) + '\n... [dati Excel troncati per dimensione]';
            }
            content = xlsText.trim()
              ? xlsText
              : `[Excel: ${attachment.original_name}] - Nessun dato estraibile.`;
          } catch (xlsError: any) {
            content = `[Excel: ${attachment.original_name}] - Errore estrazione: ${xlsError.message}`;
          }
          break;

        case 'audio-transcribe':
          content = `[File audio: ${attachment.original_name}]\nDimensione: ${Math.round(attachment.file_size / 1024)} KB\n[Per trascrizione audio, integrare Whisper o servizio esterno]`;
          break;

        default:
          content = `[File: ${attachment.original_name}]\nTipo: ${attachment.mime_type}\nDimensione: ${Math.round(attachment.file_size / 1024)} KB`;
      }

      // Update with processed content
      await updateOne(
        fastify.db,
        'UPDATE chat_attachments SET processing_status = ?, processed_content = ?, processed_at = NOW() WHERE id = ?',
        ['completed', content, attachmentId]
      );

      // Chunk the document for smart retrieval (Layer 2)
      if (content && content.length > 100) {
        try {
          const chunks = chunkDocument(content, {
            chunkSize: 1000,
            overlap: 200,
            minChunkSize: 50
          });

          if (chunks.length > 0) {
            // Delete any previous chunks for this attachment
            await fastify.db.execute(
              'DELETE FROM document_chunks WHERE attachment_id = ?',
              [attachmentId]
            );

            // Insert chunks in batch
            for (const chunk of chunks) {
              await insertOne(
                fastify.db,
                'INSERT INTO document_chunks (attachment_id, chunk_index, content, char_count, metadata) VALUES (?, ?, ?, ?, ?)',
                [attachmentId, chunk.index, chunk.content, chunk.charCount, JSON.stringify(chunk.metadata)]
              );
            }

            fastify.log.info(`[Attachments] Chunked ${attachment.original_name}: ${chunks.length} chunks`);

            // Attempt vector indexing (Layer 3) — async, non-blocking
            indexChunks(fastify.db, attachmentId, chunks).then(indexed => {
              if (indexed) {
                fastify.log.info(`[Attachments] Vector indexed ${attachment.original_name}`);
              }
            }).catch(vecErr => {
              fastify.log.warn(`[Attachments] Vector indexing skipped/failed: ${vecErr.message}`);
            });
          }
        } catch (chunkError: any) {
          // Chunking failure should not prevent processing from completing
          fastify.log.warn(`[Attachments] Chunking failed for ${attachment.original_name}: ${chunkError.message}`);
        }
      }

      fastify.log.info(`[Attachments] Processed: ${attachment.original_name} with ${processor}`);

    } catch (error: any) {
      fastify.log.error(`[Attachments] Processing error: ${error.message}`);

      await updateOne(
        fastify.db,
        'UPDATE chat_attachments SET processing_status = ?, processing_error = ? WHERE id = ?',
        ['failed', error.message, attachmentId]
      );
    }
  });
}

export default attachmentRoutes;
