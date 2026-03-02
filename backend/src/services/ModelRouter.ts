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
}

interface RoutingContext {
  readonly query: string;
  readonly conversationLength: number;
  readonly hasAttachments: boolean;
  readonly attachmentCount: number;
  readonly hasVisionAttachments: boolean;
  readonly toolsRequested: boolean;
  readonly userId: number;
}

interface TierModel {
  readonly tier_name: RoutingTier;
  readonly model_id: string;
  readonly provider: string;
  readonly priority: number;
}

// ─── Keyword sets ───────────────────────────────────────────────────
const FAST_KEYWORDS = [
  'ciao', 'buongiorno', 'buonasera', 'hello', 'hi', 'hey',
  'grazie', 'thanks', 'ok', 'va bene', 'perfetto', 'capito',
  'come stai', 'che ore sono', 'traduci', 'translate',
  'riassumi in una riga', 'sì', 'no', 'dimmi',
];

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

  // Document creation detection — needs real processing, not a simple chat
  const isDocCreation = DOC_CREATION_PATTERN.test(ctx.query);

  // Keyword signals
  // FAST penalty only when no doc creation or attachments (pure simple greeting/translation)
  if (FAST_KEYWORDS.some(kw => queryLower.includes(kw)) && queryLen < 100
      && !isDocCreation && !ctx.hasAttachments) {
    score -= 2;
  }
  if (POWERFUL_KEYWORDS.some(kw => queryLower.includes(kw))) score += 3;
  if (CODING_KEYWORDS.some(kw => queryLower.includes(kw))) score += 1;

  // Document creation with attachments → balanced minimum
  if (isDocCreation) score += 2;
  if (isDocCreation && ctx.hasAttachments) score += 1;

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
class ModelRouter {
  private tierModels: readonly TierModel[] = [];
  private lastFetched = 0;
  private readonly CACHE_TTL = 60_000;

  constructor(private readonly db: mysql.Pool) {}

  private async loadTierModels(): Promise<readonly TierModel[]> {
    if (this.tierModels.length > 0 && Date.now() - this.lastFetched < this.CACHE_TTL) {
      return this.tierModels;
    }
    try {
      const [rows] = await this.db.execute(
        `SELECT rt.tier_name, rt.model_id, rt.provider, rt.priority
         FROM model_routing_tiers rt
         INNER JOIN ai_models m ON rt.model_id = m.model_id
         INNER JOIN ai_providers p ON m.provider_id = p.id
         WHERE rt.is_enabled = TRUE
           AND m.is_enabled = TRUE
           AND p.is_enabled = TRUE
           AND m.model_type IN ('chat', 'completion')
         ORDER BY rt.tier_name, rt.priority ASC`
      ) as any;
      this.tierModels = rows as TierModel[];
      this.lastFetched = Date.now();
    } catch {
      this.tierModels = [];
    }
    return this.tierModels;
  }

  private async selectModelFromTier(tier: RoutingTier): Promise<string | null> {
    const allModels = await this.loadTierModels();
    const tryTiers: RoutingTier[] = tier === 'fast'
      ? ['fast', 'balanced', 'powerful']
      : tier === 'powerful'
        ? ['powerful', 'balanced', 'fast']
        : ['balanced', 'fast', 'powerful'];

    for (const t of tryTiers) {
      for (const m of allModels.filter(x => x.tier_name === t)) {
        if (isProviderHealthy(m.model_id)) return m.model_id;
      }
    }
    return null;
  }

  async route(ctx: RoutingContext): Promise<RoutingDecision> {
    const score = computeComplexityScore(ctx);
    const tier = scoreToTier(score);
    const model = await this.selectModelFromTier(tier);

    if (!model) {
      return {
        tier: 'balanced', model: '', reason: 'No routing tiers configured',
        confidence: 0, effort: 'medium', estimatedCostPer1k: 0, routingMethod: 'rule',
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
    if (FAST_KEYWORDS.some(kw => queryLower.includes(kw)) && ctx.query.length < 100 && !DOC_CREATION_PATTERN.test(ctx.query) && !ctx.hasAttachments) reasons.push('simple greeting');

    return {
      tier, model,
      reason: `score=${score}, ${reasons.join(', ') || 'standard routing'}`,
      confidence: Math.min(1, 0.5 + (Math.abs(score - 2.5) / 5)),
      effort: TIER_EFFORT[tier],
      estimatedCostPer1k: (pricing.input + pricing.output) / 2,
      routingMethod: 'rule',
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
