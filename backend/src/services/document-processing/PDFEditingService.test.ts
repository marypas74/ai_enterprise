import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addTextToPdf, addWatermark, removePdfPages, addImageToPdf } from './PDFEditingService.js';

async function createTestPdf(pageCount = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 20 });
  }
  return Buffer.from(await doc.save());
}

describe('PDFEditingService', () => {
  let testPdf: Buffer;

  beforeAll(async () => {
    testPdf = await createTestPdf(3);
  });

  describe('addTextToPdf', () => {
    it('adds text to specified page and returns valid PDF', async () => {
      const result = await addTextToPdf(testPdf, 1, 100, 500, 'Hello World', 14);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });

    it('throws on invalid page number', async () => {
      await expect(addTextToPdf(testPdf, 5, 100, 500, 'text', 14)).rejects.toThrow('range');
    });
  });

  describe('addWatermark', () => {
    it('adds watermark to all pages', async () => {
      const result = await addWatermark(testPdf, 'DRAFT', 0.3);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });

    it('adds watermark to specific pages', async () => {
      const result = await addWatermark(testPdf, 'CONFIDENTIAL', 0.2, 45, '1,3');
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });
  });

  describe('removePdfPages', () => {
    it('removes specified pages', async () => {
      const result = await removePdfPages(testPdf, '2');
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(2);
    });

    it('throws if removing all pages', async () => {
      await expect(removePdfPages(testPdf, '1-3')).rejects.toThrow('all pages');
    });
  });
});
