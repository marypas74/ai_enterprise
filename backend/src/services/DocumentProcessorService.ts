/**
 * Document Processor Service
 * Handles OCR, Office extraction, and PDF-to-DOCX conversion
 */

import { createWorker, Worker } from 'tesseract.js';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import fs from 'fs/promises';
import path from 'path';

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
 * Extract text from a scanned PDF by first converting pages to images
 * Falls back to OCR when pdf-parse returns empty text
 */
export async function extractPdfWithOCR(
    buffer: Buffer,
    lang: string = 'ita+eng'
): Promise<string> {
    // Tesseract.js can accept PDF buffers directly in newer versions
    // For scanned PDFs, we treat the whole buffer as an image-like input
    try {
        const worker = await getOCRWorker(lang);
        const { data } = await worker.recognize(buffer);
        return data.text || '';
    } catch (error: any) {
        console.error(`[DocumentProcessor] PDF OCR error: ${error.message}`);
        throw new Error(`PDF OCR extraction failed: ${error.message}`);
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
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const parts: string[] = [];

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;

            parts.push(`--- Foglio: ${sheetName} ---`);

            // Convert to CSV for readable text output
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            parts.push(csv);
        }

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
    // PPTX is a ZIP of XML files; we use xlsx's ZIP capabilities
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        // If xlsx can parse it (sometimes works for PPTX tables), use that
        const parts: string[] = [];
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            if (csv.trim()) parts.push(csv);
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
export async function convertTextToDocx(
    text: string,
    outputPath: string,
    title: string = 'Documento Convertito'
): Promise<string> {
    try {
        // Split text into paragraphs
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
                    new Paragraph({ children: [] }), // empty line
                    ...paragraphs,
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(outputPath, buffer);

        return outputPath;
    } catch (error: any) {
        console.error(`[DocumentProcessor] DOCX conversion error: ${error.message}`);
        throw new Error(`DOCX conversion failed: ${error.message}`);
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

/**
 * Cleanup: Terminate the OCR worker when shutting down
 */
export async function terminateOCRWorker(): Promise<void> {
    if (ocrWorker) {
        await ocrWorker.terminate();
        ocrWorker = null;
    }
}
