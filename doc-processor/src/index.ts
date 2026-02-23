/**
 * doc-processor — Document Processing Microservice
 * Provides REST API for PDF extraction and Office document generation.
 * Designed to run as a standalone K8s service, called by the main backend.
 */

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024 // 50MB
});

await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// ============================================================
// Health check
// ============================================================
fastify.get('/health', async () => {
  return { status: 'ok', service: 'doc-processor', timestamp: new Date().toISOString() };
});

// ============================================================
// POST /extract — Extract text from uploaded document
// ============================================================
fastify.post('/extract', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'No file uploaded' });
  }

  const buffer = await data.toBuffer();
  const mimeType = data.mimetype;
  const filename = data.filename;

  try {
    let text = '';
    let method = 'unknown';

    if (mimeType === 'application/pdf') {
      // PDF text extraction using pdf-parse v2
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      text = result.text || '';
      method = 'pdf-parse';

      // If text is too sparse, try pdftotext (poppler-utils)
      if (text.trim().length < 20) {
        try {
          const tmpDir = path.join(os.tmpdir(), `extract_${Date.now()}`);
          await fs.mkdir(tmpDir, { recursive: true });
          const tmpFile = path.join(tmpDir, 'input.pdf');
          await fs.writeFile(tmpFile, buffer);
          const { stdout } = await execAsync(`pdftotext -layout "${tmpFile}" -`, { timeout: 30000 });
          if (stdout.trim().length > text.trim().length) {
            text = stdout;
            method = 'pdftotext';
          }
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        } catch {
          // pdftotext not available or failed, keep pdf-parse result
        }
      }
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      // DOCX extraction via simple XML parsing
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml')?.async('text');
      if (docXml) {
        const textMatches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        if (textMatches) {
          text = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
        }
      }
      method = 'docx-xml';
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      // Excel extraction
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
      const parts: string[] = [];
      workbook.eachSheet((worksheet) => {
        parts.push(`--- Sheet: ${worksheet.name} ---`);
        const rows: string[] = [];
        worksheet.eachRow((row) => {
          const values = (row.values as any[]).slice(1);
          rows.push(values.map(v => v != null ? String(v) : '').join(','));
        });
        parts.push(rows.join('\n'));
      });
      text = parts.join('\n\n');
      method = 'exceljs';
    } else if (mimeType.startsWith('text/')) {
      text = buffer.toString('utf-8');
      method = 'text-read';
    } else {
      return reply.status(400).send({ error: `Unsupported MIME type: ${mimeType}` });
    }

    return { text, method, charCount: text.length, filename };
  } catch (error: any) {
    fastify.log.error(`[Extract] Error: ${error.message}`);
    return reply.status(500).send({ error: `Extraction failed: ${error.message}` });
  }
});

// ============================================================
// POST /generate/docx — Generate DOCX from text content
// ============================================================
fastify.post('/generate/docx', async (request, reply) => {
  const body = request.body as { content: string; title?: string };
  if (!body.content) {
    return reply.status(400).send({ error: 'Missing required field: content' });
  }

  try {
    const title = body.title || 'Documento Generato';
    const lines = body.content.split('\n');

    const children: Paragraph[] = [
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 32, color: '003366' })],
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({ children: [] }),
    ];

    for (const line of lines) {
      if (line.startsWith('# ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.slice(2), bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
        }));
      } else if (line.startsWith('## ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.slice(3), bold: true, size: 26 })],
          heading: HeadingLevel.HEADING_2,
        }));
      } else if (line.startsWith('### ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.slice(4), bold: true, size: 24 })],
          heading: HeadingLevel.HEADING_3,
        }));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.slice(2), size: 24 })],
          bullet: { level: 0 },
        }));
      } else if (line.match(/^\*\*(.+)\*\*$/)) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.replace(/\*\*/g, ''), bold: true, size: 24 })],
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
        }));
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });

    const buffer = await Packer.toBuffer(doc);

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', `attachment; filename="${title.replace(/[^a-z0-9]/gi, '_')}.docx"`);
    return reply.send(Buffer.from(buffer));
  } catch (error: any) {
    fastify.log.error(`[Generate DOCX] Error: ${error.message}`);
    return reply.status(500).send({ error: `DOCX generation failed: ${error.message}` });
  }
});

// ============================================================
// POST /generate/xlsx — Generate Excel from JSON data
// ============================================================
fastify.post('/generate/xlsx', async (request, reply) => {
  const body = request.body as { data: Record<string, any>[]; sheetName?: string; title?: string };
  if (!body.data || !Array.isArray(body.data)) {
    return reply.status(400).send({ error: 'Missing required field: data (array of objects)' });
  }

  try {
    const sheetName = body.sheetName || body.title || 'Sheet1';
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    if (body.data.length > 0) {
      const columns = Object.keys(body.data[0]).map(key => ({ header: key, key }));
      worksheet.columns = columns;
      for (const row of body.data) {
        worksheet.addRow(row);
      }
      // Style header row
      worksheet.getRow(1).font = { bold: true };
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${sheetName.replace(/[^a-z0-9]/gi, '_')}.xlsx"`);
    return reply.send(buffer);
  } catch (error: any) {
    fastify.log.error(`[Generate XLSX] Error: ${error.message}`);
    return reply.status(500).send({ error: `Excel generation failed: ${error.message}` });
  }
});

// ============================================================
// POST /generate/pptx — Generate PowerPoint from slides
// ============================================================
fastify.post('/generate/pptx', async (request, reply) => {
  const body = request.body as { slides: { title: string; content: string }[]; title?: string };
  if (!body.slides || !Array.isArray(body.slides)) {
    return reply.status(400).send({ error: 'Missing required field: slides (array of {title, content})' });
  }

  try {
    const title = body.title || 'Presentazione';
    const pptx = new (PptxGenJS as any)();
    pptx.author = 'Enterprise AI Chat';
    pptx.title = title;

    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.addText(title, { x: 1, y: 1, w: 8, h: 1, fontSize: 36, align: 'center', bold: true });
    titleSlide.addText('Generato da AI', { x: 1, y: 2.5, w: 8, h: 0.5, fontSize: 18, align: 'center', color: '363636' });

    for (const slideData of body.slides) {
      const slide = pptx.addSlide();
      slide.addText(slideData.title, { x: 0.5, y: 0.5, w: 9, h: 0.6, fontSize: 24, bold: true, color: '003366' });
      const items = slideData.content.split('\n').filter((line: string) => line.trim().length > 0);
      slide.addText(slideData.content, {
        x: 0.5, y: 1.5, w: 9, h: 3.5, fontSize: 14, color: '363636', align: 'left',
        bullet: items.length > 1
      });
    }

    const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    reply.header('Content-Disposition', `attachment; filename="${title.replace(/[^a-z0-9]/gi, '_')}.pptx"`);
    return reply.send(buffer);
  } catch (error: any) {
    fastify.log.error(`[Generate PPTX] Error: ${error.message}`);
    return reply.status(500).send({ error: `PPTX generation failed: ${error.message}` });
  }
});

// ============================================================
// POST /convert/pdf — Convert uploaded Office doc to PDF
// ============================================================
fastify.post('/convert/pdf', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'No file uploaded' });
  }

  const buffer = await data.toBuffer();
  const filename = data.filename;

  try {
    const tmpDir = path.join(os.tmpdir(), `convert_${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const inputPath = path.join(tmpDir, filename);
    await fs.writeFile(inputPath, buffer);

    const cmd = `soffice --headless --convert-to pdf --outdir "${tmpDir}" "${inputPath}"`;
    await execAsync(cmd, { timeout: 60000 });

    const baseName = path.basename(filename, path.extname(filename));
    const pdfPath = path.join(tmpDir, `${baseName}.pdf`);

    await fs.access(pdfPath);
    const pdfBuffer = await fs.readFile(pdfPath);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    return reply.send(pdfBuffer);
  } catch (error: any) {
    fastify.log.error(`[Convert PDF] Error: ${error.message}`);
    return reply.status(500).send({ error: `PDF conversion failed: ${error.message}` });
  }
});

// ============================================================
// Start server
// ============================================================
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`doc-processor running on ${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
