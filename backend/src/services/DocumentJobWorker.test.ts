import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must be hoisted before imports to intercept ESM module resolution
vi.mock('../modules/ai/providers.js', () => ({
  AIProviderFactory: {
    getProvider: vi.fn(),
  },
}));

import { DocumentJobWorker } from './DocumentJobWorker.js';
import { JobEventEmitter } from './JobEventEmitter.js';
import { AIProviderFactory } from '../modules/ai/providers.js';

function makeFastifyMock() {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    db: {
      execute: vi.fn().mockResolvedValue([{ insertId: 101 }]),
    },
  };
}

describe('DocumentJobWorker', () => {
  let emitCompleteSpy: ReturnType<typeof vi.spyOn>;
  let emitErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitCompleteSpy = vi.spyOn(JobEventEmitter, 'emitJobComplete');
    emitErrorSpy = vi.spyOn(JobEventEmitter, 'emitJobError');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates instance without throwing', () => {
    const fastify = makeFastifyMock();
    const queue = { dequeue: vi.fn().mockResolvedValue(null) } as any;
    expect(() => new DocumentJobWorker(fastify as any, queue)).not.toThrow();
  });

  it('processJob saves response message and emits job_complete', async () => {
    const fastify = makeFastifyMock();
    const queue = {
      dequeue: vi.fn().mockResolvedValue(null),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateMetrics: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({ content: 'La risposta del documento.' }),
    };

    vi.mocked(AIProviderFactory.getProvider).mockReturnValue(mockProvider as any);

    const worker = new DocumentJobWorker(fastify as any, queue);

    const job = {
      id: 'test-uuid',
      userId: 1,
      conversationId: 42,
      placeholderMessageId: 99,
      model: 'qwen25vl:32b',
      providerName: 'ollama',
      messagesJson: JSON.stringify([{ role: 'user', content: 'Summarize this doc.' }]),
      estimatedTokens: 10000,
      etaSeconds: 200,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };

    await worker.processJob(job);

    expect(fastify.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      expect.arrayContaining([42, 'assistant'])
    );
    expect(emitCompleteSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'test-uuid',
      userId: 1,
      conversationId: 42,
    }));
  });

  it('processJob emits job_error when provider throws', async () => {
    const fastify = makeFastifyMock();
    const queue = {
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateMetrics: vi.fn().mockResolvedValue(undefined),
    } as any;

    vi.mocked(AIProviderFactory.getProvider).mockReturnValue({
      complete: vi.fn().mockRejectedValue(new Error('vLLM timeout')),
    } as any);

    const worker = new DocumentJobWorker(fastify as any, queue);

    const job = {
      id: 'error-uuid',
      userId: 2,
      conversationId: 10,
      placeholderMessageId: 50,
      model: 'qwen25vl:32b',
      providerName: 'ollama',
      messagesJson: '[]',
      estimatedTokens: 10000,
      etaSeconds: 200,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };

    await worker.processJob(job);

    expect(emitErrorSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'error-uuid',
      userId: 2,
      errorMessage: 'vLLM timeout',
    }));
  });
});
