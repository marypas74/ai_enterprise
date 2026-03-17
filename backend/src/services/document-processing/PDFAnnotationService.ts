/**
 * PDFAnnotationService — PDF annotation operations using mupdf
 * Provides: highlight, underline, strikethrough, sticky notes, stamps, remove annotations
 */
import * as mupdf from 'mupdf';

function openPdfDocument(buffer: Buffer): mupdf.PDFDocument {
  return mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument;
}

function validatePage(doc: mupdf.PDFDocument, pageIndex: number): mupdf.PDFPage {
  if (pageIndex < 0 || pageIndex >= doc.countPages()) {
    throw new Error(`Page ${pageIndex} out of range (0-${doc.countPages() - 1})`);
  }
  return doc.loadPage(pageIndex) as mupdf.PDFPage;
}

function saveAndReturn(doc: mupdf.PDFDocument): Buffer {
  const result = Buffer.from(doc.saveToBuffer('incremental').asUint8Array());
  doc.destroy();
  return result;
}

/**
 * Highlight text on a PDF page.
 */
export async function highlightText(
  buffer: Buffer,
  pageIndex: number,
  searchText: string,
  color: [number, number, number] = [1, 1, 0],
): Promise<Buffer> {
  const doc = openPdfDocument(buffer);
  const page = validatePage(doc, pageIndex);
  const hits = page.search(searchText);

  if (hits.length === 0) {
    doc.destroy();
    throw new Error(`Text "${searchText}" not found on page ${pageIndex}`);
  }

  for (const quads of hits) {
    const annot = page.createAnnotation('Highlight');
    annot.setColor(color);
    annot.setQuadPoints(quads);
    annot.update();
  }

  return saveAndReturn(doc);
}

/**
 * Add a sticky note at a position on a PDF page.
 */
export async function addStickyNote(
  buffer: Buffer,
  pageIndex: number,
  x: number,
  y: number,
  text: string,
): Promise<Buffer> {
  const doc = openPdfDocument(buffer);
  const page = validatePage(doc, pageIndex);

  const annot = page.createAnnotation('Text');
  annot.setRect([x, y, x + 24, y + 24]);
  annot.setContents(text);
  annot.setColor([1, 0.85, 0]);
  annot.update();

  return saveAndReturn(doc);
}

/**
 * Add a stamp annotation to a PDF page.
 */
export async function addStamp(
  buffer: Buffer,
  pageIndex: number,
  stampType: string,
  x: number,
  y: number,
): Promise<Buffer> {
  const doc = openPdfDocument(buffer);
  const page = validatePage(doc, pageIndex);

  const annot = page.createAnnotation('Stamp');
  annot.setRect([x, y, x + 200, y + 50]);
  annot.setIcon(stampType);
  annot.update();

  return saveAndReturn(doc);
}

/**
 * Underline text on a PDF page.
 */
export async function underlineText(
  buffer: Buffer,
  pageIndex: number,
  searchText: string,
  color: [number, number, number] = [0, 0, 1],
): Promise<Buffer> {
  const doc = openPdfDocument(buffer);
  const page = validatePage(doc, pageIndex);
  const hits = page.search(searchText);

  if (hits.length === 0) {
    doc.destroy();
    throw new Error(`Text "${searchText}" not found on page ${pageIndex}`);
  }

  for (const quads of hits) {
    const annot = page.createAnnotation('Underline');
    annot.setColor(color);
    annot.setQuadPoints(quads);
    annot.update();
  }

  return saveAndReturn(doc);
}

/**
 * Strikethrough text on a PDF page.
 */
export async function strikethroughText(
  buffer: Buffer,
  pageIndex: number,
  searchText: string,
  color: [number, number, number] = [1, 0, 0],
): Promise<Buffer> {
  const doc = openPdfDocument(buffer);
  const page = validatePage(doc, pageIndex);
  const hits = page.search(searchText);

  if (hits.length === 0) {
    doc.destroy();
    throw new Error(`Text "${searchText}" not found on page ${pageIndex}`);
  }

  for (const quads of hits) {
    const annot = page.createAnnotation('StrikeOut');
    annot.setColor(color);
    annot.setQuadPoints(quads);
    annot.update();
  }

  return saveAndReturn(doc);
}

/**
 * Remove all annotations from a PDF page.
 */
export async function removeAnnotations(
  buffer: Buffer,
  pageIndex: number,
): Promise<Buffer> {
  const doc = openPdfDocument(buffer);
  const page = validatePage(doc, pageIndex);

  let annots = page.getAnnotations();
  while (annots.length > 0) {
    page.deleteAnnotation(annots[annots.length - 1]);
    annots = page.getAnnotations();
  }

  return saveAndReturn(doc);
}
