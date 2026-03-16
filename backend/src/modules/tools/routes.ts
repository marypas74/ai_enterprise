import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

/** Per-user rate limit config for document generation endpoints (CPU-intensive) */
const docGenRateLimit = {
    rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
            const user = (request as any).user;
            return user?.id ? `doc-gen:${user.id}` : (request.headers['cf-connecting-ip'] as string) || request.ip;
        }
    }
};
import { generateDocxBuffer, generateExcelBuffer, generatePptxBuffer, convertOfficeToPdf } from '../../services/DocumentProcessorService.js';
import { findOne, findMany } from '../../database/index.js';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const AI_DISCLOSURE_FOOTER = '\n\n---\n[Avviso AI Act] Documento generato tramite intelligenza artificiale — Enterprise AI Chat. Le informazioni contenute potrebbero non essere accurate. Verificare con fonti autorevoli.';

const generateDocxSchema = z.object({
    text: z.string().min(1),
    title: z.string().optional().default('Documento Generato')
});

const GENERATED_DIR = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');

// Ensure directory exists synchronously on load
if (!existsSync(GENERATED_DIR)) {
    mkdirSync(GENERATED_DIR, { recursive: true });
}

export async function toolsRoutes(fastify: FastifyInstance) {
    // POST: Generate and save file
    fastify.post('/tools/generate-docx', {
        onRequest: [(fastify as any).authenticate],
        config: docGenRateLimit,
        schema: {
            tags: ['Tools'],
            description: 'Generate a DOCX file from text content',
            body: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                    title: { type: 'string' }
                },
                required: ['text']
            }
        }
    }, async (request, reply) => {
        try {
            const { text, title } = generateDocxSchema.parse(request.body);

            // AI Act Art. 50.2: mark AI-generated content
            const textWithDisclosure = text + AI_DISCLOSURE_FOOTER;
            const buffer = await generateDocxBuffer(textWithDisclosure, title);

            const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${randomUUID().slice(0, 8)}.docx`;
            const filePath = path.join(GENERATED_DIR, filename);

            await fs.writeFile(filePath, buffer);

            // Construct public URL. We assume Ingress maps /api to backend.
            // So /api/tools/download/:filename is accessible.
            const downloadUrl = `/api/tools/download/${filename}`;

            return { success: true, url: downloadUrl, filename };
        } catch (error: any) {
            request.log.error(`[Tools] Error generating DOCX: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to generate document' });
        }
    });

    // POST: Generate Excel
    fastify.post('/tools/generate-excel', {
        onRequest: [(fastify as any).authenticate],
        config: docGenRateLimit,
        schema: {
            tags: ['Tools'],
            description: 'Generate an Excel file from JSON data',
            body: {
                type: 'object',
                properties: {
                    data: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true }
                    },
                    title: { type: 'string' }
                },
                required: ['data']
            }
        }
    }, async (request, reply) => {
        try {
            const { data, title } = z.object({
                data: z.array(z.record(z.any())),
                title: z.string().optional().default('Dati_Export')
            }).parse(request.body);

            // AI Act Art. 50.2: add disclosure metadata
            const dataWithDisclosure = [
              ...data,
              {},
              { [Object.keys(data[0] || {})[0] || 'Note']: '[Avviso AI Act] Dati generati tramite intelligenza artificiale — Enterprise AI Chat. Verificare con fonti autorevoli.' }
            ];
            const buffer = await generateExcelBuffer(dataWithDisclosure, title);

            const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${randomUUID().slice(0, 8)}.xlsx`;
            const filePath = path.join(GENERATED_DIR, filename);

            await fs.writeFile(filePath, buffer);

            const downloadUrl = `/api/tools/download/${filename}`;

            return { success: true, url: downloadUrl, filename };
        } catch (error: any) {
            request.log.error(`[Tools] Error generating Excel: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to generate spreadsheet' });
        }
    });

    // POST: Generate PowerPoint
    fastify.post('/tools/generate-pptx', {
        onRequest: [(fastify as any).authenticate],
        config: docGenRateLimit,
        schema: {
            tags: ['Tools'],
            description: 'Generate a PowerPoint file from JSON slides',
            body: {
                type: 'object',
                properties: {
                    slides: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                content: { type: 'string' }
                            },
                            required: ['title', 'content']
                        }
                    },
                    title: { type: 'string' }
                },
                required: ['slides']
            }
        }
    }, async (request, reply) => {
        try {
            const pptxSchema = z.object({
                slides: z.array(z.object({
                    title: z.string(),
                    content: z.string()
                })).min(1),
                title: z.string().optional()
            });
            const { slides, title } = pptxSchema.parse(request.body);
            // AI Act Art. 50.2: add disclosure slide
            const slidesWithDisclosure = [
              ...slides,
              {
                title: 'Avviso AI Act',
                content: 'Questa presentazione è stata generata tramite intelligenza artificiale (Enterprise AI Chat). Le informazioni contenute potrebbero non essere accurate. Si consiglia di verificare i contenuti con fonti autorevoli prima di qualsiasi utilizzo professionale.'
              }
            ];
            const buffer = await generatePptxBuffer(slidesWithDisclosure, title);

            const filename = `presentation_${Date.now()}_${randomUUID().slice(0, 8)}.pptx`;
            const filePath = path.join(GENERATED_DIR, filename);
            await fs.writeFile(filePath, buffer);

            const downloadUrl = `/api/tools/download/${filename}`;
            return { success: true, url: downloadUrl, filename };
        } catch (error: any) {
            fastify.log.error(`[Tools] Error generating PPTX: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to generate presentation' });
        }
    });

    // POST: Convert to PDF
    // Accepts a file via multipart upload (for simplicity in this flow, or reuse existing attachment logic)
    // For the tool call, we'll assume the python tool sends a base64 encoded file or we reuse the attachment system.
    // To make it simple for the Python tool, let's accept JSON with base64 content or a path to an existing attachment.
    // But standard tool use usually generates content.
    // If the USER wants to convert an EXISTING file, they normally upload it first.
    // Let's implement a route that takes an attachment ID to convert.
    fastify.post('/tools/convert-to-pdf', {
        onRequest: [(fastify as any).authenticate],
        config: docGenRateLimit,
        schema: {
            tags: ['Tools'],
            description: 'Convert an existing attachment (DOCX, XLSX, PPTX) to PDF',
            body: {
                type: 'object',
                properties: {
                    attachment_id: { type: 'integer' }
                },
                required: ['attachment_id']
            }
        }
    }, async (request, reply) => {
        try {
            const convertSchema = z.object({
                attachment_id: z.number().int().positive()
            });
            const { attachment_id } = convertSchema.parse(request.body);
            const user = request.user as { id: number };

            // Fetch attachment from DB with user ownership check (IDOR protection)
            const attachment = await fastify.db.query(
                'SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?', [attachment_id, user.id]
            ).then((res: any) => res[0]?.[0]);

            if (!attachment) {
                return reply.status(404).send({ error: 'Attachment not found' });
            }

            const inputPath = attachment.file_path;
            const outputDir = path.dirname(inputPath);
            const inputBuffer = await fs.readFile(inputPath);

            const pdfPath = await convertOfficeToPdf(inputBuffer, outputDir, attachment.original_name);
            const filename = path.basename(pdfPath);

            // We should probably register this new PDF as an attachment or just return the URL
            // For simplicity, return the download URL
            // Actually /download maps to GENERATED_DIR. Attachments are in ATTACHMENT_ROOT.
            // We should COPY the PDF to GENERATED_DIR to make it publicly downloadable via this route.

            const generatedPath = path.join(GENERATED_DIR, filename);
            await fs.copyFile(pdfPath, generatedPath);

            const downloadUrl = `/api/tools/download/${filename}`;

            return { success: true, url: downloadUrl, filename };

        } catch (error: any) {
            fastify.log.error(`[Tools] Error converting to PDF: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to convert document to PDF' });
        }
    });

    // POST: Generate document from chat conversation content
    // Works independently of AI tool calling — any model's response can be exported
    fastify.post('/tools/generate-from-chat', {
        onRequest: [(fastify as any).authenticate],
        config: docGenRateLimit,
        schema: {
            tags: ['Tools'],
            description: 'Generate a document from the last assistant message in a conversation',
            body: {
                type: 'object',
                properties: {
                    conversationId: { type: 'integer' },
                    format: { type: 'string', enum: ['docx', 'xlsx', 'pptx', 'pdf'] },
                    content: { type: 'string' },
                    title: { type: 'string' }
                },
                required: ['format']
            }
        }
    }, async (request, reply) => {
        try {
            const user = request.user as { id: number };
            const body = z.object({
                conversationId: z.number().optional(),
                format: z.enum(['docx', 'xlsx', 'pptx', 'pdf']),
                content: z.string().optional(),
                title: z.string().optional().default('Documento_Chat')
            }).parse(request.body);

            let textContent = body.content || '';

            // If no content provided, get the last assistant message from conversation
            // SECURITY: ownership check is combined with the message query to prevent TOCTOU
            if (!textContent && body.conversationId) {
                const lastMessage = await findOne<{ content: string }>(
                    fastify.db,
                    `SELECT m.content FROM messages m
                     JOIN conversations c ON m.conversation_id = c.id
                     WHERE m.conversation_id = ? AND c.user_id = ? AND m.role = 'assistant'
                     ORDER BY m.created_at DESC LIMIT 1`,
                    [body.conversationId, user.id]
                );

                if (!lastMessage) {
                    return reply.status(403).send({ error: 'Conversation not found or no assistant message' });
                }

                textContent = lastMessage.content;
            }

            if (!textContent) {
                return reply.status(400).send({ error: 'No content to generate document from. Provide content or conversationId.' });
            }

            // Strip markdown formatting artifacts for cleaner documents
            const cleanContent = textContent
                .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, '').replace(/```/g, ''))
                .replace(/\*\*(.*?)\*\*/g, '$1')
                .replace(/\*(.*?)\*/g, '$1');

            let buffer: Buffer;
            let filename: string;

            switch (body.format) {
                case 'docx': {
                    buffer = await generateDocxBuffer(cleanContent, body.title);
                    filename = `${body.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.docx`;
                    break;
                }
                case 'pdf': {
                    // Generate DOCX first, then convert to PDF via LibreOffice
                    const docxBuffer = await generateDocxBuffer(cleanContent, body.title);
                    const tmpDocx = path.join(GENERATED_DIR, `_tmp_${Date.now()}_${randomUUID().slice(0, 8)}.docx`);
                    await fs.writeFile(tmpDocx, docxBuffer);
                    const pdfPath = await convertOfficeToPdf(docxBuffer, GENERATED_DIR, `_tmp_${Date.now()}_${randomUUID().slice(0, 8)}.docx`);
                    buffer = await fs.readFile(pdfPath);
                    filename = `${body.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${randomUUID().slice(0, 8)}.pdf`;
                    // Clean up temp files
                    await fs.unlink(tmpDocx).catch(() => {});
                    await fs.unlink(pdfPath).catch(() => {});
                    break;
                }
                case 'xlsx': {
                    // Try to parse content as table data; fallback to single-column
                    const lines = cleanContent.split('\n').filter(l => l.trim());
                    const data = lines.map((line, i) => ({ riga: i + 1, contenuto: line.trim() }));
                    buffer = await generateExcelBuffer(data, body.title);
                    filename = `${body.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.xlsx`;
                    break;
                }
                case 'pptx': {
                    // Split content into slides by double newlines or headings
                    const sections = cleanContent.split(/\n#{1,3}\s+|\n\n\n/).filter(s => s.trim());
                    const slides = sections.map((section, i) => {
                        const lines = section.trim().split('\n');
                        return {
                            title: lines[0]?.substring(0, 100) || `Slide ${i + 1}`,
                            content: lines.slice(1).join('\n').trim() || lines[0] || ''
                        };
                    });
                    buffer = await generatePptxBuffer(slides.length > 0 ? slides : [{ title: body.title, content: cleanContent }], body.title);
                    filename = `${body.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pptx`;
                    break;
                }
                default:
                    return reply.status(400).send({ error: `Unsupported format: ${body.format}` });
            }

            // Save to generated directory
            const filePath = path.join(GENERATED_DIR, filename);
            await fs.writeFile(filePath, buffer);

            const downloadUrl = `/api/tools/download/${filename}`;
            return { success: true, url: downloadUrl, filename, format: body.format };

        } catch (error: any) {
            fastify.log.error(`[Tools] Error generating from chat: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to generate document' });
        }
    });

    // SECURITY: Download now requires authentication to prevent unauthorized file access
    fastify.get('/tools/download/:filename', {
        onRequest: [(fastify as any).authenticate],
        schema: {
            tags: ['Tools'],
            description: 'Download a generated document by filename (requires authentication)',
            security: [{ bearerAuth: [] }],
            params: {
                type: 'object',
                properties: {
                    filename: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { filename } = request.params as { filename: string };

        // Security: path traversal prevention via path.resolve
        const resolved = path.resolve(GENERATED_DIR, filename);
        if (!resolved.startsWith(path.resolve(GENERATED_DIR) + path.sep) && resolved !== path.resolve(GENERATED_DIR)) {
            return reply.status(400).send({ error: 'Invalid filename' });
        }

        let filePath = resolved;
        const requestedExt = path.extname(filename).toLowerCase();

        try {
            await fs.access(filePath);
        } catch {
            // Fuzzy match: AI models often hallucinate filenames but keep the timestamp.
            // Extract timestamp from requested filename and find the real file.
            const tsMatch = filename.match(/(\d{13})/);
            if (tsMatch) {
                const timestamp = tsMatch[1];
                try {
                    const files = await fs.readdir(GENERATED_DIR);
                    // Find file with same extension and similar timestamp (within ±5ms)
                    const ts = parseInt(timestamp);
                    const match = files.find(f => {
                        if (path.extname(f).toLowerCase() !== requestedExt) return false;
                        const ftsMatch = f.match(/(\d{13})/);
                        if (!ftsMatch) return false;
                        return Math.abs(parseInt(ftsMatch[1]) - ts) <= 5;
                    });
                    if (match) {
                        filePath = path.join(GENERATED_DIR, match);
                        request.log.info(`[Download] Fuzzy match: "${filename}" → "${match}"`);
                    } else {
                        return reply.status(404).send({ error: 'File not found' });
                    }
                } catch {
                    return reply.status(404).send({ error: 'File not found' });
                }
            } else {
                return reply.status(404).send({ error: 'File not found' });
            }
        }

        try {
            const buffer = await fs.readFile(filePath);
            const actualFilename = path.basename(filePath);
            // SECURITY: Use actual file's extension (not user-supplied) for Content-Type
            const ext = path.extname(actualFilename).toLowerCase();

            let contentType = 'application/octet-stream';
            if (ext === '.docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            else if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            else if (ext === '.pptx') contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            else if (ext === '.pdf') contentType = 'application/pdf';

            reply.header('Content-Type', contentType);
            // RFC 5987: encode filename for Content-Disposition to prevent header injection
            const safeAscii = actualFilename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
            const utf8Encoded = encodeURIComponent(actualFilename).replace(/'/g, '%27');
            reply.header('Content-Disposition', `attachment; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`);
            return reply.send(buffer);
        } catch {
            return reply.status(404).send({ error: 'File not found' });
        }
    });
}
