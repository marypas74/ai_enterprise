/**
 * OCR Scan Worker tests — PERF-79-B2
 *
 * Tests the async OCR pipeline that routes to llama-swap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOcrJob, runOcrScanJob, type OcrScanJob } from './ocr-scan-worker.js';

// ── Mocks ────────────────────────────────────────────────────────────

// Mock fetch to avoid real HTTP calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock JobEventEmitter to avoid side effects
vi.mock('../../../services/JobEventEmitter.js', () => ({
    JobEventEmitter: {
        emitJobComplete: vi.fn(),
        emitJobError: vi.fn(),
        emitJobProviderWarning: vi.fn(),
    },
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeJob(overrides: Partial<OcrScanJob> = {}): OcrScanJob {
    return {
        jobId: 'test-job-id',
        userId: 1,
        conversationId: 42,
        attachmentId: 100,
        filename: 'test-document.pdf',
        imageBase64: 'dGVzdA==', // base64 of "test"
        mimeType: 'image/png',
        ...overrides,
    };
}

function makeSuccessResponse(text: string) {
    return {
        ok: true,
        json: vi.fn().mockResolvedValue({
            choices: [{ message: { content: text } }],
        }),
    };
}

function makeErrorResponse(status: number, body: string = '') {
    return {
        ok: false,
        status,
        text: vi.fn().mockResolvedValue(body),
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createOcrJob', () => {
    it('generates a unique jobId', () => {
        const params = {
            userId: 1, conversationId: 1, attachmentId: 1,
            filename: 'a.pdf', imageBase64: 'abc', mimeType: 'image/png',
        };
        const job1 = createOcrJob(params);
        const job2 = createOcrJob(params);
        expect(job1.jobId).toBeTruthy();
        expect(job2.jobId).toBeTruthy();
        expect(job1.jobId).not.toBe(job2.jobId);
    });

    it('copies all params immutably', () => {
        const params = {
            userId: 7, conversationId: 99, attachmentId: 55,
            filename: 'doc.pdf', imageBase64: 'xyz', mimeType: 'image/jpeg',
        };
        const job = createOcrJob(params);
        expect(job.userId).toBe(7);
        expect(job.conversationId).toBe(99);
        expect(job.filename).toBe('doc.pdf');
    });
});

describe('runOcrScanJob', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns extracted text on success with default model', async () => {
        const LONG_TEXT = 'Invoice Total: €1,234.56\nDate: 2026-01-15\nVendor: Acme Corp\nPO: 9987654321';
        mockFetch.mockResolvedValueOnce(makeSuccessResponse(LONG_TEXT));

        const result = await runOcrScanJob(makeJob());

        expect(result.extractedText).toBe(LONG_TEXT);
        expect(result.model).toBe('ocr-deepseek');
        expect(result.jobId).toBe('test-job-id');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBe('high');
    });

    it('uses preferredModel when specified', async () => {
        mockFetch.mockResolvedValueOnce(makeSuccessResponse('Extracted text'));

        const result = await runOcrScanJob(makeJob({ preferredModel: 'ocr-glm' }));

        expect(result.model).toBe('ocr-glm');
        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(callBody.model).toBe('ocr-glm');
    });

    it('falls back to next model when first fails', async () => {
        // First call (ocr-deepseek) fails
        mockFetch.mockResolvedValueOnce(makeErrorResponse(503, 'Service unavailable'));
        // Second call (ocr-glm) succeeds
        mockFetch.mockResolvedValueOnce(makeSuccessResponse('Fallback text from glm'));

        const result = await runOcrScanJob(makeJob());

        expect(result.model).toBe('ocr-glm');
        expect(result.extractedText).toBe('Fallback text from glm');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws when all models fail', async () => {
        mockFetch.mockResolvedValue(makeErrorResponse(503, 'All down'));

        await expect(runOcrScanJob(makeJob())).rejects.toThrow(/OCR scan failed/);
        // 3 models attempted
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('sends correct image_url format in request body', async () => {
        mockFetch.mockResolvedValueOnce(makeSuccessResponse('text'));

        await runOcrScanJob(makeJob({ imageBase64: 'abc123', mimeType: 'image/jpeg' }));

        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        const userContent = callBody.messages.find((m: any) => m.role === 'user')?.content;
        const imageBlock = userContent?.find((b: any) => b.type === 'image_url');
        expect(imageBlock?.image_url?.url).toBe('data:image/jpeg;base64,abc123');
    });

    it('sets confidence=low for short extracted text', async () => {
        mockFetch.mockResolvedValueOnce(makeSuccessResponse('Hi'));

        const result = await runOcrScanJob(makeJob());

        expect(result.confidence).toBe('low');
    });

    it('sets confidence=medium for medium-length text', async () => {
        mockFetch.mockResolvedValueOnce(makeSuccessResponse('Hello World 12345'));

        const result = await runOcrScanJob(makeJob());

        expect(result.confidence).toBe('medium');
    });

    it('includes filename in user message', async () => {
        mockFetch.mockResolvedValueOnce(makeSuccessResponse('text'));

        await runOcrScanJob(makeJob({ filename: 'invoice-2026.pdf' }));

        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        const textBlock = callBody.messages.find((m: any) => m.role === 'user')?.content
            ?.find((b: any) => b.type === 'text');
        expect(textBlock?.text).toContain('invoice-2026.pdf');
    });
});
