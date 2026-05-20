/**
 * OCR Scan Worker — PERF-79-B2
 *
 * Async OCR pipeline using llama-swap orchestrator:
 *   1. Receives an OCR scan job (attachment buffer → text extraction)
 *   2. Routes to llama-swap (http://localhost:28080/v1) with model 'ocr-deepseek'
 *   3. Emits WebSocket progress via JobEventEmitter
 *   4. Returns extracted text
 *
 * Architecture: llama-swap handles the vLLM sleep/wake cycle transparently.
 * No direct VRAM management here — that is the orchestrator's responsibility.
 */

import { randomUUID } from 'crypto';
import { JobEventEmitter } from '../../../services/JobEventEmitter.js';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface OcrScanJob {
    readonly jobId: string;
    readonly userId: number;
    readonly conversationId: number;
    readonly attachmentId: number;
    readonly filename: string;
    readonly imageBase64: string;
    readonly mimeType: string;
    readonly preferredModel?: OcrModel;
}

export type OcrModel = 'ocr-deepseek' | 'ocr-glm' | 'vision-fallback';

export interface OcrScanResult {
    readonly jobId: string;
    readonly extractedText: string;
    readonly model: string;
    readonly latencyMs: number;
    readonly confidence: 'high' | 'medium' | 'low';
}

interface OcrProgressEvent {
    readonly jobId: string;
    readonly userId: number;
    readonly conversationId: number;
    readonly status: 'pending' | 'processing' | 'done' | 'error';
    readonly progress: number; // 0–100
    readonly message: string;
    readonly result?: OcrScanResult;
    readonly errorMessage?: string;
}

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────

const LLAMA_SWAP_BASE_URL = process.env.LLAMA_SWAP_BASE_URL ?? 'http://127.0.0.1:28080';
const LLAMA_SWAP_API_KEY = process.env.LLAMA_SWAP_API_KEY ?? '';
const OCR_TIMEOUT_MS = 120_000;
const OCR_MODEL_FALLBACK_ORDER: readonly OcrModel[] = ['ocr-deepseek', 'ocr-glm', 'vision-fallback'];

const OCR_SYSTEM_PROMPT =
    'You are a precise OCR engine. Extract ALL text from the provided image exactly as written. ' +
    'Preserve original formatting, line breaks, and structure. ' +
    'Output ONLY the extracted text with no commentary, preambles, or explanations. ' +
    'If no text is visible, output: [NO_TEXT_FOUND]';

// ──────────────────────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────────────────────

/**
 * Run an OCR scan job asynchronously, emitting progress events.
 * Callers should await this and handle errors — the worker does not swallow exceptions.
 */
export async function runOcrScanJob(job: OcrScanJob): Promise<OcrScanResult> {
    const startTs = Date.now();

    // Progress helper: emits via JobEventEmitter using job_provider_warning type for progress events.
    // On completion/error we use emitJobComplete/emitJobError respectively.
    const emit = (status: OcrProgressEvent['status'], progress: number, message: string): void => {
        if (status === 'done') {
            JobEventEmitter.emitJobComplete({
                jobId: job.jobId,
                userId: job.userId,
                conversationId: job.conversationId,
                warningMessage: message,
            });
        } else if (status === 'error') {
            JobEventEmitter.emitJobError({
                jobId: job.jobId,
                userId: job.userId,
                conversationId: job.conversationId,
                errorMessage: message,
            });
        } else {
            // Use provider_warning to broadcast progress (re-using existing event channel)
            JobEventEmitter.emitJobProviderWarning({
                jobId: job.jobId,
                userId: job.userId,
                conversationId: job.conversationId,
                warningMessage: `[OCR ${progress}%] ${message}`,
            });
        }
    };

    emit('pending', 0, 'OCR scan queued');

    const modelsToTry: OcrModel[] = job.preferredModel
        ? [job.preferredModel, ...OCR_MODEL_FALLBACK_ORDER.filter(m => m !== job.preferredModel)]
        : [...OCR_MODEL_FALLBACK_ORDER];

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
        emit('processing', 10 + modelsToTry.indexOf(model) * 5, `Routing to ${model} via llama-swap`);

        try {
            const text = await callLlamaSwapOcr(model, job.imageBase64, job.mimeType, job.filename);
            const latencyMs = Date.now() - startTs;

            const result: OcrScanResult = {
                jobId: job.jobId,
                extractedText: text,
                model,
                latencyMs,
                confidence: text.length > 50 ? 'high' : text.length > 10 ? 'medium' : 'low',
            };

            emit('done', 100, `OCR completed with ${model} in ${latencyMs}ms`);
            return result;

        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            emit('processing', 50, `${model} failed: ${lastError.message}. Trying fallback...`);
        }
    }

    const errorMsg = lastError?.message ?? 'All OCR models failed';
    emit('error', 0, `OCR failed: ${errorMsg}`);
    throw new Error(`[OcrScanWorker] OCR scan failed for job ${job.jobId}: ${errorMsg}`);
}

/**
 * Create a new OCR scan job descriptor.
 * Callers should persist the jobId for progress tracking.
 */
export function createOcrJob(params: Omit<OcrScanJob, 'jobId'>): OcrScanJob {
    return { ...params, jobId: randomUUID() };
}

// ──────────────────────────────────────────────────────────────
// llama-swap HTTP call
// ──────────────────────────────────────────────────────────────

async function callLlamaSwapOcr(
    model: OcrModel,
    imageBase64: string,
    mimeType: string,
    filename: string,
): Promise<string> {
    const url = `${LLAMA_SWAP_BASE_URL}/v1/chat/completions`;

    const requestBody = {
        model,
        max_tokens: 8192,
        temperature: 0,
        messages: [
            { role: 'system', content: OCR_SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${imageBase64}` },
                    },
                    {
                        type: 'text',
                        text: `Extract all text from the image "${filename}". Output only the extracted text.`,
                    },
                ],
            },
        ],
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (LLAMA_SWAP_API_KEY) {
        headers['Authorization'] = `Bearer ${LLAMA_SWAP_API_KEY}`;
    }

    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    });

    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`llama-swap OCR error ${resp.status}: ${body.slice(0, 200)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const data = await resp.json() as any;
    const content: string = data?.choices?.[0]?.message?.content ?? '';

    if (!content || content.trim() === '') {
        throw new Error('llama-swap returned empty OCR response');
    }

    return content.trim();
}
