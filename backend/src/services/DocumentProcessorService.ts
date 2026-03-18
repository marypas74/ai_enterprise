/**
 * Document Processor Service
 * Orchestrator that dispatches document processing to specialized services.
 *
 * Individual services are in ./document-processing/:
 * - OCRService.ts — Tesseract.js OCR
 * - OfficeExtractionService.ts — DOCX/Excel/PPTX text extraction
 * - DocumentGenerationService.ts — DOCX/Excel/PPTX generation
 * - ConversionService.ts — LibreOffice-based conversions
 */

// Re-export everything from sub-modules for backward compatibility
export {
    extractWithOCR,
    extractPdfWithOCR,
    terminateOCRWorker,
} from './document-processing/OCRService.js';

export {
    extractDocxContent,
    extractExcelContent,
    extractPptxContent,
    extractOfficeContent,
} from './document-processing/OfficeExtractionService.js';

export {
    generateDocxBuffer,
    generateExcelBuffer,
    generatePptxBuffer,
    parseSlideContent,
    convertTextToDocx,
    convertDataToXlsx,
    convertSlidesToPptx,
} from './document-processing/DocumentGenerationService.js';

export {
    convertOfficeToPdf,
    convertPdfToDocx,
} from './document-processing/ConversionService.js';

export {
  mergePdfs,
  splitPdf,
  rotatePdfPages,
  reorderPdfPages,
  compressPdf,
  getPdfInfo,
  parsePagesSpec,
} from './document-processing/PDFManipulationService.js';

export {
  renderPageToImage,
  convertPdfToImages,
  extractStructuredText,
  convertPdfToDocxSmart,
  convertPdfToDocxOcr,
  convertPdfToDocxLayout,
  convertPdfToXlsx,
  convertPdfToPptx,
  convertImagesToPdf,
} from './document-processing/PDFConversionService.js';

export {
  addTextToPdf,
  addImageToPdf,
  addWatermark,
  removePdfPages,
  findAndReplaceText,
} from './document-processing/PDFEditingService.js';

export {
  highlightText,
  addStickyNote,
  addStamp,
  underlineText,
  strikethroughText,
  removeAnnotations,
} from './document-processing/PDFAnnotationService.js';

export {
  addFormField,
  fillFormFields,
  extractFormData,
  detectFormFields,
} from './document-processing/PDFFormService.js';

export {
  protectPdf,
  unlockPdf,
  redactAreas,
  smartRedactRegex,
} from './document-processing/PDFSecurityService.js';

export {
  generateSelfSignedCertificate,
  encryptPrivateKey,
  decryptPrivateKey,
  signPdfSimple,
  signPdfCertified,
  verifySignatures,
} from './document-processing/PDFSignatureService.js';

// Import what processDocument needs
import { extractWithOCR, extractPdfWithOCR } from './document-processing/OCRService.js';
import { extractOfficeContent } from './document-processing/OfficeExtractionService.js';

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
