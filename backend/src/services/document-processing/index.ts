/**
 * Document Processing - Module index
 * Re-exports all document processing services
 */

export {
    extractWithOCR,
    extractPdfWithOCR,
    terminateOCRWorker,
} from './OCRService.js';

export {
    extractDocxContent,
    extractExcelContent,
    extractPptxContent,
    extractOfficeContent,
} from './OfficeExtractionService.js';

export {
    generateDocxBuffer,
    generateExcelBuffer,
    generatePptxBuffer,
    parseSlideContent,
    convertTextToDocx,
    convertDataToXlsx,
    convertSlidesToPptx,
} from './DocumentGenerationService.js';

export {
    convertOfficeToPdf,
    convertPdfToDocx,
} from './ConversionService.js';

export {
  mergePdfs,
  splitPdf,
  rotatePdfPages,
  reorderPdfPages,
  compressPdf,
  getPdfInfo,
  parsePagesSpec,
  type PdfInfo,
  type PdfPageInfo,
} from './PDFManipulationService.js';

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
  type PageImage,
  type TextBlock,
  type ImageInput,
} from './PDFConversionService.js';

export {
  addTextToPdf,
  addImageToPdf,
  addWatermark,
  removePdfPages,
  findAndReplaceText,
} from './PDFEditingService.js';

export {
  highlightText,
  addStickyNote,
  addStamp,
  underlineText,
  strikethroughText,
  removeAnnotations,
} from './PDFAnnotationService.js';

export {
  addFormField,
  fillFormFields,
  extractFormData,
  detectFormFields,
} from './PDFFormService.js';

export {
  protectPdf,
  unlockPdf,
  redactAreas,
  smartRedactRegex,
} from './PDFSecurityService.js';

export {
  generateSelfSignedCertificate,
  encryptPrivateKey,
  decryptPrivateKey,
  signPdfSimple,
  signPdfCertified,
  verifySignatures,
} from './PDFSignatureService.js';

export {
  isOllamaVisionAvailable,
  analyzeImageWithVision,
} from './OllamaVisionHelper.js';

export {
  getCachedOCR,
  setCachedOCR,
  clearOCRCache,
} from './OCRCacheService.js';

export {
  acquireLock,
  releaseLock,
  getLockStatus,
  getActiveLockCount,
} from './PDFLockService.js';
