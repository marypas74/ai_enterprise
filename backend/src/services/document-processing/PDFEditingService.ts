/**
 * PDFEditingService — PDF editing operations
 * Provides: addText, addImage, addWatermark, removePages, findAndReplace
 */
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { parsePagesSpec } from './PDFManipulationService.js';

/**
 * Add text to a specific position on a PDF page.
 * @param page - 1-based page number
 */
export async function addTextToPdf(
  buffer: Buffer,
  page: number,
  x: number,
  y: number,
  text: string,
  fontSize: number = 12,
  color?: { r: number; g: number; b: number }
): Promise<Buffer> {
  const doc = await PDFDocument.load(buffer);
  const totalPages = doc.getPageCount();
  if (page < 1 || page > totalPages) {
    throw new Error(`Page ${page} out of range (1-${totalPages})`);
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pdfPage = doc.getPage(page - 1);
  const c = color || { r: 0, g: 0, b: 0 };

  pdfPage.drawText(text, {
    x,
    y,
    size: fontSize,
    font,
    color: rgb(c.r, c.g, c.b),
  });

  return Buffer.from(await doc.save());
}

/**
 * Add an image to a specific position on a PDF page.
 * @param page - 1-based page number
 */
export async function addImageToPdf(
  buffer: Buffer,
  page: number,
  imageBuffer: Buffer,
  mimeType: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<Buffer> {
  const doc = await PDFDocument.load(buffer);
  const totalPages = doc.getPageCount();
  if (page < 1 || page > totalPages) {
    throw new Error(`Page ${page} out of range (1-${totalPages})`);
  }

  let pdfImage;
  if (mimeType === 'image/png') {
    pdfImage = await doc.embedPng(imageBuffer);
  } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    pdfImage = await doc.embedJpg(imageBuffer);
  } else {
    const sharp = (await import('sharp')).default;
    const pngBuffer = await sharp(imageBuffer).png().toBuffer();
    pdfImage = await doc.embedPng(pngBuffer);
  }

  const pdfPage = doc.getPage(page - 1);
  pdfPage.drawImage(pdfImage, { x, y, width, height });

  return Buffer.from(await doc.save());
}

/**
 * Add a text watermark to PDF pages.
 */
export async function addWatermark(
  buffer: Buffer,
  text: string,
  opacity: number = 0.3,
  rotation: number = 45,
  pagesSpec?: string
): Promise<Buffer> {
  const doc = await PDFDocument.load(buffer);
  const totalPages = doc.getPageCount();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const indices = pagesSpec
    ? parsePagesSpec(pagesSpec, totalPages)
    : Array.from({ length: totalPages }, (_, i) => i);

  for (const idx of indices) {
    const page = doc.getPage(idx);
    const { width, height } = page.getSize();
    const fontSize = Math.min(width, height) / 6;
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(0.7, 0.7, 0.7),
      opacity,
      rotate: degrees(rotation),
    });
  }

  return Buffer.from(await doc.save());
}

/**
 * Remove specified pages from a PDF.
 * @param pagesSpec - Pages to remove, e.g. "2,4-5"
 */
export async function removePdfPages(buffer: Buffer, pagesSpec: string): Promise<Buffer> {
  const source = await PDFDocument.load(buffer);
  const totalPages = source.getPageCount();
  const toRemove = new Set(parsePagesSpec(pagesSpec, totalPages));

  if (toRemove.size >= totalPages) {
    throw new Error('Cannot remove all pages from PDF');
  }

  const result = await PDFDocument.create();
  const keepIndices = Array.from({ length: totalPages }, (_, i) => i)
    .filter(i => !toRemove.has(i));
  const pages = await result.copyPages(source, keepIndices);
  for (const page of pages) {
    result.addPage(page);
  }

  return Buffer.from(await result.save());
}

/**
 * Find and replace text in a PDF using mupdf (renders and re-draws).
 * Note: This is a best-effort operation — PDF text editing is inherently lossy.
 */
export async function findAndReplaceText(
  buffer: Buffer,
  pageNum: number,
  searchText: string,
  replaceText: string,
): Promise<Buffer> {
  // Use mupdf to find text locations, then overlay replacement text
  const mupdf = await import('mupdf');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as any;

  if (pageNum < 1 || pageNum > doc.countPages()) {
    throw new Error(`Page ${pageNum} out of range (1-${doc.countPages()})`);
  }

  const page = doc.loadPage(pageNum - 1);
  const hits = page.search(searchText);

  if (hits.length === 0) {
    doc.destroy();
    throw new Error(`Text "${searchText}" not found on page ${pageNum}`);
  }

  doc.destroy();

  // Strategy: use pdf-lib to overlay white rectangle + new text at hit location
  const pdfDoc = await PDFDocument.load(buffer);
  const pdfPage = pdfDoc.getPage(pageNum - 1);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const quads of hits) {
    // Each hit is an array of quads (four [x,y] points)
    // Use the bounding box of the first quad
    if (quads.length >= 4) {
      const minX = Math.min(quads[0][0], quads[3][0]);
      const minY = Math.min(quads[0][1], quads[1][1]);
      const maxX = Math.max(quads[1][0], quads[2][0]);
      const maxY = Math.max(quads[2][1], quads[3][1]);

      // White out the old text
      pdfPage.drawRectangle({
        x: minX - 1,
        y: minY - 1,
        width: (maxX - minX) + 2,
        height: (maxY - minY) + 2,
        color: rgb(1, 1, 1),
      });

      // Draw replacement text
      const fontSize = Math.max(8, (maxY - minY) * 0.8);
      pdfPage.drawText(replaceText, {
        x: minX,
        y: minY + 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return Buffer.from(await pdfDoc.save());
}
