import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';

/**
 * Parse a page specification string like "1,3-5,7" into zero-based page indices.
 * Validates against totalPages.
 */
export function parsePagesSpec(spec: string, totalPages: number): number[] {
  const indices: number[] = [];
  const parts = spec.split(',').map(s => s.trim());

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start < 1 || end > totalPages || start > end) {
        throw new Error(`Page range ${part} out of range (1-${totalPages})`);
      }
      for (let i = start; i <= end; i++) {
        indices.push(i - 1);
      }
    } else {
      const page = parseInt(part, 10);
      if (isNaN(page)) {
        throw new Error(`Invalid page specification: ${part}`);
      }
      if (page < 1 || page > totalPages) {
        throw new Error(`Page ${page} out of range (1-${totalPages})`);
      }
      indices.push(page - 1);
    }
  }

  return indices;
}

/**
 * Merge multiple PDF buffers into a single PDF.
 * Returns the merged PDF as a Buffer.
 */
export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length < 2) {
    throw new Error('mergePdfs requires at least 2 PDF buffers');
  }

  const merged = await PDFDocument.create();

  for (const buf of buffers) {
    const source = await PDFDocument.load(buf);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  return Buffer.from(await merged.save());
}

/**
 * Extract specific pages from a PDF.
 * @param pagesSpec - Page specification like "1,3-5,7" (1-based)
 * Returns a new PDF buffer with only the specified pages.
 */
export async function splitPdf(buffer: Buffer, pagesSpec: string): Promise<Buffer> {
  const source = await PDFDocument.load(buffer);
  const totalPages = source.getPageCount();
  const indices = parsePagesSpec(pagesSpec, totalPages);

  const result = await PDFDocument.create();
  const pages = await result.copyPages(source, indices);
  for (const page of pages) {
    result.addPage(page);
  }

  return Buffer.from(await result.save());
}

// --- Types ---

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfInfo {
  pageCount: number;
  fileSizeBytes: number;
  title: string | undefined;
  author: string | undefined;
  subject: string | undefined;
  creator: string | undefined;
  creationDate: Date | undefined;
  modificationDate: Date | undefined;
  pages: PdfPageInfo[];
}

const VALID_DEGREES = [90, 180, 270] as const;
type RotationDegrees = typeof VALID_DEGREES[number];

/**
 * Rotate specific pages in a PDF by the given degrees (90, 180, 270).
 */
export async function rotatePdfPages(
  buffer: Buffer,
  pagesSpec: string,
  degreesVal: RotationDegrees
): Promise<Buffer> {
  if (!VALID_DEGREES.includes(degreesVal)) {
    throw new Error(`Invalid degrees: ${degreesVal}. Must be 90, 180, or 270`);
  }

  const doc = await PDFDocument.load(buffer);
  const totalPages = doc.getPageCount();
  const indices = parsePagesSpec(pagesSpec, totalPages);

  for (const idx of indices) {
    const page = doc.getPage(idx);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + degreesVal) % 360));
  }

  return Buffer.from(await doc.save());
}

/**
 * Reorder pages in a PDF. Order is 1-based page numbers.
 * Example: [3, 1, 2] moves page 3 first, then page 1, then page 2.
 */
export async function reorderPdfPages(buffer: Buffer, order: number[]): Promise<Buffer> {
  const source = await PDFDocument.load(buffer);
  const totalPages = source.getPageCount();

  const seen = new Set<number>();
  for (const pageNum of order) {
    if (pageNum < 1 || pageNum > totalPages) {
      throw new Error(`Page ${pageNum} out of range (1-${totalPages})`);
    }
    if (seen.has(pageNum)) {
      throw new Error(`Page ${pageNum} is duplicate in order`);
    }
    seen.add(pageNum);
  }

  const result = await PDFDocument.create();
  const indices = order.map(p => p - 1);
  const pages = await result.copyPages(source, indices);
  for (const page of pages) {
    result.addPage(page);
  }

  return Buffer.from(await result.save());
}

/**
 * Get metadata and page information from a PDF.
 */
export async function getPdfInfo(buffer: Buffer): Promise<PdfInfo> {
  const doc = await PDFDocument.load(buffer);

  const pages: PdfPageInfo[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    pages.push({
      pageNumber: i + 1,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      rotation: page.getRotation().angle,
    });
  }

  return {
    pageCount: doc.getPageCount(),
    fileSizeBytes: buffer.length,
    title: doc.getTitle(),
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    creator: doc.getCreator(),
    creationDate: doc.getCreationDate(),
    modificationDate: doc.getModificationDate(),
    pages,
  };
}

type CompressionQuality = 'low' | 'medium' | 'high';

/**
 * Compress a PDF by stripping metadata and unused objects.
 * Phase 1: metadata/annotation cleanup only. Image re-encoding deferred to Phase 2 (requires mupdf).
 */
export async function compressPdf(buffer: Buffer, quality: CompressionQuality): Promise<Buffer> {
  const validQualities: CompressionQuality[] = ['low', 'medium', 'high'];
  if (!validQualities.includes(quality)) {
    throw new Error(`Invalid quality: ${quality}. Must be low, medium, or high`);
  }

  const doc = await PDFDocument.load(buffer, { updateMetadata: false });

  if (quality === 'medium' || quality === 'low') {
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setCreator('');
    doc.setProducer('');
  }

  return Buffer.from(await doc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 100,
  }));
}
