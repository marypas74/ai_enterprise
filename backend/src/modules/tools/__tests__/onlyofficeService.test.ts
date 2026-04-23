import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  PdfConversionError,
  extractPdfText,
  isPdfConvertible,
} from '../onlyofficeService.js';

describe('onlyofficeService error handling', () => {
  describe('PdfConversionError', () => {
    it('should carry a machine-readable code and a user message', () => {
      const err = new PdfConversionError('NO_TEXT', 'PDF privo di testo estraibile');
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('NO_TEXT');
      expect(err.userMessage).toBe('PDF privo di testo estraibile');
      expect(err.name).toBe('PdfConversionError');
    });

    it('should support TIMEOUT and SCRIPT_ERROR codes', () => {
      expect(new PdfConversionError('TIMEOUT', 'too slow').code).toBe('TIMEOUT');
      expect(new PdfConversionError('SCRIPT_ERROR', 'boom').code).toBe('SCRIPT_ERROR');
    });
  });

  describe('extractPdfText', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oo-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should return 0 characters for a missing/invalid PDF', async () => {
      const fakePdf = path.join(tmpDir, 'missing.pdf');
      const chars = await extractPdfText(fakePdf);
      expect(chars).toBe(0);
    });
  });

  describe('isPdfConvertible', () => {
    it('should treat < 50 extractable characters as non-convertible (image-based)', async () => {
      const spy = vi.fn(async () => 10);
      const result = await isPdfConvertible('/fake.pdf', { extract: spy });
      expect(result).toBe(false);
      expect(spy).toHaveBeenCalledWith('/fake.pdf');
    });

    it('should treat >= 50 extractable characters as convertible', async () => {
      const spy = vi.fn(async () => 500);
      const result = await isPdfConvertible('/fake.pdf', { extract: spy });
      expect(result).toBe(true);
    });

    it('should treat extraction errors as non-convertible (fail closed)', async () => {
      const spy = vi.fn(async () => { throw new Error('pdftotext missing'); });
      const result = await isPdfConvertible('/fake.pdf', { extract: spy });
      expect(result).toBe(false);
    });
  });
});
