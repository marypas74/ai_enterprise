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
