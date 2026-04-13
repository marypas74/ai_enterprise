/**
 * Tests for DocumentTypeDetector
 */
import { describe, it, expect } from 'vitest';
import { DocumentTypeDetector } from './DocumentTypeDetector.js';

// Minimal valid PDF with text layer (~200 chars of text)
const TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmogPDwgL0xlbmd0aCAxMDAgPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoxMDAgNzAwIFRkCihRdWVzdG8gZSB1biBkb2N1bWVudG8gdGVzdHVhbGUgY29uIGNvbnRlbnV0byBzdWZmaWNpZW50ZSBwZXIgaWwgdGVzdC4pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI3NCAwMDAwMCBuIAowMDAwMDAwNDI0IDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTAyCiUlRU9G';

describe('DocumentTypeDetector', () => {
  describe('detect — non-PDF files', () => {
    it('classifica DOCX sempre come text', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('fake docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(result.path).toBe('text');
      expect(result.textDensity).toBe(9999);
      expect(result.pageCount).toBe(1);
    });

    it('classifica XLSX sempre come text', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('fake xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.path).toBe('text');
    });

    it('classifica text/plain sempre come text', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('contenuto testo'),
        'text/plain',
      );
      expect(result.path).toBe('text');
    });
  });

  describe('detect — PDF testuale', () => {
    it('classifica PDF con testo come text path', async () => {
      const buf = Buffer.from(TEXT_PDF_BASE64, 'base64');
      const result = await DocumentTypeDetector.detect(buf, 'application/pdf');
      expect(['text', 'hybrid']).toContain(result.path);
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detect — PDF corrotto/vuoto', () => {
    it('fallback a vision per PDF non leggibile', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('not a pdf at all'),
        'application/pdf',
      );
      expect(result.path).toBe('vision');
      expect(result.textDensity).toBe(0);
    });
  });
});
