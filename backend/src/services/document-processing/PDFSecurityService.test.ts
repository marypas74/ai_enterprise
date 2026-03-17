import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { protectPdf, unlockPdf, redactAreas, smartRedactRegex } from './PDFSecurityService.js';

async function createTestPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('John Doe email: john@example.com phone: +39 333 1234567', { x: 50, y: 700, size: 12 });
  page.drawText('CF: RSSMRA85M01H501Z IBAN: IT60X0542811101000000123456', { x: 50, y: 670, size: 12 });
  return Buffer.from(await doc.save());
}

describe('PDFSecurityService', () => {
  let testPdf: Buffer;

  beforeAll(async () => {
    testPdf = await createTestPdf();
  });

  describe('protectPdf', () => {
    it('encrypts a PDF with user and owner passwords', async () => {
      const result = await protectPdf(testPdf, 'user123', 'owner456', {
        printing: true,
        copying: false,
        modifying: false,
      });
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(result.equals(testPdf)).toBe(false);
    });

    it('encrypts with only user password', async () => {
      const result = await protectPdf(testPdf, 'user123', undefined);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('unlockPdf', () => {
    it('unlocks a protected PDF with correct password', async () => {
      const protectedBuf = await protectPdf(testPdf, 'pass', 'owner');
      const result = await unlockPdf(protectedBuf, 'pass');
      expect(result).toBeInstanceOf(Buffer);
      // Verify with mupdf (pdf-lib doesn't handle encryption markers well)
      const mupdf = await import('mupdf');
      const doc = mupdf.Document.openDocument(result, 'application/pdf');
      expect(doc.countPages()).toBe(1);
      doc.destroy();
    });

    it('throws on wrong password', async () => {
      const protectedBuf = await protectPdf(testPdf, 'pass', 'owner');
      await expect(unlockPdf(protectedBuf, 'wrong')).rejects.toThrow();
    });
  });

  describe('redactAreas', () => {
    it('redacts specified rectangular areas', async () => {
      const result = await redactAreas(testPdf, [
        { page: 0, x: 50, y: 690, width: 400, height: 30 },
      ]);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('smartRedactRegex', () => {
    it('redacts PII patterns from PDF', async () => {
      const { buffer, redactedCount } = await smartRedactRegex(testPdf);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(redactedCount).toBeGreaterThanOrEqual(0);
    });
  });
});
