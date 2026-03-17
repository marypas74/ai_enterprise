import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  renderPageToImage,
  convertPdfToImages,
  extractStructuredText,
  convertPdfToDocxSmart,
  convertPdfToDocxOcr,
  convertPdfToDocxLayout,
  convertPdfToXlsx,
  convertPdfToPptx,
  convertImagesToPdf,
} from './PDFConversionService.js';

// Mock processDocument to avoid Ollama/Tesseract dependency in tests
vi.mock('../DocumentProcessorService.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    processDocument: vi.fn().mockResolvedValue({
      text: 'Mocked OCR text from page',
      method: 'vision-ocr',
      charCount: 26,
    }),
  };
});

async function createTestPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 20 });
  }
  return Buffer.from(await doc.save());
}

describe('PDFConversionService', () => {
  let testPdf: Buffer;

  beforeAll(async () => {
    testPdf = await createTestPdf(2);
  });

  describe('renderPageToImage', () => {
    it('renders a page to PNG buffer', async () => {
      const png = await renderPageToImage(testPdf, 0, 'png', 72);
      expect(png).toBeInstanceOf(Buffer);
      expect(png.length).toBeGreaterThan(100);
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
    });

    it('renders a page to JPG buffer', async () => {
      const jpg = await renderPageToImage(testPdf, 0, 'jpg', 72);
      expect(jpg).toBeInstanceOf(Buffer);
      expect(jpg[0]).toBe(0xff);
      expect(jpg[1]).toBe(0xd8);
    });
  });

  describe('convertPdfToImages', () => {
    it('converts all pages to images', async () => {
      const images = await convertPdfToImages(testPdf, 'png', 72);
      expect(images).toHaveLength(2);
      expect(images[0].pageNumber).toBe(1);
      expect(images[1].pageNumber).toBe(2);
    });

    it('converts specific pages', async () => {
      const images = await convertPdfToImages(testPdf, 'png', 72, '1');
      expect(images).toHaveLength(1);
      expect(images[0].pageNumber).toBe(1);
    });
  });

  describe('extractStructuredText', () => {
    it('extracts text with position data from a PDF', async () => {
      const blocks = await extractStructuredText(testPdf, 0);
      expect(blocks).toBeInstanceOf(Array);
      const hasText = blocks.some(b => b.text.includes('Page'));
      expect(hasText).toBe(true);
    });
  });

  describe('convertPdfToDocxSmart', () => {
    it('returns a valid DOCX buffer', async () => {
      const docx = await convertPdfToDocxSmart(testPdf);
      expect(docx).toBeInstanceOf(Buffer);
      expect(docx[0]).toBe(0x50); // PK
      expect(docx[1]).toBe(0x4B);
    });
  });

  describe('convertPdfToDocxOcr', () => {
    it('returns a valid DOCX buffer via OCR pipeline', async () => {
      const docx = await convertPdfToDocxOcr(testPdf);
      expect(docx).toBeInstanceOf(Buffer);
      expect(docx[0]).toBe(0x50);
    });
  });

  describe('convertPdfToDocxLayout', () => {
    it('returns a valid DOCX buffer with images', async () => {
      const docx = await convertPdfToDocxLayout(testPdf);
      expect(docx).toBeInstanceOf(Buffer);
      expect(docx[0]).toBe(0x50);
    });
  });

  describe('convertPdfToXlsx', () => {
    it('returns a valid XLSX buffer', async () => {
      const xlsx = await convertPdfToXlsx(testPdf);
      expect(xlsx).toBeInstanceOf(Buffer);
      expect(xlsx[0]).toBe(0x50); // PK (XLSX is ZIP)
    });
  });

  describe('convertPdfToPptx', () => {
    it('returns a valid PPTX buffer', async () => {
      const pptx = await convertPdfToPptx(testPdf);
      expect(pptx).toBeInstanceOf(Buffer);
      expect(pptx.length).toBeGreaterThan(100);
    });
  });

  describe('convertImagesToPdf', () => {
    it('converts PNG buffers to a PDF', async () => {
      const png = await renderPageToImage(testPdf, 0, 'png', 72);
      const pdf = await convertImagesToPdf([{ buffer: png, mimeType: 'image/png' }]);
      const doc = await PDFDocument.load(pdf);
      expect(doc.getPageCount()).toBe(1);
    });
  });
});
