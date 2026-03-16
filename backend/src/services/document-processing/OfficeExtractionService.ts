/**
 * Office Extraction Service
 * Handles text extraction from DOCX, Excel, and PowerPoint files
 */

import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

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
