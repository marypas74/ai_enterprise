import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanupOldTempDirs, isScannedPdf } from '../pdfEditorService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('pdfEditorService', () => {
  describe('cleanupOldTempDirs', () => {
    let oldDir: string;

    beforeEach(async () => {
      oldDir = path.join(os.tmpdir(), `pdf-editor-999-${Date.now()}`);
      await fs.mkdir(oldDir, { recursive: true });
      const oldTime = new Date(Date.now() - 3600000);
      await fs.utimes(oldDir, oldTime, oldTime);
    });

    afterEach(async () => {
      await fs.rm(oldDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should remove directories older than maxAgeMs', async () => {
      await cleanupOldTempDirs(1800000);
      const exists = await fs.access(oldDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should keep directories newer than maxAgeMs', async () => {
      const newDir = path.join(os.tmpdir(), `pdf-editor-888-${Date.now()}`);
      await fs.mkdir(newDir, { recursive: true });
      await cleanupOldTempDirs(1800000);
      const exists = await fs.access(newDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      await fs.rm(newDir, { recursive: true, force: true });
    });
  });

  describe('isScannedPdf', () => {
    it('should return true for HTML with only images and < 50 chars text', () => {
      const html = '<html><body><img src="data:image/png;base64,abc"/></body></html>';
      expect(isScannedPdf(html)).toBe(true);
    });

    it('should return false for HTML with substantial text', () => {
      const html = '<html><body><p>Questo e un contratto di servizio tra le parti contraenti per la fornitura.</p></body></html>';
      expect(isScannedPdf(html)).toBe(false);
    });

    it('should return true for empty HTML', () => {
      expect(isScannedPdf('<html><body></body></html>')).toBe(true);
    });
  });
});
