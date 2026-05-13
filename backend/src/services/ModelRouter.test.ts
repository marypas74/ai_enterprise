import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter, getModelRouter } from './ModelRouter.js';

const makePool = (rows: object[]) => ({
  execute: vi.fn().mockResolvedValue([rows, []]),
}) as any;

describe('ModelRouter — audio model filtering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('excludes audio models from tier routing', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'gpt-audio-1.5', provider: 'openai', priority: 1 },
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 2 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    expect(decision.model).toBe('gpt-4o-mini');
    expect(decision.model).not.toContain('audio');
  });

  it('SQL query contains audio exclusion filter', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/NOT LIKE '%audio%'/i);
  });

  it('returns empty model when only audio models are available', async () => {
    const pool = makePool([
      { tier_name: 'balanced', model_id: 'gpt-audio-preview', provider: 'openai', priority: 1 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'analizza questo documento in dettaglio',
      conversationLength: 0, hasAttachments: false, attachmentCount: 0,
      hasVisionAttachments: false, toolsRequested: false, userId: 1,
    });
    expect(decision.model).toBe('');
  });
});

describe('ModelRouter — Fastify logger injection (N2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls logger.warn when recordDecision DB write fails', async () => {
    const warnFn = vi.fn();
    const mockLogger = { warn: warnFn } as any;
    const pool = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1 }], []])
        .mockRejectedValueOnce(new Error('DB write failed')),
    } as any;

    const router = new ModelRouter(pool, mockLogger);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    await router.recordDecision(decision, { query: 'ciao', conversationLength: 0, hasAttachments: false, attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false, userId: 1 }, { latencyMs: 10, tokensInput: 5, tokensOutput: 5, costUsd: 0 });

    expect(warnFn).toHaveBeenCalledOnce();
    expect(warnFn.mock.calls[0][1]).toMatch(/Failed to record routing decision/);
  });

  it('does not throw when logger is undefined and DB write fails', async () => {
    const pool = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1 }], []])
        .mockRejectedValueOnce(new Error('DB write failed')),
    } as any;

    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    await expect(
      router.recordDecision(decision, { query: 'ciao', conversationLength: 0, hasAttachments: false, attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false, userId: 1 }, { latencyMs: 10, tokensInput: 5, tokensOutput: 5, costUsd: 0 })
    ).resolves.toBeUndefined();
  });
});
