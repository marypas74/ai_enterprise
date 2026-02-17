import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateDocxBuffer, generateExcelBuffer, generatePptxBuffer, convertOfficeToPdf } from '../../services/DocumentProcessorService.js';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const generateDocxSchema = z.object({
    text: z.string().min(1),
    title: z.string().optional().default('Documento Generato')
});

const GENERATED_DIR = path.join(process.cwd(), 'public', 'generated');

// Ensure directory exists synchronously on load
if (!existsSync(GENERATED_DIR)) {
    mkdirSync(GENERATED_DIR, { recursive: true });
}

export async function toolsRoutes(fastify: FastifyInstance) {
    // POST: Generate and save file
    fastify.post('/tools/generate-docx', {
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

            const buffer = await generateDocxBuffer(text, title);

            const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.docx`;
            const filePath = path.join(GENERATED_DIR, filename);

            await fs.writeFile(filePath, buffer);

            // Construct public URL. We assume Ingress maps /api to backend.
            // So /api/tools/download/:filename is accessible.
            const publicUrl = `http://chat.yourdomain.com/api/tools/download/${filename}`;

            return { success: true, url: publicUrl, filename };
        } catch (error: any) {
            request.log.error(`[Tools] Error generating DOCX: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to generate document' });
        }
    });

    // POST: Generate Excel
    fastify.post('/tools/generate-excel', {
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

            const buffer = await generateExcelBuffer(data, title);

            const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.xlsx`;
            const filePath = path.join(GENERATED_DIR, filename);

            await fs.writeFile(filePath, buffer);

            const publicUrl = `http://chat.yourdomain.com/api/tools/download/${filename}`;

            return { success: true, url: publicUrl, filename };
        } catch (error: any) {
            request.log.error(`[Tools] Error generating Excel: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to generate spreadsheet' });
        }
    });

    // POST: Generate PowerPoint
    fastify.post('/tools/generate-pptx', {
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
            const { slides, title } = request.body as { slides: any[], title?: string };
            const buffer = await generatePptxBuffer(slides, title);

            const filename = `presentation_${Date.now()}.pptx`;
            const filePath = path.join(GENERATED_DIR, filename);
            await fs.writeFile(filePath, buffer);

            const publicUrl = `http://chat.yourdomain.com/api/tools/download/${filename}`;
            return { success: true, url: publicUrl, filename };
        } catch (error: any) {
            fastify.log.error(`[Tools] Error generating PPTX: ${error.message}`);
            return reply.status(500).send({ error: error.message });
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
            const { attachment_id } = request.body as { attachment_id: number };

            // Fetch attachment from DB to get path
            // We need access to the DB. Fastify instance has it.
            const attachment = await fastify.db.query(
                'SELECT * FROM chat_attachments WHERE id = ?', [attachment_id]
            ).then((res: any) => res[0]?.[0]); // Accessing raw mysql2 result: [rows, fields]

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

            // Construct public URL
            // const publicUrl = `http://chat.yourdomain.com/api/tools/download/${filename}`; // Use configured domain
            // Use relative URL for internal cluster use or configured external URL
            const downloadUrl = `/api/tools/download/${filename}`;

            return { success: true, url: downloadUrl, filename };

        } catch (error: any) {
            fastify.log.error(`[Tools] Error converting to PDF: ${error.message}`);
            return reply.status(500).send({ error: error.message });
        }
    });

    // GET: Download file
    fastify.get('/tools/download/:filename', {
        schema: {
            tags: ['Tools'],
            params: {
                type: 'object',
                properties: {
                    filename: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { filename } = request.params as { filename: string };

        // Security check
        if (filename.includes('..') || filename.includes('/')) {
            return reply.status(400).send({ error: 'Invalid filename' });
        }

        const filePath = path.join(GENERATED_DIR, filename);

        try {
            await fs.access(filePath);
            const buffer = await fs.readFile(filePath);

            const ext = path.extname(filename).toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === '.docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            else if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            else if (ext === '.pptx') contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

            reply.header('Content-Type', contentType);
            reply.header('Content-Disposition', `attachment; filename="${filename}"`);
            return reply.send(buffer);
        } catch {
            return reply.status(404).send({ error: 'File not found' });
        }
    });
}
