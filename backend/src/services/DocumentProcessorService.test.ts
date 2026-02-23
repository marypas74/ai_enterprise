/**
 * Unit tests for DocumentProcessorService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tesseract.js
vi.mock('tesseract.js', () => ({
    createWorker: vi.fn().mockResolvedValue({
        recognize: vi.fn().mockResolvedValue({
            data: { text: 'OCR extracted text from image' }
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
    }),
}));

// Mock mammoth
vi.mock('mammoth', () => ({
    default: {
        extractRawText: vi.fn().mockResolvedValue({ value: 'Extracted DOCX text content' }),
    },
}));

// Mock exceljs
vi.mock('exceljs', () => {
    const mockWorksheet = {
        name: 'Sheet1',
        eachRow: vi.fn((cb: any) => {
            cb({ values: [null, 'Header', 'Data'] }, 1);
            cb({ values: [null, 'Row1', 'Value1'] }, 2);
        }),
        columns: null as any,
        addRow: vi.fn(),
    };
    const mockWorksheet2 = {
        name: 'Sheet2',
        eachRow: vi.fn((cb: any) => {
            cb({ values: [null, 'Other'] }, 1);
        }),
    };
    return {
        default: {
            Workbook: vi.fn().mockImplementation(() => ({
                xlsx: {
                    load: vi.fn().mockResolvedValue(undefined),
                    writeBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-xlsx')),
                },
                eachSheet: vi.fn((cb: any) => {
                    cb(mockWorksheet, 1);
                    cb(mockWorksheet2, 2);
                }),
                addWorksheet: vi.fn().mockReturnValue(mockWorksheet),
            })),
        },
    };
});

// Mock docx
vi.mock('docx', () => {
    class MockDocument {
        constructor(_opts: any) { }
    }
    class MockParagraph {
        constructor(_opts: any) { }
    }
    class MockTextRun {
        constructor(_opts: any) { }
    }
    return {
        Document: MockDocument,
        Packer: {
            toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-docx-bytes')),
        },
        Paragraph: MockParagraph,
        TextRun: MockTextRun,
    };
});

// Mock fs
vi.mock('fs/promises', () => ({
    default: {
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(Buffer.from('mock-file')),
    },
}));

describe('DocumentProcessorService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('extractWithOCR', () => {
        it('should extract text from image buffer using tesseract', async () => {
            const { extractWithOCR } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-image-data');
            const result = await extractWithOCR(buffer);
            expect(result).toBe('OCR extracted text from image');
        });
    });

    describe('extractDocxContent', () => {
        it('should extract text from DOCX buffer using mammoth', async () => {
            const { extractDocxContent } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-docx-data');
            const result = await extractDocxContent(buffer);
            expect(result).toBe('Extracted DOCX text content');
        });
    });

    describe('extractExcelContent', () => {
        it('should extract text from Excel buffer with sheet names', async () => {
            const { extractExcelContent } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-xlsx-data');
            const result = await extractExcelContent(buffer);
            expect(result).toContain('Foglio: Sheet1');
            expect(result).toContain('Foglio: Sheet2');
        });
    });

    describe('extractOfficeContent', () => {
        it('should route DOCX to mammoth', async () => {
            const { extractOfficeContent } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-docx');
            const result = await extractOfficeContent(
                buffer,
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            expect(result).toBe('Extracted DOCX text content');
        });

        it('should route Excel to xlsx', async () => {
            const { extractOfficeContent } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-xlsx');
            const result = await extractOfficeContent(
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            expect(result).toContain('Foglio: Sheet1');
        });

        it('should return unsupported message for unknown types', async () => {
            const { extractOfficeContent } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake');
            const result = await extractOfficeContent(buffer, 'application/unknown');
            expect(result).toContain('non supportato');
        });
    });

    describe('convertTextToDocx', () => {
        it('should create a DOCX file from text', async () => {
            const { convertTextToDocx } = await import('./DocumentProcessorService.js');
            const fs = (await import('fs/promises')).default;
            const result = await convertTextToDocx('Test content', '/tmp/test.docx', 'Test Doc');
            expect(result).toBe('/tmp/test.docx');
            expect(fs.writeFile).toHaveBeenCalled();
        });
    });

    describe('processDocument', () => {
        it('should use OCR for images', async () => {
            const { processDocument } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-image');
            const result = await processDocument(buffer, 'image/png', 'photo.png');
            expect(result.method).toBe('ocr');
            expect(result.text).toBeTruthy();
        });

        it('should use mammoth for DOCX', async () => {
            const { processDocument } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-docx');
            const result = await processDocument(
                buffer,
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'doc.docx'
            );
            expect(result.method).toBe('mammoth');
        });

        it('should use xlsx for spreadsheets', async () => {
            const { processDocument } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('fake-xlsx');
            const result = await processDocument(
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'data.xlsx'
            );
            expect(result.method).toBe('xlsx');
        });

        it('should read plain text files directly', async () => {
            const { processDocument } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('Plain text content here');
            const result = await processDocument(buffer, 'text/plain', 'readme.txt');
            expect(result.method).toBe('text-read');
            expect(result.text).toBe('Plain text content here');
        });

        it('should return unknown for unsupported types', async () => {
            const { processDocument } = await import('./DocumentProcessorService.js');
            const buffer = Buffer.from('binary');
            const result = await processDocument(buffer, 'application/octet-stream', 'file.bin');
            expect(result.method).toBe('unknown');
        });
    });
});
