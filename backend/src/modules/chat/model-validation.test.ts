import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { validateChatModel } from './model-validation.js';

/**
 * Builds a fake mysql2 pool that returns the given rows in order, one
 * call at a time. Each invocation of `pool.execute()` shifts the next
 * pre-canned result from the queue.
 *
 * `validateChatModel` issues two queries: first the "list enabled chat
 * models" query, then the "lookup specific model" query. Tests therefore
 * provide the sequence in that order.
 */
function fakePool(resultQueue: any[][]): Pool {
  const queue = [...resultQueue];
  return {
    execute: vi.fn(async () => {
      const next = queue.shift() ?? [];
      return [next, []];
    }),
  } as unknown as Pool;
}

describe('validateChatModel', () => {
  it('returns ok=true when model exists, both rows enabled, type=chat', async () => {
    const pool = fakePool([
      [{ model_id: 'gpt-4o' }, { model_id: 'gpt-4o-mini' }],
      [{ provider_type: 'openai', is_enabled: 1, provider_enabled: 1, model_type: 'chat' }],
    ]);
    const result = await validateChatModel(pool, 'gpt-4o');
    expect(result.ok).toBe(true);
    expect(result.providerType).toBe('openai');
    expect(result.enabledChatModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('returns ok=false when model_id is unknown', async () => {
    const pool = fakePool([
      [{ model_id: 'gpt-4o' }],
      [],
    ]);
    const result = await validateChatModel(pool, 'gpt-5.5-pro-2026-04-23');
    expect(result.ok).toBe(false);
    expect(result.providerType).toBeNull();
    expect(result.enabledChatModels).toContain('gpt-4o');
  });

  it('returns ok=false when model is disabled', async () => {
    const pool = fakePool([
      [{ model_id: 'gpt-4o' }],
      [{ provider_type: 'openai', is_enabled: 0, provider_enabled: 1, model_type: 'chat' }],
    ]);
    const result = await validateChatModel(pool, 'gpt-4o');
    expect(result.ok).toBe(false);
  });

  it('returns ok=false when provider is disabled', async () => {
    const pool = fakePool([
      [{ model_id: 'gpt-4o' }],
      [{ provider_type: 'openai', is_enabled: 1, provider_enabled: 0, model_type: 'chat' }],
    ]);
    const result = await validateChatModel(pool, 'gpt-4o');
    expect(result.ok).toBe(false);
  });

  it('returns ok=false when model_type is non-chat (e.g. embedding)', async () => {
    const pool = fakePool([
      [{ model_id: 'gpt-4o' }],
      [{ provider_type: 'openai', is_enabled: 1, provider_enabled: 1, model_type: 'embedding' }],
    ]);
    const result = await validateChatModel(pool, 'text-embedding-3-small');
    expect(result.ok).toBe(false);
  });

  it('returns empty enabledChatModels list when first query fails', async () => {
    const failingPool: Pool = {
      execute: vi.fn()
        .mockRejectedValueOnce(new Error('db boom'))
        .mockResolvedValueOnce([[], []]),
    } as unknown as Pool;
    const result = await validateChatModel(failingPool, 'gpt-4o');
    expect(result.enabledChatModels).toEqual([]);
    expect(result.ok).toBe(false);
  });
});
