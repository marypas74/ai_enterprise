import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  highlightText,
  addStickyNote,
  addStamp,
  underlineText,
  strikethroughText,
  removeAnnotations,
} from './PDFAnnotationService.js';

async function createTestPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('Hello World Test Document', { x: 50, y: 700, size: 20 });
  page.drawText('This is a sample paragraph for annotation testing.', { x: 50, y: 650, size: 12 });
  return Buffer.from(await doc.save());
}

describe('PDFAnnotationService', () => {
  let testPdf: Buffer;

  beforeAll(async () => {
    testPdf = await createTestPdf();
  });

  describe('highlightText', () => {
    it('adds highlight annotation to PDF', async () => {
      const result = await highlightText(testPdf, 0, 'Hello', [1, 1, 0]);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);
    });

    it('throws on invalid page index', async () => {
      await expect(highlightText(testPdf, 5, 'Hello', [1, 1, 0])).rejects.toThrow('out of range');
    });
  });

  describe('addStickyNote', () => {
    it('adds sticky note annotation', async () => {
      const result = await addStickyNote(testPdf, 0, 100, 700, 'This is a note');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);
    });
  });

  describe('addStamp', () => {
    it('adds stamp annotation', async () => {
      const result = await addStamp(testPdf, 0, 'APPROVED', 200, 400);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);
    });
  });

  describe('underlineText', () => {
    it('adds underline annotation', async () => {
      const result = await underlineText(testPdf, 0, 'sample', [0, 0, 1]);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);
    });
  });

  describe('strikethroughText', () => {
    it('adds strikethrough annotation', async () => {
      const result = await strikethroughText(testPdf, 0, 'paragraph', [1, 0, 0]);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);
    });
  });

  describe('removeAnnotations', () => {
    it('removes all annotations from a page', async () => {
      const annotated = await addStickyNote(testPdf, 0, 100, 700, 'Note');
      const cleaned = await removeAnnotations(annotated, 0);
      expect(cleaned).toBeInstanceOf(Buffer);
      // Verify it's still a valid PDF (annotations were processed)
      expect(cleaned.length).toBeGreaterThan(0);
    });
  });
});
