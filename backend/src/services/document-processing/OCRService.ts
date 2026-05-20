/**
 * OCR Service
 * Handles text extraction from images and scanned PDFs using Tesseract.js
 */

import { createWorker, createScheduler, Worker } from 'tesseract.js';
import fs from 'fs/promises';
import path from 'path';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[DocumentProcessor] PDF OCR error: ${error.message}`);
        throw new Error(`PDF OCR extraction failed: ${error.message}`);
    } finally {
        // Cleanup temp directory
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function terminateOCRWorker(): Promise<void> {
    if (ocrWorker) {
        await ocrWorker.terminate();
        ocrWorker = null;
    }
}
