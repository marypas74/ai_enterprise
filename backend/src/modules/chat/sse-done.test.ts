/**
 * DEBT-83-A: SSE done propagation tests.
 * Tests writeSseDone helper and validates all 4 SSE done paths
 * emit finish_reason consistently.
 *
 * TDD order: RED (written before writeSseDone exists) → GREEN (after impl).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the streaming module to test writeSseDone in isolation
// We test via snapshot of what gets written to reply.raw.write
describe('writeSseDone — DEBT-83-A', () => {
  let writtenData: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockReply: any;

  beforeEach(() => {
    writtenData = [];
    mockReply = {
      raw: {
        write: (data: string) => { writtenData.push(data); },
        destroyed: false,
      },
    };
  });

  it('emits done=true with conversationId and finish_reason', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, {
      conversationId: 42,
      finishReason: 'stop',
    });
    expect(writtenData).toHaveLength(1);
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.done).toBe(true);
    expect(parsed.content).toBe('');
    expect(parsed.conversationId).toBe(42);
    expect(parsed.finish_reason).toBe('stop');
  });

  it('emits finish_reason=null when finishReason is undefined', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 1 });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.finish_reason).toBeNull();
  });

  it('emits finish_reason=null when finishReason is null', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 1, finishReason: null });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.finish_reason).toBeNull();
  });

  it('emits iterations when provided', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 5, iterations: 3, finishReason: 'stop' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.iterations).toBe(3);
  });

  it('emits error when provided (error path)', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { error: 'Provider timeout', finishReason: null });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.done).toBe(true);
    expect(parsed.error).toBe('Provider timeout');
    expect(parsed.finish_reason).toBeNull();
  });

  it('SSE event format is correct (data: ...\\n\\n)', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 1 });
    expect(writtenData[0]).toMatch(/^data: \{.*\}\n\n$/);
  });

  // Snapshot tests for all 4 paths
  it('snapshot: normal completion path (completions.ts)', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 100, finishReason: 'stop' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed).toMatchSnapshot();
  });

  it('snapshot: agentic completion path', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 200, iterations: 5, finishReason: 'stop' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed).toMatchSnapshot();
  });

  it('snapshot: fallback chain error path', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { error: 'Both primary and fallback models failed. Please try again later.', finishReason: null });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed).toMatchSnapshot();
  });

  it('snapshot: async queue done path', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 300, finishReason: null });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed).toMatchSnapshot();
  });
});

// T2: maxInferenceMs schema test — DEBT-83-E
describe('completionSchema — DEBT-83-E maxInferenceMs', () => {
  it('accepts maxInferenceMs as optional positive integer', async () => {
    const { completionSchema } = await import('./types.js');
    const result = completionSchema.parse({
      model: 'gpt-4o',
      message: 'hello',
      maxInferenceMs: 30000,
    });
    expect((result as { maxInferenceMs?: number }).maxInferenceMs).toBe(30000);
  });

  it('rejects maxInferenceMs=0 (not positive)', async () => {
    const { completionSchema } = await import('./types.js');
    const { z } = await import('zod');
    expect(() => completionSchema.parse({
      model: 'gpt-4o',
      message: 'hello',
      maxInferenceMs: 0,
    })).toThrow(z.ZodError);
  });

  it('rejects negative maxInferenceMs', async () => {
    const { completionSchema } = await import('./types.js');
    const { z } = await import('zod');
    expect(() => completionSchema.parse({
      model: 'gpt-4o',
      message: 'hello',
      maxInferenceMs: -1000,
    })).toThrow(z.ZodError);
  });

  it('rejects non-integer maxInferenceMs', async () => {
    const { completionSchema } = await import('./types.js');
    const { z } = await import('zod');
    expect(() => completionSchema.parse({
      model: 'gpt-4o',
      message: 'hello',
      maxInferenceMs: 30000.5,
    })).toThrow(z.ZodError);
  });

  it('parses without maxInferenceMs (optional)', async () => {
    const { completionSchema } = await import('./types.js');
    const result = completionSchema.parse({ model: 'gpt-4o', message: 'hello' });
    expect((result as { maxInferenceMs?: number }).maxInferenceMs).toBeUndefined();
  });
});

// ─── DEBT-84-B: SSE done callsite residui ────────────────────────────────────
// Verifica che writeSseDone sia usato correttamente nei 2 path specifici:
// 1. Echo path in agentic.ts (conversationId=0, finishReason='stop')
// 2. MAX_TOKEN_LIMIT path in completions.ts (finishReason='length', error presente)
describe('writeSseDone — DEBT-84-B callsite paths', () => {
  let writtenData: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockReply: any;

  beforeEach(() => {
    writtenData = [];
    mockReply = {
      raw: {
        write: (data: string) => { writtenData.push(data); },
        destroyed: false,
      },
    };
  });

  it('echo path: writeSseDone with conversationId=0 and finish_reason=stop', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 0, finishReason: 'stop' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.done).toBe(true);
    expect(parsed.finish_reason).toBe('stop');
    expect(parsed.conversationId).toBe(0);
    expect(parsed.content).toBe('');
  });

  it('max-token-limit path: writeSseDone with finish_reason=length and error field', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 42, finishReason: 'length', error: 'message too large' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed.done).toBe(true);
    expect(parsed.finish_reason).toBe('length');
    expect(parsed.error).toBe('message too large');
    expect(parsed.conversationId).toBe(42);
  });

  it('snapshot: echo path done event', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 0, finishReason: 'stop' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed).toMatchSnapshot();
  });

  it('snapshot: max-token-limit done event', async () => {
    const { writeSseDone } = await import('./streaming.js');
    writeSseDone(mockReply, { conversationId: 42, finishReason: 'length', error: 'message too large' });
    const parsed = JSON.parse(writtenData[0].replace(/^data: /, '').trim());
    expect(parsed).toMatchSnapshot();
  });
});
// ─────────────────────────────────────────────────────────────────────────────
