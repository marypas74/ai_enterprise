/**
 * Tests for PdfPageRenderer
 */
import { describe, it, expect, vi } from 'vitest';
import { PdfPageRenderer } from './PdfPageRenderer.js';

vi.mock('./document-processing/PDFConversionService.js', () => ({
  convertPdfToImages: vi.fn().mockResolvedValue([
    { pageNumber: 1, buffer: Buffer.from('fake-png-page1'), format: 'png' },
    { pageNumber: 2, buffer: Buffer.from('fake-png-page2'), format: 'png' },
    { pageNumber: 3, buffer: Buffer.from('fake-png-page3'), format: 'png' },
  ]),
}));

describe('PdfPageRenderer', () => {
  it('converte PageImage[] in array di stringhe base64', async () => {
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 50);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toBe(Buffer.from('fake-png-page1').toString('base64'));
    expect(pages[1]).toBe(Buffer.from('fake-png-page2').toString('base64'));
  });

  it('rispetta il limite maxPages', async () => {
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 2);
    expect(pages).toHaveLength(2);
  });

  it('accetta maxPages=1', async () => {
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 1);
    expect(pages).toHaveLength(1);
  });

  it('restituisce array vuoto se convertPdfToImages restituisce vuoto', async () => {
    const { convertPdfToImages } = await import('./document-processing/PDFConversionService.js');
    vi.mocked(convertPdfToImages).mockResolvedValueOnce([]);
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 50);
    expect(pages).toEqual([]);
  });
});
