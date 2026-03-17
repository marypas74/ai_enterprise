import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdfs, splitPdf, parsePagesSpec, rotatePdfPages, reorderPdfPages, getPdfInfo } from './PDFManipulationService.js';

// Helper: create a minimal valid PDF buffer
async function createTestPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 20 });
  }
  return Buffer.from(await doc.save());
}

describe('PDFManipulationService', () => {
  let singlePagePdf: Buffer;
  let threePagePdf: Buffer;

  beforeAll(async () => {
    singlePagePdf = await createTestPdf(1);
    threePagePdf = await createTestPdf(3);
  });

  describe('parsePagesSpec', () => {
    it('parses single pages and ranges', () => {
      expect(parsePagesSpec('1,3,5', 10)).toEqual([0, 2, 4]);
    });

    it('parses ranges', () => {
      expect(parsePagesSpec('1-3', 10)).toEqual([0, 1, 2]);
    });

    it('parses mixed', () => {
      expect(parsePagesSpec('1,3-5,7', 10)).toEqual([0, 2, 3, 4, 6]);
    });

    it('throws on out-of-range page', () => {
      expect(() => parsePagesSpec('11', 10)).toThrow('out of range');
    });

    it('throws on invalid format', () => {
      expect(() => parsePagesSpec('abc', 10)).toThrow();
    });
  });

  describe('mergePdfs', () => {
    it('merges two single-page PDFs into one two-page PDF', async () => {
      const result = await mergePdfs([singlePagePdf, singlePagePdf]);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(2);
    });

    it('merges a 3-page and 1-page PDF', async () => {
      const result = await mergePdfs([threePagePdf, singlePagePdf]);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(4);
    });

    it('throws on empty input', async () => {
      await expect(mergePdfs([])).rejects.toThrow('at least 2');
    });

    it('throws on single input', async () => {
      await expect(mergePdfs([singlePagePdf])).rejects.toThrow('at least 2');
    });
  });

  describe('splitPdf', () => {
    it('extracts pages 1 and 3 from a 3-page PDF', async () => {
      const result = await splitPdf(threePagePdf, '1,3');
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(2);
    });

    it('extracts a range', async () => {
      const result = await splitPdf(threePagePdf, '2-3');
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(2);
    });

    it('throws on invalid page', async () => {
      await expect(splitPdf(threePagePdf, '5')).rejects.toThrow('out of range');
    });
  });

  describe('rotatePdfPages', () => {
    it('rotates specified pages by 90 degrees', async () => {
      const result = await rotatePdfPages(threePagePdf, '1', 90);
      const doc = await PDFDocument.load(result);
      const page = doc.getPage(0);
      expect(page.getRotation().angle).toBe(90);
    });

    it('does not rotate unspecified pages', async () => {
      const result = await rotatePdfPages(threePagePdf, '1', 90);
      const doc = await PDFDocument.load(result);
      expect(doc.getPage(1).getRotation().angle).toBe(0);
    });

    it('throws on invalid degrees', async () => {
      await expect(rotatePdfPages(threePagePdf, '1', 45 as any)).rejects.toThrow('degrees');
    });
  });

  describe('reorderPdfPages', () => {
    it('reorders pages in specified order', async () => {
      const result = await reorderPdfPages(threePagePdf, [3, 1, 2]);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });

    it('throws on invalid page numbers', async () => {
      await expect(reorderPdfPages(threePagePdf, [1, 2, 5])).rejects.toThrow('out of range');
    });

    it('throws on duplicate pages', async () => {
      await expect(reorderPdfPages(threePagePdf, [1, 1, 2])).rejects.toThrow('duplicate');
    });
  });

  describe('getPdfInfo', () => {
    it('returns page count and dimensions', async () => {
      const info = await getPdfInfo(threePagePdf);
      expect(info.pageCount).toBe(3);
      expect(info.pages).toHaveLength(3);
      expect(info.pages[0]).toHaveProperty('width');
      expect(info.pages[0]).toHaveProperty('height');
    });

    it('returns file size', async () => {
      const info = await getPdfInfo(threePagePdf);
      expect(info.fileSizeBytes).toBe(threePagePdf.length);
    });
  });
});
