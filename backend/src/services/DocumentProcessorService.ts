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
    const { execFile: execFileCb } = await import('child_process');
    const execFileAsync = promisify(execFileCb);

    const tmpId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(os.tmpdir(), `pdf_ocr_${tmpId}`);
    const tmpPdf = path.join(tmpDir, 'input.pdf');

    console.log(`[DocumentProcessor] PDF OCR: creating temp dir ${tmpDir}`);
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(tmpPdf, buffer);

    try {
        // Convert PDF pages to PNG images at 300 DPI using pdftoppm
        console.log(`[DocumentProcessor] PDF OCR: running pdftoppm for ${buffer.length} bytes`);
        // H-02: Use execFile instead of exec to prevent shell injection
        await execFileAsync('pdftoppm', ['-png', '-r', '300', tmpPdf, `${tmpDir}/page`], { timeout: 120000 });

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
 * Generate a professional PowerPoint buffer from slides
 * @param slides Array of { title, content }
 * @param title Presentation title
 */
export async function generatePptxBuffer(
    slides: { title: string; content: string }[],
    title: string = 'Presentazione'
): Promise<Buffer> {
    try {
        const pptx = new (PptxGenJS as any)();

        // Professional color palette
        const COLORS = {
            primary: '1B3A5C',      // Dark blue
            secondary: '2E6BA6',     // Medium blue
            accent: '4A90D9',        // Light blue
            text: '2D2D2D',          // Near-black for body text
            textLight: '5A5A5A',     // Gray for subtitles
            background: 'FFFFFF',    // White
            headerBg: '1B3A5C',     // Header background
            footerText: '8C8C8C',   // Light gray for footer
            bulletColor: '2E6BA6',   // Blue bullets
        };

        // Layout constants (inches) — proper margins for professional look
        const MARGIN = {
            left: 0.8,
            right: 0.8,
            top: 0.6,
            bottom: 0.8,
        };
        const CONTENT_WIDTH = 10 - MARGIN.left - MARGIN.right; // ~8.4"
        const SLIDE_HEIGHT = 5.63; // Standard 16:9 slide height

        // Metadata
        pptx.author = 'Enterprise AI Chat';
        pptx.company = 'Enterprise AI';
        pptx.subject = title;
        pptx.title = title;
        pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 — standard widescreen

        // --- Title Slide ---
        const titleSlide = pptx.addSlide();
        // Blue accent bar at top
        titleSlide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: 0.15,
            fill: { color: COLORS.primary }
        });
        // Blue accent bar at bottom
        titleSlide.addShape('rect', {
            x: 0, y: 6.9, w: '100%', h: 0.6,
            fill: { color: COLORS.primary }
        });
        // Title
        titleSlide.addText(title, {
            x: MARGIN.left, y: 2.0, w: CONTENT_WIDTH, h: 1.5,
            fontSize: 36, fontFace: 'Calibri', bold: true,
            color: COLORS.primary, align: 'center', valign: 'middle'
        });
        // Decorative line under title
        titleSlide.addShape('rect', {
            x: 3.5, y: 3.6, w: 3.3, h: 0.04,
            fill: { color: COLORS.accent }
        });
        // Subtitle
        titleSlide.addText('Generato da Enterprise AI', {
            x: MARGIN.left, y: 4.0, w: CONTENT_WIDTH, h: 0.6,
            fontSize: 16, fontFace: 'Calibri',
            color: COLORS.textLight, align: 'center'
        });
        // Date in footer bar
        const dateStr = new Date().toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' });
        titleSlide.addText(dateStr, {
            x: MARGIN.left, y: 7.0, w: CONTENT_WIDTH, h: 0.4,
            fontSize: 11, fontFace: 'Calibri',
            color: 'FFFFFF', align: 'center'
        });

        // --- Content Slides ---
        const totalSlides = slides.length;
        for (let idx = 0; idx < totalSlides; idx++) {
            const slideData = slides[idx];
            const slide = pptx.addSlide();

            // Top colored header bar
            slide.addShape('rect', {
                x: 0, y: 0, w: '100%', h: 1.1,
                fill: { color: COLORS.primary }
            });

            // Slide title (white on blue header)
            slide.addText(slideData.title, {
                x: MARGIN.left, y: 0.15, w: CONTENT_WIDTH - 1, h: 0.8,
                fontSize: 22, fontFace: 'Calibri', bold: true,
                color: 'FFFFFF', valign: 'middle'
            });

            // Parse content into structured bullet items
            const contentItems = parseSlideContent(slideData.content);

            // Content area with proper margins
            const contentY = 1.4;
            const contentH = SLIDE_HEIGHT - contentY - MARGIN.bottom;

            if (contentItems.length > 0) {
                // Build text array for PptxGenJS with proper bullet formatting
                const textRows: any[] = [];
                for (const item of contentItems) {
                    const indent = item.level * 0.3;
                    const bulletChar = item.level === 0 ? '●' : item.level === 1 ? '○' : '–';
                    const fontSize = item.level === 0 ? 14 : 13;

                    textRows.push({
                        text: item.text,
                        options: {
                            fontSize,
                            fontFace: 'Calibri',
                            color: COLORS.text,
                            bullet: { code: bulletChar.charCodeAt(0).toString(16), indent: indent },
                            indentLevel: item.level,
                            paraSpaceAfter: 6,
                            paraSpaceBefore: item.level === 0 ? 4 : 0,
                        }
                    });
                }

                slide.addText(textRows, {
                    x: MARGIN.left, y: contentY, w: CONTENT_WIDTH, h: contentH,
                    valign: 'top', shrinkText: true
                });
            } else {
                // Plain text fallback
                slide.addText(slideData.content, {
                    x: MARGIN.left, y: contentY, w: CONTENT_WIDTH, h: contentH,
                    fontSize: 14, fontFace: 'Calibri', color: COLORS.text,
                    align: 'left', valign: 'top', paraSpaceAfter: 6
                });
            }

            // Thin accent line above footer
            slide.addShape('rect', {
                x: MARGIN.left, y: 6.95, w: CONTENT_WIDTH, h: 0.02,
                fill: { color: COLORS.accent }
            });

            // Footer: slide number
            slide.addText(`${idx + 1} / ${totalSlides}`, {
                x: CONTENT_WIDTH - 0.5, y: 7.05, w: 1.5, h: 0.35,
                fontSize: 10, fontFace: 'Calibri',
                color: COLORS.footerText, align: 'right'
            });

            // Footer: title reference
            slide.addText(title, {
                x: MARGIN.left, y: 7.05, w: 4, h: 0.35,
                fontSize: 10, fontFace: 'Calibri',
                color: COLORS.footerText, align: 'left'
            });
        }

        return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
    } catch (error: any) {
        console.error(`[DocumentProcessor] PPTX generation error: ${error.message}`);
        throw new Error(`PPTX generation failed: ${error.message}`);
    }
}

/**
 * Parse slide content text into structured bullet items with indentation levels
 */
function parseSlideContent(content: string): { text: string; level: number }[] {
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length <= 1) return [];

    const items: { text: string; level: number }[] = [];
    for (const raw of lines) {
        const line = raw.trimEnd();
        // Detect indentation level from leading whitespace, bullets, or dashes
        const leadingMatch = line.match(/^(\s*)([-•●○▪▸►*]\s*|\d+[.)]\s*)?(.+)/);
        if (!leadingMatch) continue;

        const whitespace = leadingMatch[1] || '';
        const bulletPrefix = leadingMatch[2] || '';
        const text = leadingMatch[3].trim();
        if (!text) continue;

        // Determine indent level: 0=top, 1=sub, 2=sub-sub
        let level = 0;
        const totalIndent = whitespace.length + (bulletPrefix ? 1 : 0);
        if (totalIndent >= 6) level = 2;
        else if (totalIndent >= 2) level = 1;

        items.push({ text, level });
    }
    return items;
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
    method: 'pdf-parse' | 'ocr' | 'vision-ocr' | 'mammoth' | 'xlsx' | 'pptx' | 'text-read' | 'unknown';
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
    // Images → Vision OCR (with Tesseract fallback)
    if (mimeType.startsWith('image/')) {
        try {
            const { VisionService } = await import('./VisionService.js');
            const vision = VisionService.getInstance();
            if (await vision.isAvailable()) {
                const result = await vision.analyzeDocument(buffer, mimeType);
                if (result.text.trim().length > 10) {
                    return { text: result.text, method: 'vision-ocr', charCount: result.text.length };
                }
            }
        } catch (err: any) {
            console.warn(`[DocumentProcessor] Vision OCR failed for image, falling back to Tesseract: ${err.message}`);
        }
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

    // PDF -> pdf-parse (with Vision OCR fallback, then Tesseract fallback)
    if (mimeType === 'application/pdf') {
        const { extractPdfText } = await import('../modules/attachments/routes.js');
        let text: string = await extractPdfText(buffer);
        let method: ProcessResult['method'] = 'pdf-parse';

        // Check if text is too sparse or just markers
        const markerPattern = /-- \d+ of \d+ --/g;
        const cleanedText = text.replace(markerPattern, '').trim();

        if (cleanedText.length < 20) {
            console.log(`[DocumentProcessor] PDF text too sparse (${cleanedText.length} chars) for ${originalName}, trying Vision OCR...`);

            // Try Vision OCR first (much better quality than Tesseract)
            try {
                const { VisionService } = await import('./VisionService.js');
                const vision = VisionService.getInstance();
                if (await vision.isAvailable()) {
                    const visionResult = await vision.analyzeDocument(buffer, mimeType);
                    if (visionResult.text.trim().length > 20) {
                        console.log(`[DocumentProcessor] Vision OCR extracted ${visionResult.text.length} chars using ${visionResult.model} (${visionResult.pages} pages)`);
                        text = visionResult.text;
                        method = 'vision-ocr';
                    }
                }
            } catch (visionErr: any) {
                console.warn(`[DocumentProcessor] Vision OCR failed: ${visionErr.message}`);
            }

            // If Vision OCR also failed, fall back to Tesseract
            if (method === 'pdf-parse' && cleanedText.length < 20) {
                try {
                    const ocrText = await extractPdfWithOCR(buffer);
                    if (ocrText.trim()) {
                        text = ocrText;
                        method = 'ocr';
                    }
                } catch (ocrErr: any) {
                    console.warn(`[DocumentProcessor] Tesseract OCR fallback failed: ${ocrErr.message}`);
                }
            }
        }
        return { text, method, charCount: text.length };
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

/**
 * Convert a PDF to DOCX preserving layout, tables, and images.
 * Uses pdf2docx (Python/PyMuPDF) as primary method, falls back to LibreOffice writer_pdf_import.
 * @param inputBuffer Buffer of the PDF file
 * @param outputDir Directory for temporary and output files
 * @param originalName Original filename (e.g. "document.pdf")
 * @returns Buffer of the generated DOCX file
 */
export async function convertPdfToDocx(
    inputBuffer: Buffer,
    outputDir: string,
    originalName: string
): Promise<Buffer> {
    const baseName = path.basename(originalName, path.extname(originalName));
    const inputPath = path.join(outputDir, `_pdf2docx_${Date.now()}_${baseName}.pdf`);
    const docxPath = path.join(outputDir, `_pdf2docx_${Date.now()}_${baseName}.docx`);

    await fs.writeFile(inputPath, inputBuffer);

    try {
        // Primary: pdf2docx (best quality — preserves tables, images, layout)
        const pyScript = `from pdf2docx import Converter; cv = Converter(r'${inputPath}'); cv.convert(r'${docxPath}'); cv.close()`;
        await execPromise(`python3 -c "${pyScript}"`, { timeout: 120000 });
        await fs.access(docxPath);
        console.log(`[DocumentProcessor] PDF→DOCX via pdf2docx: ${originalName}`);
    } catch (pdf2docxErr: any) {
        console.warn(`[DocumentProcessor] pdf2docx failed (${pdf2docxErr.message}), trying LibreOffice...`);

        // Fallback: LibreOffice writer_pdf_import
        try {
            const loCmd = `soffice --headless --infilter="writer_pdf_import" --convert-to docx:"MS Word 2007 XML" --outdir "${outputDir}" "${inputPath}"`;
            await execPromise(loCmd, { timeout: 60000 });
            // LibreOffice outputs with the input basename
            const loBaseName = path.basename(inputPath, '.pdf');
            const loDocxPath = path.join(outputDir, `${loBaseName}.docx`);
            await fs.access(loDocxPath);
            // Rename to expected path if different
            if (loDocxPath !== docxPath) {
                await fs.rename(loDocxPath, docxPath);
            }
            console.log(`[DocumentProcessor] PDF→DOCX via LibreOffice: ${originalName}`);
        } catch (loErr: any) {
            // Clean up
            await fs.unlink(inputPath).catch(() => {});
            await fs.unlink(docxPath).catch(() => {});
            console.error(`[DocumentProcessor] All PDF→DOCX methods failed: ${loErr.message}`);
            throw new Error(`PDF to DOCX conversion failed: pdf2docx error: ${pdf2docxErr.message}, LibreOffice error: ${loErr.message}`);
        }
    }

    // Read result and clean up temp files
    const docxBuffer = await fs.readFile(docxPath);
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(docxPath).catch(() => {});
    return docxBuffer;
}
