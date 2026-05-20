/**
 * DEBT-82-F: Tests for ProviderRegistryService DB-driven provider override.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderRegistryService } from './ProviderRegistryService.js';
import { AIProviderFactory } from './AIProviderFactory.js';

const makePool = (rows: object[]) => ({
  execute: vi.fn().mockResolvedValue([rows, []]),
});

describe('ProviderRegistryService — DEBT-82-F DB-driven provider override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ProviderRegistryService.destroy();
  });

  afterEach(() => {
    ProviderRegistryService.destroy();
  });

  it('loads provider_override from DB and returns it via getOverride()', async () => {
    const pool = makePool([
      { model_id: 'qwen25vl:32b', provider_override: 'vllm' },
    ]);
    await ProviderRegistryService.init(pool as any);

    expect(ProviderRegistryService.getOverride('qwen25vl:32b')).toBe('vllm');
  });

  it('returns undefined for model with no DB override', async () => {
    const pool = makePool([
      { model_id: 'qwen25vl:32b', provider_override: 'vllm' },
    ]);
    await ProviderRegistryService.init(pool as any);

    expect(ProviderRegistryService.getOverride('unknown-model')).toBeUndefined();
  });

  it('ignores invalid provider_override values (non-ProviderType strings)', async () => {
    const pool = makePool([
      { model_id: 'my-model', provider_override: 'invalid_provider' },
    ]);
    await ProviderRegistryService.init(pool as any);

    expect(ProviderRegistryService.getOverride('my-model')).toBeUndefined();
  });

  it('returns empty cache before init() is called', () => {
    expect(ProviderRegistryService.getOverride('qwen25vl:32b')).toBeUndefined();
  });

  it('DB query selects model_id and provider_override columns', async () => {
    const pool = makePool([]);
    await ProviderRegistryService.init(pool as any);

    const [sql] = (pool.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/model_id/i);
    expect(sql).toMatch(/provider_override/i);
    expect(sql).toMatch(/ai_models/i);
  });
});

describe('AIProviderFactory.getProviderName — DEBT-82-F DB override integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ProviderRegistryService.destroy();
  });

  afterEach(() => {
    ProviderRegistryService.destroy();
  });

  it('routes qwen25vl:32b to vllm via DB override (not hardcoded regex)', async () => {
    const pool = makePool([
      { model_id: 'qwen25vl:32b', provider_override: 'vllm' },
    ]);
    await ProviderRegistryService.init(pool as any);

    // qwen25vl:32b contains ':' so without DB override it would go to 'ollama'
    // With DB override it must return 'vllm'
    const provider = AIProviderFactory.getProviderName('qwen25vl:32b');
    expect(provider).toBe('vllm');
  });

  it('falls back to regex routing for model without DB override', async () => {
    const pool = makePool([]); // no overrides in DB
    await ProviderRegistryService.init(pool as any);

    // gpt-4o should still route to openai via regex
    expect(AIProviderFactory.getProviderName('gpt-4o')).toBe('openai');
    // claude- prefix → anthropic
    expect(AIProviderFactory.getProviderName('claude-3-5-sonnet')).toBe('anthropic');
    // Ollama tag format (not in DB) → ollama
    expect(AIProviderFactory.getProviderName('qwen3:14b')).toBe('ollama');
  });
});
