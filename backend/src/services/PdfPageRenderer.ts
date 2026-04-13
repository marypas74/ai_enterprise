/**
 * PdfPageRenderer — Converte pagine PDF in immagini base64.
 * Thin wrapper attorno a convertPdfToImages (mupdf WASM, già disponibile).
 */
import { convertPdfToImages } from './document-processing/PDFConversionService.js';

export class PdfPageRenderer {
  static async renderToBase64(
    buffer: Buffer,
    maxPages = 50,
    dpi = 150,
  ): Promise<string[]> {
    const pagesSpec = `1-${maxPages}`;
    const images = await convertPdfToImages(buffer, 'png', dpi, pagesSpec);
    // slice as safety net: cap rendering at source via pagesSpec, then double-check
    return images.slice(0, maxPages).map(img => img.buffer.toString('base64'));
  }
}
