import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter } from './ModelRouter.js';

// ─── DEBT-80-B: word-boundary scoring tests ──────────────────────────────────
// These tests validate that "dimmi" inside "spiegami in dettaglio" does NOT
// trigger the FAST_KEYWORDS penalty (word-boundary fix), and that the new
// POWERFUL_KEYWORDS entries route long/detailed queries to balanced/powerful tier.
describe('ModelRouter — DEBT-80-B word-boundary scoring', () => {
  beforeEach(() => vi.clearAllMocks());

  const fastPool = (modelId = 'gpt-4o-mini') =>
    makePool([
      { tier_name: 'fast', model_id: modelId, provider: 'openai', priority: 1, force_short_output: 0 },
      { tier_name: 'balanced', model_id: 'gpt-4o', provider: 'openai', priority: 1, force_short_output: 0 },
      { tier_name: 'powerful', model_id: 'gpt-4o', provider: 'openai', priority: 2, force_short_output: 0 },
    ]);

  it('"ciao" routes to fast tier', async () => {
    const router = new ModelRouter(fastPool());
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    expect(decision.tier).toBe('fast');
  });

  it('"spiegami in dettaglio l\'architettura di Kubernetes con tutti i componenti" routes to balanced or powerful', async () => {
    const router = new ModelRouter(fastPool());
    const decision = await router.route({
      query: "spiegami in dettaglio l'architettura di Kubernetes con tutti i componenti",
      conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    expect(['balanced', 'powerful']).toContain(decision.tier);
  });

  it('"dimmi un saluto breve" routes to fast tier (word boundary — "dimmi" standalone)', async () => {
    const router = new ModelRouter(fastPool());
    const decision = await router.route({
      query: 'dimmi un saluto breve', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    expect(decision.tier).toBe('fast');
  });

  it('"Riassumi tutto il documento in modo dettagliato" routes to balanced or powerful', async () => {
    const router = new ModelRouter(fastPool());
    const decision = await router.route({
      query: 'Riassumi tutto il documento in modo dettagliato',
      conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    expect(['balanced', 'powerful']).toContain(decision.tier);
  });
});
// ─────────────────────────────────────────────────────────────────────────────

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

describe('ModelRouter — v2.1.64 LEFT JOIN + provider boost', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SQL uses LEFT JOIN against ai_models and ai_providers', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN ai_models/i);
    expect(sql).toMatch(/LEFT JOIN ai_providers/i);
  });

  it('SQL boosts vllm/ollama provider_type ahead of others at equal priority', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/CASE WHEN p\.provider_type IN \('vllm', 'ollama'\) THEN 0 ELSE 1 END/);
  });

  it('SQL allows tier rows whose model has no ai_models entry (m.id IS NULL)', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/m\.id IS NULL/i);
  });

  it('warns and still routes a model that has no ai_models row (local provider path)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = makePool([
      { tier_name: 'fast', model_id: 'qwen3-vl:8b', provider: 'ollama', priority: 1, provider_type: 'ollama', model_pk: null },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.model).toBe('qwen3-vl:8b');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('qwen3-vl:8b'));
    warn.mockRestore();
  });
});

describe('ModelRouter — PERF-79-B3 force_short_output', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns forceShortOutput=true when tier model has force_short_output=1', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0, force_short_output: 1 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.model).toBe('qwen25vl:32b');
    expect(decision.forceShortOutput).toBe(true);
  });

  it('returns forceShortOutput=false when tier model has force_short_output=0', async () => {
    const pool = makePool([
      { tier_name: 'balanced', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0, force_short_output: 0 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      // Long query to ensure balanced tier is selected
      query: 'analizza questo documento in dettaglio e fornisci un report completo',
      conversationLength: 6, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: true,
    });
    expect(decision.forceShortOutput).toBe(false);
  });

  it('SQL query includes force_short_output column via COALESCE', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/COALESCE.*force_short_output/i);
  });

  it('returns forceShortOutput=false when no tier models available', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.model).toBe('');
    expect(decision.forceShortOutput).toBe(false);
  });
});

// ─── DEBT-81-G: max_output_tokens per tier ───────────────────────────────────
describe('ModelRouter — DEBT-81-G max_output_tokens per tier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fast tier: maxOutputTokens=512 propagated in RoutingDecision', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0,
        force_short_output: 0, max_output_tokens: 512 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.maxOutputTokens).toBe(512);
  });

  it('balanced tier: maxOutputTokens=1500 propagated in RoutingDecision', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0,
        force_short_output: 0, max_output_tokens: 512 },
      { tier_name: 'balanced', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 1,
        force_short_output: 0, max_output_tokens: 1500 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'analizza questo documento in dettaglio',
      conversationLength: 6, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: true,
    });
    expect(['balanced', 'powerful']).toContain(decision.tier);
    // For balanced tier specifically
    if (decision.tier === 'balanced') {
      expect(decision.maxOutputTokens).toBe(1500);
    }
  });

  it('powerful tier: maxOutputTokens=3000 propagated in RoutingDecision', async () => {
    const pool = makePool([
      { tier_name: 'powerful', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0,
        force_short_output: 0, max_output_tokens: 3000 },
      { tier_name: 'balanced', model_id: 'gpt-4o', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 1500 },
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 512 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'progetta una architettura complessa multi-step con pipeline',
      conversationLength: 15, hasAttachments: true,
      attachmentCount: 3, hasVisionAttachments: false, toolsRequested: true,
      userId: 1, hasDocuments: true,
    });
    // powerful tier should be selected for complex queries
    if (decision.tier === 'powerful') {
      expect(decision.maxOutputTokens).toBe(3000);
    }
    // maxOutputTokens should always be defined (not undefined) when tier model has the column
    expect(decision.maxOutputTokens).toBeDefined();
  });

  it('maxOutputTokens=undefined when column is null in DB', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: null },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.maxOutputTokens).toBeUndefined();
  });

  it('SQL query includes max_output_tokens column', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/max_output_tokens/i);
  });
});

// ─── DEBT-82-A: max_inference_ms per tier ────────────────────────────────────
describe('ModelRouter — DEBT-82-A max_inference_ms per tier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fast tier: maxInferenceMs=8000 propagated in RoutingDecision', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0,
        force_short_output: 0, max_output_tokens: 512, max_inference_ms: 8000 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.maxInferenceMs).toBe(8000);
  });

  it('balanced tier: maxInferenceMs=30000 propagated in RoutingDecision', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'qwen25vl:32b', provider: 'vllm', priority: 0,
        force_short_output: 0, max_output_tokens: 512, max_inference_ms: 8000 },
      { tier_name: 'balanced', model_id: 'gpt-4o', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 1500, max_inference_ms: 30000 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'analizza questo documento in dettaglio',
      conversationLength: 6, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: true,
    });
    if (decision.tier === 'balanced') {
      expect(decision.maxInferenceMs).toBe(30000);
    }
  });

  it('powerful tier: maxInferenceMs=60000 propagated in RoutingDecision', async () => {
    const pool = makePool([
      { tier_name: 'powerful', model_id: 'gpt-4o', provider: 'openai', priority: 0,
        force_short_output: 0, max_output_tokens: 3000, max_inference_ms: 60000 },
      { tier_name: 'balanced', model_id: 'gpt-4o', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 1500, max_inference_ms: 30000 },
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 512, max_inference_ms: 8000 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'progetta una architettura complessa multi-step con pipeline',
      conversationLength: 15, hasAttachments: true,
      attachmentCount: 3, hasVisionAttachments: false, toolsRequested: true,
      userId: 1, hasDocuments: true,
    });
    if (decision.tier === 'powerful') {
      expect(decision.maxInferenceMs).toBe(60000);
    }
  });

  it('maxInferenceMs=undefined when column is null in DB', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: null, max_inference_ms: null },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(decision.maxInferenceMs).toBeUndefined();
  });

  it('SQL query includes max_inference_ms column', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/max_inference_ms/i);
  });
});

// ─── DEBT-82-C: Routing saggio N parole ─────────────────────────────────────
describe('ModelRouter — DEBT-82-C routing saggio N parole', () => {
  beforeEach(() => vi.clearAllMocks());

  const allTiersPool = () =>
    makePool([
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 512, max_inference_ms: 8000 },
      { tier_name: 'balanced', model_id: 'gpt-4o', provider: 'openai', priority: 1,
        force_short_output: 0, max_output_tokens: 1500, max_inference_ms: 30000 },
      { tier_name: 'powerful', model_id: 'gpt-4o', provider: 'openai', priority: 2,
        force_short_output: 0, max_output_tokens: 3000, max_inference_ms: 60000 },
    ]);

  it('"scrivi saggio di 500 parole" routes to balanced or powerful', async () => {
    const router = new ModelRouter(allTiersPool());
    const decision = await router.route({
      query: 'scrivi saggio di 500 parole sulla rivoluzione industriale',
      conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(['balanced', 'powerful']).toContain(decision.tier);
  });

  it('"articolo di 1000 parole su python" routes to balanced or powerful', async () => {
    const router = new ModelRouter(allTiersPool());
    const decision = await router.route({
      query: 'articolo di 1000 parole su python e il futuro della programmazione',
      conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    expect(['balanced', 'powerful']).toContain(decision.tier);
  });

  it('"scrivi una poesia di 2 versi" routes to fast (no regression)', async () => {
    const router = new ModelRouter(allTiersPool());
    const decision = await router.route({
      query: 'scrivi una poesia di 2 versi',
      conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    // 2 versi < 200 parole threshold — must NOT trigger balanced routing
    expect(decision.tier).toBe('fast');
  });
});
