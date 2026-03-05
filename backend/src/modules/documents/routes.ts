/**
 * Documents Module — User Document Management with RAG Indexing
 *
 * Manages user-uploaded documents (PDF, DOCX, TXT) indexed into
 * Qdrant's declarative_memory collection via RabbitHoleService.
 *
 * Routes:
 *   POST /api/documents/upload  — Upload & index a document
 *   GET  /api/documents         — List user's documents
 *   GET  /api/documents/:id     — Get single document status
 *   DELETE /api/documents/:id   — Delete document + remove from Qdrant
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { RabbitHoleService } from '../../services/RabbitHoleService.js';

// Storage root for user documents (separate from chat attachments)
const DOCUMENTS_ROOT = process.env.DOCUMENTS_ROOT || process.env.ATTACHMENTS_ROOT || '/app/attachments';

// Allowed MIME types for document uploads
const ALLOWED_MIME_TYPES: Record<string, true> = {
    'application/pdf': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
    'application/msword': true,
    'text/plain': true,
    'text/markdown': true,
};

const MAX_FILE_SIZE_MB = 50;

// ---- DB Migration ----

export async function migrateUserDocumentsTable(db: any): Promise<void> {
    await db.execute(`
    CREATE TABLE IF NOT EXISTS user_documents (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      user_id       INT NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_name     VARCHAR(255) NOT NULL,
      file_path     VARCHAR(512) NOT NULL,
      mime_type     VARCHAR(100) NOT NULL,
      file_size     INT NOT NULL DEFAULT 0,
      status        ENUM('processing','ready','failed') DEFAULT 'processing',
      error         TEXT,
      qdrant_source VARCHAR(512),
      chunks_count  INT DEFAULT 0,
      created_at    DATETIME DEFAULT NOW(),
      INDEX idx_user_documents_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ---- Routes ----

export async function documentRoutes(fastify: FastifyInstance): Promise<void> {
    // Auto-migrate on first registration
    try {
        await migrateUserDocumentsTable(fastify.db);
        fastify.log.info('[Documents] user_documents table ready');
    } catch (err: any) {
        fastify.log.warn(`[Documents] Migration warning: ${err.message}`);
    }

    /**
     * Upload a document and index it into Qdrant
     * POST /api/documents/upload
     */
    fastify.post('/upload', {
        onRequest: [(fastify as any).authenticate],
        schema: {
            description: 'Upload a document and index it into vector memory for RAG',
            tags: ['documents'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).id;

        try {
            const parts = request.parts();
            let uploadedFile: { filename: string; mimetype: string; buffer: Buffer } | null = null;

            for await (const part of parts) {
                if (part.type === 'file') {
                    const chunks: Buffer[] = [];
                    for await (const chunk of part.file) {
                        chunks.push(chunk);
                    }
                    uploadedFile = {
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(chunks),
                    };
                    break;
                }
            }

            if (!uploadedFile) {
                return reply.status(400).send({ error: 'No file uploaded' });
            }

            // Validate mime type
            if (!ALLOWED_MIME_TYPES[uploadedFile.mimetype]) {
                return reply.status(400).send({
                    error: `Unsupported file type: ${uploadedFile.mimetype}. Allowed: PDF, DOCX, TXT`,
                });
            }

            // Validate file size
            const fileSizeMB = uploadedFile.buffer.length / (1024 * 1024);
            if (fileSizeMB > MAX_FILE_SIZE_MB) {
                return reply.status(400).send({
                    error: `File too large (${fileSizeMB.toFixed(1)}MB). Max: ${MAX_FILE_SIZE_MB}MB`,
                });
            }

            // Save file to disk
            const docDir = path.join(DOCUMENTS_ROOT, 'user_documents', `user_${userId}`);
            await fs.mkdir(docDir, { recursive: true });

            const ext = path.extname(uploadedFile.filename);
            const base = path.basename(uploadedFile.filename, ext);
            const uniqueName = `${base}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
            const filePath = path.join(docDir, uniqueName);
            await fs.writeFile(filePath, uploadedFile.buffer);

            // Insert document record as 'processing'
            const docId = await insertOne(
                fastify.db,
                `INSERT INTO user_documents (user_id, original_name, file_name, file_path, mime_type, file_size, status, qdrant_source)
         VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)`,
                [userId, uploadedFile.filename, uniqueName, filePath, uploadedFile.mimetype,
                    uploadedFile.buffer.length, `doc:${0}`]
            );

            // Update qdrant_source with actual id
            const qdrantSource = `doc:${docId}`;
            await updateOne(
                fastify.db,
                'UPDATE user_documents SET qdrant_source = ? WHERE id = ?',
                [qdrantSource, docId]
            );

            fastify.log.info(`[Documents] User ${userId} uploaded: ${uploadedFile.filename} -> ${qdrantSource}`);

            // Respond immediately so the client gets the document ID right away
            reply.send({
                success: true,
                document: {
                    id: docId,
                    originalName: uploadedFile.filename,
                    mimeType: uploadedFile.mimetype,
                    size: uploadedFile.buffer.length,
                    status: 'processing',
                },
            });

            // ---- Background indexing (after reply is sent) ----
            const capturedFile = uploadedFile;
            setImmediate(async () => {
                try {
                    let textContent = '';
                    const mime = capturedFile.mimetype;

                    if (mime === 'text/plain' || mime === 'text/markdown') {
                        textContent = capturedFile.buffer.toString('utf-8');
                    } else if (mime === 'application/pdf') {
                        const { extractPdfText } = await import('../attachments/processing.js');
                        textContent = await extractPdfText(capturedFile.buffer);
                    } else {
                        // DOCX / DOC
                        const { extractOfficeContent } = await import('../../services/DocumentProcessorService.js');
                        textContent = await extractOfficeContent(capturedFile.buffer, mime);
                    }

                    if (!textContent || textContent.trim().length === 0) {
                        throw new Error('Could not extract text content from file');
                    }

                    // Index into Qdrant via RabbitHoleService
                    const rabbitHole = new RabbitHoleService(fastify, fastify.db);
                    const result = await rabbitHole.ingest(textContent, capturedFile.filename, {
                        userId,
                        source: qdrantSource,
                        sourceType: 'file',
                        contentType: mime,
                        metadata: {
                            document_id: docId,
                            original_name: capturedFile.filename,
                            source_type: 'user_document',
                        },
                    });

                    await updateOne(
                        fastify.db,
                        'UPDATE user_documents SET status = ?, chunks_count = ? WHERE id = ?',
                        [result.status === 'completed' ? 'ready' : 'failed', result.chunksCount, docId]
                    );

                    fastify.log.info(`[Documents] Indexed ${qdrantSource} — ${result.chunksCount} chunks`);
                } catch (indexErr: any) {
                    fastify.log.error(`[Documents] Indexing failed for ${qdrantSource}: ${indexErr.message}`);
                    await updateOne(
                        fastify.db,
                        "UPDATE user_documents SET status = 'failed', error = ? WHERE id = ?",
                        [indexErr.message, docId]
                    );
                }
            });

        } catch (error: any) {
            fastify.log.error(`[Documents] Upload error: ${error.message}`);
            return reply.status(500).send({ error: error.message });
        }
    });

    /**
     * List user's documents
     * GET /api/documents
     */
    fastify.get('/', {
        onRequest: [(fastify as any).authenticate],
        schema: {
            description: 'List all documents uploaded by the user',
            tags: ['documents'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).id;
        const query = request.query as { limit?: string; offset?: string };
        const limit = Math.min(parseInt(query.limit || '50') || 50, 100);
        const offset = parseInt(query.offset || '0') || 0;

        try {
            const documents = await findMany<any>(
                fastify.db,
                `SELECT id, original_name, mime_type, file_size, status, error, chunks_count, created_at
         FROM user_documents
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
                [userId, limit, offset]
            );

            return {
                success: true,
                documents: documents.map((d: any) => ({
                    id: d.id,
                    originalName: d.original_name,
                    mimeType: d.mime_type,
                    size: d.file_size,
                    status: d.status,
                    error: d.error,
                    chunksCount: d.chunks_count,
                    createdAt: d.created_at,
                })),
                count: documents.length,
            };
        } catch (error: any) {
            fastify.log.error(`[Documents] List error: ${error.message}`);
            return reply.status(500).send({ error: error.message });
        }
    });

    /**
     * Get a single document's status
     * GET /api/documents/:id
     */
    fastify.get('/:id', {
        onRequest: [(fastify as any).authenticate],
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const userId = (request.user as any).id;
        const docId = Number(request.params.id);

        try {
            const doc = await findOne<any>(
                fastify.db,
                'SELECT id, original_name, mime_type, file_size, status, error, chunks_count, created_at FROM user_documents WHERE id = ? AND user_id = ?',
                [docId, userId]
            );

            if (!doc) {
                return reply.status(404).send({ error: 'Document not found' });
            }

            return {
                success: true,
                document: {
                    id: doc.id,
                    originalName: doc.original_name,
                    mimeType: doc.mime_type,
                    size: doc.file_size,
                    status: doc.status,
                    error: doc.error,
                    chunksCount: doc.chunks_count,
                    createdAt: doc.created_at,
                },
            };
        } catch (error: any) {
            return reply.status(500).send({ error: error.message });
        }
    });

    /**
     * Delete a document and remove its vectors from Qdrant
     * DELETE /api/documents/:id
     */
    fastify.delete('/:id', {
        onRequest: [(fastify as any).authenticate],
        schema: {
            description: 'Delete a document and remove its vectors from Qdrant',
            tags: ['documents'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const userId = (request.user as any).id;
        const docId = Number(request.params.id);

        try {
            const doc = await findOne<any>(
                fastify.db,
                'SELECT id, file_path, qdrant_source FROM user_documents WHERE id = ? AND user_id = ?',
                [docId, userId]
            );

            if (!doc) {
                return reply.status(404).send({ error: 'Document not found' });
            }

            // Remove vectors from Qdrant declarative_memory, filtered by source + user_id
            try {
                const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
                const qdrantRes = await fetch(`${QDRANT_URL}/collections/declarative_memory/points/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filter: {
                            must: [
                                { key: 'payload.source', match: { value: doc.qdrant_source } },
                                { key: 'payload.user_id', match: { value: userId } },
                            ],
                        },
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                fastify.log.info(`[Documents] Qdrant cleanup for ${doc.qdrant_source}: ${qdrantRes.status}`);
            } catch (qdrantErr: any) {
                fastify.log.warn(`[Documents] Qdrant cleanup warning: ${qdrantErr.message}`);
            }

            // Delete physical file
            try {
                await fs.unlink(doc.file_path);
            } catch {
                fastify.log.warn(`[Documents] Could not delete file: ${doc.file_path}`);
            }

            // Remove from DB
            await fastify.db.execute('DELETE FROM user_documents WHERE id = ?', [docId]);

            fastify.log.info(`[Documents] Deleted doc:${docId} for user ${userId}`);

            return { success: true };
        } catch (error: any) {
            fastify.log.error(`[Documents] Delete error: ${error.message}`);
            return reply.status(500).send({ error: error.message });
        }
    });
}
