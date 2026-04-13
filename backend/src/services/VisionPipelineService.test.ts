/**
 * Tests for VisionPipelineService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisionPipelineService } from './VisionPipelineService.js';

vi.mock('./DocumentTypeDetector.js', () => ({
  DocumentTypeDetector: {
    detect: vi.fn(),
  },
}));

vi.mock('./PdfPageRenderer.js', () => ({
  PdfPageRenderer: {
    renderToBase64: vi.fn(),
  },
}));

import { DocumentTypeDetector } from './DocumentTypeDetector.js';
import { PdfPageRenderer } from './PdfPageRenderer.js';

const PDF_BUF = Buffer.from('fake-pdf');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VisionPipelineService.prepare', () => {
  it('restituisce path=text e pages=[] per documenti testuali', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'text', textDensity: 200, pageCount: 5,
    });

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('text');
    expect(result.pages).toEqual([]);
    expect(result.fallbackUsed).toBe(false);
    expect(PdfPageRenderer.renderToBase64).not.toHaveBeenCalled();
  });

  it('renderizza le pagine per documenti vision', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'vision', textDensity: 2, pageCount: 3,
    });
    vi.mocked(PdfPageRenderer.renderToBase64).mockResolvedValue(['b64p1', 'b64p2', 'b64p3']);

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('vision');
    expect(result.pages).toEqual(['b64p1', 'b64p2', 'b64p3']);
    expect(result.fallbackUsed).toBe(false);
    expect(PdfPageRenderer.renderToBase64).toHaveBeenCalledWith(PDF_BUF, 50, 150);
  });

  it('renderizza le pagine per documenti hybrid', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'hybrid', textDensity: 25, pageCount: 8,
    });
    vi.mocked(PdfPageRenderer.renderToBase64).mockResolvedValue(['b64p1']);

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('hybrid');
    expect(result.pages).toHaveLength(1);
  });

  it('fa fallback a text se il rendering fallisce', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'vision', textDensity: 0, pageCount: 4,
    });
    vi.mocked(PdfPageRenderer.renderToBase64).mockRejectedValue(
      new Error('mupdf crash'),
    );

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('text');
    expect(result.pages).toEqual([]);
    expect(result.fallbackUsed).toBe(true);
  });

  it('non chiama renderToBase64 per MIME type non-PDF', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'text', textDensity: 9999, pageCount: 1,
    });

    const result = await VisionPipelineService.prepare(
      Buffer.from('fake docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(result.path).toBe('text');
    expect(PdfPageRenderer.renderToBase64).not.toHaveBeenCalled();
  });
});
