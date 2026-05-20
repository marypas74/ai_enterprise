/**
 * Conversion Service
 * Handles Office-to-PDF and PDF-to-DOCX conversions using LibreOffice
 */

import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFilePromise = util.promisify(execFile);

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

        // SECURITY: Use execFile with args array to prevent shell injection via filenames
        await execFilePromise('soffice', [
            '--headless', '--convert-to', 'pdf', '--outdir', outputDir, inputPath
        ], { timeout: 30000 });

        const baseName = path.basename(originalName, path.extname(originalName));
        const pdfPath = path.join(outputDir, `${baseName}.pdf`);

        // Check if file exists
        await fs.access(pdfPath);

        // Clean up input file
        await fs.unlink(inputPath).catch(() => { });

        return pdfPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
        // SECURITY: Use execFile with args array to prevent shell injection via filenames
        const pyScript = `from pdf2docx import Converter; import sys; cv = Converter(sys.argv[1]); cv.convert(sys.argv[2]); cv.close()`;
        await execFilePromise('python3', ['-c', pyScript, inputPath, docxPath], { timeout: 120000 });
        await fs.access(docxPath);
        console.log(`[DocumentProcessor] PDF→DOCX via pdf2docx: ${originalName}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (pdf2docxErr: any) {
        console.warn(`[DocumentProcessor] pdf2docx failed (${pdf2docxErr.message}), trying LibreOffice...`);

        // Fallback: LibreOffice writer_pdf_import
        try {
            // SECURITY: Use execFile with args array to prevent shell injection
            await execFilePromise('soffice', [
                '--headless', '--infilter=writer_pdf_import', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', outputDir, inputPath
            ], { timeout: 60000 });
            // LibreOffice outputs with the input basename
            const loBaseName = path.basename(inputPath, '.pdf');
            const loDocxPath = path.join(outputDir, `${loBaseName}.docx`);
            await fs.access(loDocxPath);
            // Rename to expected path if different
            if (loDocxPath !== docxPath) {
                await fs.rename(loDocxPath, docxPath);
            }
            console.log(`[DocumentProcessor] PDF→DOCX via LibreOffice: ${originalName}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
