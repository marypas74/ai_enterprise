/**
 * Document Processor Service
 * Handles OCR, Office extraction, and PDF-to-DOCX conversion
 */

import { createWorker, createScheduler, Worker } from 'tesseract.js';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import fs from 'fs/promises';
import path from 'path';
import PptxGenJS from 'pptxgenjs';

// ============================================================
// OCR — Tesseract.js
// ============================================================

let ocrWorker: Worker | null = null;

async function getOCRWorker(lang: string = 'ita+eng'): Promise<Worker> {
    if (!ocrWorker) {
        ocrWorker = await createWorker(lang);
    }
    return ocrWorker;
}

/**
 * Extract text from an image using OCR (Tesseract.js)
 */
export async function extractWithOCR(
    buffer: Buffer,
    lang: string = 'ita+eng'
): Promise<string> {
    try {
        const worker = await getOCRWorker(lang);
        const { data } = await worker.recognize(buffer);
        return data.text || '';
    } catch (error: any) {
        console.error(`[DocumentProcessor] OCR error: ${error.message}`);
        throw new Error(`OCR extraction failed: ${error.message}`);
    }
}

/**
 * Extract text from a scanned PDF by converting pages to PNG images
 * using pdftoppm (poppler-utils), then running OCR on each page in parallel.
 */
export async function extractPdfWithOCR(
    buffer: Buffer,
    lang: string = 'ita+eng'
): Promise<string> {
    const crypto = await import('crypto');
    const os = await import('os');
    const { promisify } = await import('util');
    const { exec: execCb } = await import('child_process');
    const execAsync = promisify(execCb);

    const tmpId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(os.tmpdir(), `pdf_ocr_${tmpId}`);
    const tmpPdf = path.join(tmpDir, 'input.pdf');

    console.log(`[DocumentProcessor] PDF OCR: creating temp dir ${tmpDir}`);
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(tmpPdf, buffer);

    try {
        // Convert PDF pages to PNG images at 300 DPI using pdftoppm
        console.log(`[DocumentProcessor] PDF OCR: running pdftoppm for ${buffer.length} bytes`);
        await execAsync(`pdftoppm -png -r 300 "${tmpPdf}" "${tmpDir}/page"`, { timeout: 120000 });

        // Find generated page images
        const files = await fs.readdir(tmpDir);
        const pageImages = files.filter(f => f.startsWith('page-') && f.endsWith('.png')).sort();

        if (pageImages.length === 0) {
            throw new Error('pdftoppm produced no page images');
        }

        console.log(`[DocumentProcessor] PDF OCR: ${pageImages.length} page images generated, starting parallel OCR`);

        // Setup parallel workers using a scheduler
        const scheduler = createScheduler();
        const numWorkers = Math.min(pageImages.length, 2); // Use up to 2 workers to avoid overloading the container
        for (let i = 0; i < numWorkers; i++) {
            const worker = await createWorker(lang);
            scheduler.addWorker(worker);
        }

        // Process all pages in parallel
        const pageResults = await Promise.all(pageImages.map(async (img, idx) => {
            console.log(`[DocumentProcessor] PDF OCR: scheduling page ${idx + 1}/${pageImages.length}`);
            const imgBuffer = await fs.readFile(path.join(tmpDir, img));
            const { data } = await scheduler.addJob('recognize', imgBuffer);
            return data.text || '';
        }));

        await scheduler.terminate();

        const result = pageResults.join('\n\n--- Page Break ---\n\n');
        console.log(`[DocumentProcessor] PDF OCR: extracted ${result.length} chars from ${pageImages.length} pages`);
        return result;
    } catch (error: any) {
        console.error(`[DocumentProcessor] PDF OCR error: ${error.message}`);
        throw new Error(`PDF OCR extraction failed: ${error.message}`);
    } finally {
        // Cleanup temp directory
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
}

// ============================================================
// Office Extraction — mammoth (DOCX) + xlsx (Excel)
// ============================================================

/**
 * Extract text from a DOCX file
 */
export async function extractDocxContent(buffer: Buffer): Promise<string> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value || '';
    } catch (error: any) {
        console.error(`[DocumentProcessor] DOCX extraction error: ${error.message}`);
        throw new Error(`DOCX extraction failed: ${error.message}`);
    }
}

/**
 * Extract text from an Excel file (XLS/XLSX)
 */
export async function extractExcelContent(buffer: Buffer): Promise<string> {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
        const parts: string[] = [];

        workbook.eachSheet((worksheet) => {
            parts.push(`--- Foglio: ${worksheet.name} ---`);
            const rows: string[] = [];
            worksheet.eachRow((row) => {
                const values = (row.values as any[]).slice(1); // ExcelJS row.values is 1-indexed
                rows.push(values.map(v => v != null ? String(v) : '').join(','));
            });
            parts.push(rows.join('\n'));
        });

        return parts.join('\n\n');
    } catch (error: any) {
        console.error(`[DocumentProcessor] Excel extraction error: ${error.message}`);
        throw new Error(`Excel extraction failed: ${error.message}`);
    }
}

/**
 * Extract text from a PowerPoint file (basic — extracts text from XML)
 */
export async function extractPptxContent(buffer: Buffer): Promise<string> {
    // PPTX is a ZIP of XML files; extract text from slide XML
    try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);
        const parts: string[] = [];

        // Extract text from slide XML files
        const slideFiles = Object.keys(zip.files)
            .filter(f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
            .sort();

        for (const slideFile of slideFiles) {
            const xml = await zip.files[slideFile].async('text');
            // Extract text between <a:t> tags
            const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
            if (textMatches) {
                const texts = textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
                if (texts.length > 0) parts.push(texts.join(' '));
            }
        }

        if (parts.length > 0) return parts.join('\n\n');
        return '[Presentazione PowerPoint - estrazione testo limitata. Per risultati migliori, convertire in PDF.]';
    } catch {
        return '[Presentazione PowerPoint - formato non supportato per estrazione diretta.]';
    }
}

/**
 * Extract text from an Office document based on MIME type
 */
export async function extractOfficeContent(
    buffer: Buffer,
    mimeType: string
): Promise<string> {
    // DOCX
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword'
    ) {
        if (mimeType === 'application/msword') {
            // Old .doc format — mammoth handles some but not all
            try {
                return await extractDocxContent(buffer);
            } catch {
                return '[Documento Word (.doc) - formato legacy. Convertire in .docx per estrazione completa.]';
            }
        }
        return await extractDocxContent(buffer);
    }

    // Excel
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel'
    ) {
        return await extractExcelContent(buffer);
    }

    // PowerPoint
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mimeType === 'application/vnd.ms-powerpoint'
    ) {
        return await extractPptxContent(buffer);
    }

    return `[Documento Office non supportato: ${mimeType}]`;
}

// ============================================================
// PDF-to-DOCX Conversion
// ============================================================

/**
 * Convert extracted text into a DOCX document
 * Returns the path of the generated DOCX file
 */
/**
 * Generate a DOCX buffer from text
 */
/**
 * Generate a DOCX buffer from text
 */
export async function generateDocxBuffer(
    text: string,
    title: string = 'Documento Generato'
): Promise<Buffer> {
    try {
        const paragraphs = text.split('\n').map(line => {
            return new Paragraph({
                children: [
                    new TextRun({
                        text: line,
                        size: 24, // 12pt
                    }),
                ],
            });
        });

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: title,
                                bold: true,
                                size: 32, // 16pt
                            }),
                        ],
                    }),
                    new Paragraph({ children: [] }),
                    ...paragraphs,
                ],
            }],
        });

        return await Packer.toBuffer(doc);
    } catch (error: any) {
        console.error(`[DocumentProcessor] DOCX generation error: ${error.message}`);
        throw new Error(`DOCX generation failed: ${error.message}`);
    }
}

/**
 * Generate an Excel buffer from data
 * @param data Array of objects (rows)
 * @param sheetName Name of the sheet
 */
export async function generateExcelBuffer(
    data: Record<string, any>[],
    sheetName: string = 'Sheet1'
): Promise<Buffer> {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(sheetName);

        if (data.length > 0) {
            // Add headers from first object's keys
            const columns = Object.keys(data[0]).map(key => ({ header: key, key }));
            worksheet.columns = columns;
            // Add rows
            for (const row of data) {
                worksheet.addRow(row);
            }
        }

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error: any) {
        console.error(`[DocumentProcessor] Excel generation error: ${error.message}`);
        throw new Error(`Excel generation failed: ${error.message}`);
    }
}

/**
 * Generate a PowerPoint buffer from slides
 * @param slides Array of { title, content }
 * @param title Presentation title
 */
export async function generatePptxBuffer(
    slides: { title: string; content: string }[],
    title: string = 'Presentazione'
): Promise<Buffer> {
    try {
        const pptx = new (PptxGenJS as any)();

        // set metadata
        pptx.author = 'Enterprise AI Chat';
        pptx.company = 'Your Company';
        pptx.subject = title;
        pptx.title = title;

        // Title Slide
        const titleSlide = pptx.addSlide();
        titleSlide.addText(title, { x: 1, y: 1, w: 8, h: 1, fontSize: 36, align: 'center', bold: true });
        titleSlide.addText('Generato da AI', { x: 1, y: 2.5, w: 8, h: 0.5, fontSize: 18, align: 'center', color: '363636' });

        // Content Slides
        for (const slideData of slides) {
            const slide = pptx.addSlide();
            slide.addText(slideData.title, { x: 0.5, y: 0.5, w: 9, h: 0.6, fontSize: 24, bold: true, color: '003366' });

            // Handle bullet points if content has newlines
            const items = slideData.content.split('\n').filter(line => line.trim().length > 0);

            // Simple text rendering
            slide.addText(slideData.content, { x: 0.5, y: 1.5, w: 9, h: 3.5, fontSize: 14, color: '363636', align: 'left', bullet: items.length > 1 });
        }

        // Return a nodebuffer. The type definition might require 'nodebuffer' string.
        return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
    } catch (error: any) {
        console.error(`[DocumentProcessor] PPTX generation error: ${error.message}`);
        throw new Error(`PPTX generation failed: ${error.message}`);
    }
}


/**
 * Convert extracted text into a DOCX document
 * Returns the path of the generated DOCX file
 */
export async function convertTextToDocx(
    text: string,
    outputPath: string,
    title: string = 'Documento Convertito'
): Promise<string> {
    try {
        const buffer = await generateDocxBuffer(text, title);
        await fs.writeFile(outputPath, buffer);
        return outputPath;
    } catch (error: any) {
        console.error(`[DocumentProcessor] DOCX conversion error: ${error.message}`);
        throw new Error(`DOCX conversion failed: ${error.message}`);
    }
}

/**
 * Generate an Excel document from data and save it to disk
 */
export async function convertDataToXlsx(
    data: Record<string, any>[],
    outputPath: string,
    sheetName: string = 'Dati'
): Promise<string> {
    try {
        const buffer = await generateExcelBuffer(data, sheetName);
        await fs.writeFile(outputPath, buffer);
        return outputPath;
    } catch (error: any) {
        console.error(`[DocumentProcessor] Excel conversion error: ${error.message}`);
        throw new Error(`Excel conversion failed: ${error.message}`);
    }
}

/**
 * Generate a PowerPoint presentation from slides and save it to disk
 */
export async function convertSlidesToPptx(
    slides: { title: string; content: string }[],
    outputPath: string,
    title: string = 'Presentazione Generata'
): Promise<string> {
    try {
        const buffer = await generatePptxBuffer(slides, title);
        await fs.writeFile(outputPath, buffer);
        return outputPath;
    } catch (error: any) {
        console.error(`[DocumentProcessor] PPTX conversion error: ${error.message}`);
        throw new Error(`PPTX conversion failed: ${error.message}`);
    }
}

// ============================================================
// Unified Processor
// ============================================================

export interface ProcessResult {
    text: string;
    method: 'pdf-parse' | 'ocr' | 'mammoth' | 'xlsx' | 'pptx' | 'text-read' | 'unknown';
    charCount: number;
}

/**
 * Process any supported document and extract text
 */
export async function processDocument(
    buffer: Buffer,
    mimeType: string,
    originalName: string
): Promise<ProcessResult> {
    // Images → OCR
    if (mimeType.startsWith('image/')) {
        const text = await extractWithOCR(buffer);
        return { text, method: 'ocr', charCount: text.length };
    }

    // Office documents
    if (
        mimeType.includes('document') ||
        mimeType.includes('msword') ||
        mimeType.includes('spreadsheet') ||
        mimeType.includes('excel') ||
        mimeType.includes('powerpoint') ||
        mimeType.includes('presentation')
    ) {
        const text = await extractOfficeContent(buffer, mimeType);
        const method = mimeType.includes('spreadsheet') || mimeType.includes('excel')
            ? 'xlsx' as const
            : mimeType.includes('powerpoint') || mimeType.includes('presentation')
                ? 'pptx' as const
                : 'mammoth' as const;
        return { text, method, charCount: text.length };
    }

    // PDF -> pdf-parse (with OCR fallback)
    if (mimeType === 'application/pdf') {
        const { extractPdfText } = await import('../modules/attachments/routes.js');
        let text: string = await extractPdfText(buffer);

        // Check if text is too sparse or just markers
        const markerPattern = /-- \d+ of \d+ --/g;
        const cleanedText = text.replace(markerPattern, '').trim();

        if (cleanedText.length < 20) {
            console.log(`[DocumentProcessor] PDF text too sparse (${cleanedText.length} chars) for ${originalName}, trying OCR...`);
            try {
                const ocrText = await extractPdfWithOCR(buffer);
                if (ocrText.trim()) text = ocrText;
            } catch (ocrErr: any) {
                console.warn(`[DocumentProcessor] PDF OCR fallback failed: ${ocrErr.message}`);
            }
        }
        return { text, method: 'pdf-parse', charCount: text.length };
    }

    // Plain text / code
    if (mimeType.startsWith('text/')) {
        const text = buffer.toString('utf-8');
        return { text, method: 'text-read', charCount: text.length };
    }

    return {
        text: `[File: ${originalName}] - Tipo non supportato per estrazione: ${mimeType}`,
        method: 'unknown',
        charCount: 0
    };
}

export async function terminateOCRWorker(): Promise<void> {
    if (ocrWorker) {
        await ocrWorker.terminate();
        ocrWorker = null;
    }
}

// ============================================================
// PDF Conversion (LibreOffice)
// ============================================================

import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

/**
 * Convert an Office document (DOCX, XLSX, PPTX) to PDF using LibreOffice
 * @param inputBuffer Buffer of the input file
 * @param outputDir Directory where the input file and output PDF will be stored
 * @param originalName Original filename to preserve extension
 * @returns Path to the generated PDF file
 */
export async function convertOfficeToPdf(
    inputBuffer: Buffer,
    outputDir: string,
    originalName: string
): Promise<string> {
    try {
        const inputPath = path.join(outputDir, originalName);
        await fs.writeFile(inputPath, inputBuffer);

        // Run LibreOffice in headless mode
        // --outdir is required to specify where the PDF goes
        const cmd = `soffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;

        // Timeout after 30 seconds
        await execPromise(cmd, { timeout: 30000 });

        const baseName = path.basename(originalName, path.extname(originalName));
        const pdfPath = path.join(outputDir, `${baseName}.pdf`);

        // Check if file exists
        await fs.access(pdfPath);

        // Clean up input file
        await fs.unlink(inputPath).catch(() => { });

        return pdfPath;
    } catch (error: any) {
        console.error(`[DocumentProcessor] PDF conversion error: ${error.message}`);
        throw new Error(`PDF conversion failed: ${error.message}`);
    }
}
