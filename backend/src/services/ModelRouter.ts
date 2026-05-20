/**
 * ModelRouter — Intelligent model routing based on query complexity.
 *
 * Routes queries to three tiers:
 *   - fast:      simple queries (greetings, translations, short questions)
 *   - balanced:  standard work (coding, analysis, writing)
 *   - powerful:  complex reasoning (architecture, multi-step, deep analysis)
 */
import mysql from 'mysql2/promise';
import { isProviderHealthy } from './CircuitBreakerService.js';
import { MODEL_PRICING } from '../modules/ai/types.js';

// ─── Types ──────────────────────────────────────────────────────────
type RoutingTier = 'fast' | 'balanced' | 'powerful';

export interface RoutingDecision {
  readonly tier: RoutingTier;
  readonly model: string;
  readonly reason: string;
  readonly confidence: number;
  readonly effort: 'low' | 'medium' | 'high';
  readonly estimatedCostPer1k: number;
  readonly routingMethod: 'rule' | 'semantic' | 'override';
  /** PERF-79-B3: When true, completions.ts overrides max_tokens=512, temperature=0,
   *  and prepends a concise-output system prompt. Prevents KV cache exhaustion on
   *  fast-tier vLLM models used for short conversational queries. */
  readonly forceShortOutput?: boolean;
}

interface RoutingContext {
  readonly query: string;
  readonly conversationLength: number;
  readonly hasAttachments: boolean;
  readonly attachmentCount: number;
  readonly hasVisionAttachments: boolean;
  readonly toolsRequested: boolean;
  readonly userId: number;
  readonly hasDocuments?: boolean;
  /** AI-77: estimated input token count (used to force fast tier for short prompts) */
  readonly estimatedTokens?: number;
  /** AI-77b: web search active — disqualify fast tier (qwen2.5vl:7b Ollama)
   *  because retrieved snippets inflate context beyond fast tier capacity AND
   *  Ollama 7B may be unloaded due to VRAM contention with vLLM 32B. */
  readonly hasWebSearch?: boolean;
}

interface TierModel {
  readonly tier_name: RoutingTier;
  readonly model_id: string;
  readonly provider: string;
  readonly priority: number;
  // PERF-79-B3: from model_routing_tiers.force_short_output column
  readonly force_short_output: number; // MySQL BOOLEAN returns 0/1
}

// ─── Keyword sets ───────────────────────────────────────────────────
const FAST_KEYWORDS = [
  'ciao', 'buongiorno', 'buonasera', 'hello', 'hi', 'hey',
  'grazie', 'thanks', 'ok', 'va bene', 'perfetto', 'capito',
  'come stai', 'che ore sono', 'traduci', 'translate',
  'riassumi in una riga', 'sì', 'no', 'dimmi',
];

// DEBT-80-B: word-boundary pattern to avoid substring false positives.
// "dimmi" inside "spiegami in dettaglio" must NOT trigger the FAST penalty.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const FAST_KEYWORDS_PATTERN = new RegExp(
  '(?:^|[\\s,!?])(' + FAST_KEYWORDS.map(kw =>
    kw.includes(' ')
      ? escapeRegExp(kw)
      : escapeRegExp(kw) + '(?=[\\s,!?]|$)'
  ).join('|') + ')',
  'i',
);

const POWERFUL_KEYWORDS = [
  'progetta', 'design', 'architettura', 'architecture',
  'business plan', 'strategia', 'strategy',
  'analizza criticamente', 'valuta i rischi', 'risk assessment',
  'confronta in dettaglio', 'compare in detail',
  'scrivi un documento', 'write a document',
  'roadmap', 'pianifica', 'plan',
  'ragiona', 'reason', 'think step by step',
  'refactoring complesso', 'complex refactoring',
  'multi-step', 'pipeline', 'cerca sul web e poi',
  // DEBT-80-B: added detailed/explanatory intent keywords
  'spiegami in dettaglio', 'spiega tutto', 'descrivi tutti', 'in modo dettagliato',
];

const CODING_KEYWORDS = [
  'codice', 'code', 'funzione', 'function', 'classe', 'class',
  'bug', 'fix', 'debug', 'test', 'refactor',
  'typescript', 'javascript', 'python', 'sql', 'api',
  'programma', 'script', 'algoritmo', 'database', 'backend', 'frontend',
];

// Document creation/conversion keywords → needs at least balanced tier
// Verbs aligned with detectDocumentFormat keywords in streaming.ts
const DOC_CREATION_PATTERN = /\b(crea|creami|genera|salva|esporta|converti|convertilo|trasforma|produci|fai|scrivi|create|generate|save|export|convert|make|write)\b.*\b(word|docx|excel|xlsx|powerpoint|pptx|pdf|documento|file|presentazione|foglio|spreadsheet|tabella|slides?|diapositiv[ae])\b/i;

// ─── Complexity scoring (pure function) ─────────────────────────────
function computeComplexityScore(ctx: RoutingContext): number {
  const queryLen = ctx.query.length;
  const queryLower = ctx.query.toLowerCase();
  let score = 0;

  // Length
  if (queryLen >= 1000) score += 3;
  else if (queryLen >= 200) score += 2;
  else if (queryLen >= 50) score += 1;

  // Conversation depth
  if (ctx.conversationLength > 10) score += 2;
  else if (ctx.conversationLength > 5) score += 1;

  // Attachments & tools
  if (ctx.hasAttachments) score += 1;
  if (ctx.attachmentCount > 1) score += 1;
  if (ctx.hasVisionAttachments) score += 1;
  if (ctx.toolsRequested) score += 2;

  // AI-77: Short prompts without image attachments → fast tier.
  // Estimated tokens: provided explicitly or approximated from query length (1 token ≈ 4 chars).
  // AI-77b: web search excludes fast tier — retrieved snippets inflate context AND
  //         qwen2.5vl:7b Ollama may be unloaded due to VRAM contention with vLLM 32B.
  const estimatedTokens = ctx.estimatedTokens ?? Math.ceil(queryLen / 4);
  // Pre-check powerful keywords — if any match, the prompt is NOT short regardless of length.
  // This prevents the isShortPrompt penalty from overriding an explicit complexity signal.
  const hasPowerfulKeyword = POWERFUL_KEYWORDS.some(kw => queryLower.includes(kw));
  // AI-77: Short prompts without image attachments → fast tier.
  // Estimated tokens: provided explicitly or approximated from query length (1 token ≈ 4 chars).
  // AI-77b: web search excludes fast tier — retrieved snippets inflate context AND
  //         qwen2.5vl:7b Ollama may be unloaded due to VRAM contention with vLLM 32B.
  // DEBT-80-B: added `queryLen < 50` guard — longer prompts may contain fast keywords
  // incidentally (e.g. "spiegami in dettaglio, dimmi tutto") and must not be pushed fast.
  // DEBT-80-B: powerful keyword match disables short-prompt penalty entirely.
  const isShortPrompt = estimatedTokens < 512
    && queryLen < 50
    && !hasPowerfulKeyword
    && !ctx.hasVisionAttachments
    && !ctx.hasDocuments
    && !ctx.hasWebSearch;
  if (isShortPrompt) {
    score -= 3; // Strong push toward fast tier
  }

  // Web search → at least balanced tier (snippets retrieved server-side add ~1-3k tokens)
  if (ctx.hasWebSearch) score += 3;

  // Document creation detection — needs real processing, not a simple chat
  const isDocCreation = DOC_CREATION_PATTERN.test(ctx.query);

  // Keyword signals
  // FAST penalty only when no doc creation or attachments (pure simple greeting/translation).
  // DEBT-80-B: use word-boundary regex to avoid matching "dimmi" inside "spiegami".
  if (FAST_KEYWORDS_PATTERN.test(queryLower) && queryLen < 100
      && !isDocCreation && !ctx.hasAttachments) {
    score -= 2;
  }
  if (POWERFUL_KEYWORDS.some(kw => queryLower.includes(kw))) score += 3;
  if (CODING_KEYWORDS.some(kw => queryLower.includes(kw))) score += 1;

  // Document creation with attachments → balanced minimum
  if (isDocCreation) score += 2;
  if (isDocCreation && ctx.hasAttachments) score += 1;

  // RAG / Document mode — requires deeper reasoning to synthesize document chunks
  if (ctx.hasDocuments) score += 3;

  // Multi-part queries
  const questionCount = (ctx.query.match(/\?/g) || []).length;
  if (questionCount > 2) score += 2;
  else if (questionCount > 1) score += 1;

  if ((ctx.query.match(/^\d+\.\s/gm) || []).length >= 3) score += 2;

  return Math.max(0, score);
}

function scoreToTier(score: number): RoutingTier {
  if (score <= 1) return 'fast';
  if (score <= 4) return 'balanced';
  return 'powerful';
}

const TIER_EFFORT = { fast: 'low', balanced: 'medium', powerful: 'high' } as const;

// ─── Router ─────────────────────────────────────────────────────────
export class ModelRouter {
  private tierModels: readonly TierModel[] = [];
  private lastFetched = 0;
  private readonly CACHE_TTL = 60_000;

  constructor(private readonly db: mysql.Pool) {}

  private async loadTierModels(): Promise<readonly TierModel[]> {
    if (this.tierModels.length > 0 && Date.now() - this.lastFetched < this.CACHE_TTL) {
      return this.tierModels;
    }
    try {
      // v2.1.64: LEFT JOIN so a routing tier entry whose target model isn't
      // (yet) catalogued in `ai_models` (e.g. local Ollama/vLLM models that the
      // sync worker hasn't enumerated) remains routable. Local providers are
      // also boosted ahead of remote APIs at equal priority.
      const [rows] = await this.db.execute(
        `SELECT rt.tier_name, rt.model_id, rt.provider, rt.priority,
                COALESCE(rt.force_short_output, 0) AS force_short_output,
                p.provider_type AS provider_type,
                m.id            AS model_pk
         FROM model_routing_tiers rt
         LEFT JOIN ai_models m ON rt.model_id = m.model_id
         LEFT JOIN ai_providers p ON COALESCE(
                m.provider_id,
                (SELECT id FROM ai_providers WHERE name = rt.provider LIMIT 1)
         ) = p.id
         WHERE rt.is_enabled = TRUE
           AND (m.id IS NULL OR (
                m.is_enabled = TRUE
                AND m.model_type IN ('chat', 'completion')
                AND m.model_id NOT LIKE '%audio%'
           ))
           AND (p.is_enabled = TRUE OR p.id IS NULL)
         ORDER BY rt.tier_name,
           CASE WHEN p.provider_type IN ('vllm', 'ollama') THEN 0 ELSE 1 END,
           rt.priority ASC`
      ) as any;
      // Runtime filter: log a warning for tier entries with no ai_models row
      // but still include them (local provider may serve the model directly).
      for (const r of rows as any[]) {
        if (r.model_pk == null) {
          // Single line — keep verbosity low; the cache TTL is 60s.
          // (Logger isn't injected into this class; we surface via console.warn.)
          // eslint-disable-next-line no-console
          console.warn(`[ModelRouter] tier entry "${r.tier_name}/${r.model_id}" has no ai_models row; including via local-provider path`);
        }
      }
      this.tierModels = rows as TierModel[];
      this.lastFetched = Date.now();
    } catch {
      this.tierModels = [];
    }
    return this.tierModels;
  }

  private async selectModelFromTier(tier: RoutingTier): Promise<string | null> {
    const [model] = await this.selectModelFromTierWithMeta(tier);
    return model;
  }

  /** Returns [modelId, TierModel] — TierModel carries force_short_output and other DB fields. */
  private async selectModelFromTierWithMeta(tier: RoutingTier): Promise<[string | null, TierModel | null]> {
    const allModels = await this.loadTierModels();
    const tryTiers: RoutingTier[] = tier === 'fast'
      ? ['fast', 'balanced', 'powerful']
      : tier === 'powerful'
        ? ['powerful', 'balanced', 'fast']
        : ['balanced', 'fast', 'powerful'];

    for (const t of tryTiers) {
      for (const m of allModels.filter(x => x.tier_name === t && !x.model_id.includes('audio'))) {
        if (isProviderHealthy(m.model_id)) return [m.model_id, m];
      }
    }
    return [null, null];
  }

  async route(ctx: RoutingContext): Promise<RoutingDecision> {
    const score = computeComplexityScore(ctx);
    const tier = scoreToTier(score);
    const [model, selectedTierModel] = await this.selectModelFromTierWithMeta(tier);

    if (!model) {
      return {
        tier: 'balanced', model: '', reason: 'No routing tiers configured',
        confidence: 0, effort: 'medium', estimatedCostPer1k: 0, routingMethod: 'rule',
        forceShortOutput: false,
      };
    }

    const pricing = MODEL_PRICING[model] || { input: 0, output: 0 };
    const queryLower = ctx.query.toLowerCase();
    const reasons: string[] = [];
    if (ctx.query.length < 100) reasons.push('short query');
    if (ctx.query.length > 1000) reasons.push('long query');
    if (ctx.conversationLength > 10) reasons.push('deep conversation');
    if (ctx.hasAttachments) reasons.push(`${ctx.attachmentCount} attachment(s)`);
    if (ctx.toolsRequested) reasons.push('tools requested');
    if (POWERFUL_KEYWORDS.some(kw => queryLower.includes(kw))) reasons.push('complex keywords');
    if (DOC_CREATION_PATTERN.test(ctx.query)) reasons.push('document creation');
    // DEBT-80-B: use word-boundary pattern here too for consistency
    if (FAST_KEYWORDS_PATTERN.test(queryLower) && ctx.query.length < 100 && !DOC_CREATION_PATTERN.test(ctx.query) && !ctx.hasAttachments) reasons.push('simple greeting');

    return {
      tier, model,
      reason: `score=${score}, ${reasons.join(', ') || 'standard routing'}`,
      confidence: Math.min(1, 0.5 + (Math.abs(score - 2.5) / 5)),
      effort: TIER_EFFORT[tier],
      estimatedCostPer1k: (pricing.input + pricing.output) / 2,
      routingMethod: 'rule',
      forceShortOutput: selectedTierModel?.force_short_output === 1,
    };
  }

  async recordDecision(
    decision: RoutingDecision,
    ctx: RoutingContext,
    result: { latencyMs: number; tokensInput: number; tokensOutput: number; costUsd: number; conversationId?: number },
  ): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO routing_decisions
          (conversation_id, user_id, query_length, query_complexity_score, selected_tier, selected_model,
           routing_reason, routing_confidence, latency_ms, tokens_input, tokens_output, cost_usd, routing_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.conversationId || null, ctx.userId, ctx.query.length, computeComplexityScore(ctx),
          decision.tier, decision.model, decision.reason, decision.confidence,
          result.latencyMs, result.tokensInput, result.tokensOutput, result.costUsd,
          decision.routingMethod,
        ],
      );
    } catch (err) {
      console.warn('[ModelRouter] Failed to record routing decision:', err);
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────
let instance: ModelRouter | null = null;

export function getModelRouter(db: mysql.Pool): ModelRouter {
  if (!instance) {
    instance = new ModelRouter(db);
  }
  return instance;
}
