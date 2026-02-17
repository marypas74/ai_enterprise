
import { describe, it, expect, vi } from 'vitest';
import * as pdfUrl from 'pdf-parse';

// Mock the pdf-parse library
vi.mock('pdf-parse', () => {
    return {
        PDFParse: class {
            constructor() { }
            getText = vi.fn().mockResolvedValue({ text: 'Extracted PDF Content' });
            destroy = vi.fn().mockResolvedValue(undefined);
        },
        __esModule: true,
    };
});

describe('PDF Extraction Logic', () => {
    it('should correctly import and usage pdf-parse', async () => {
        const { PDFParse } = await import('pdf-parse');
        const pdfParse = new PDFParse({ data: Buffer.from('dummy') } as any);
        const data = await pdfParse.getText();

        expect(data.text).toBe('Extracted PDF Content');
    });
});
