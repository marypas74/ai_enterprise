/**
 * ModelRouter — Intelligent model routing based on query analysis.
 *
 * FASE 8.1: Rule-based routing (keyword + heuristics)
 * FASE 8.4: Semantic routing (embedding similarity) when available
 *
 * Routes queries to three tiers:
 *   - fast:      simple queries → Haiku, GPT-4.1-mini, Gemini Flash, Ollama
 *   - balanced:  standard work → Sonnet, GPT-4.1, Gemini Pro
 *   - powerful:  complex reasoning → Opus, GPT-5, o3
 */
import mysql from 'mysql2/promise';
import { isProviderHealthy } from './CircuitBreakerService.js';
import { MODEL_PRICING } from '../modules/ai/types.js';

// ─── Types ──────────────────────────────────────────────────────────
export type RoutingTier = 'fast' | 'balanced' | 'powerful';
export type EffortLevel = 'low' | 'medium' | 'high';

export interface RoutingDecision {
  tier: RoutingTier;
  model: string;
  reason: string;
  confidence: number;       // 0-1
  effort: EffortLevel;
  estimatedCostPer1k: number;
  routingMethod: 'rule' | 'semantic' | 'override';
}

export interface RoutingContext {
  query: string;
  conversationLength: number;
  hasAttachments: boolean;
  attachmentCount: number;
  hasVisionAttachments: boolean;
  toolsRequested: boolean;
  previousModel?: string;
  userId: number;
}

interface TierModel {
  tier_name: RoutingTier;
  model_id: string;
  provider: string;
  priority: number;
}

// ─── Rule-based keyword sets ────────────────────────────────────────
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
  'multi-step', 'pipeline',
  'cerca sul web e poi', 'search and then',
];

const CODING_KEYWORDS = [
  'codice', 'code', 'funzione', 'function', 'classe', 'class',
  'bug', 'fix', 'debug', 'test', 'refactor',
  'typescript', 'javascript', 'python', 'java', 'rust', 'go',
  'sql', 'query', 'api', 'endpoint', 'component',
  'import', 'export', 'async', 'await',
];

// ─── Complexity scoring ─────────────────────────────────────────────
function computeComplexityScore(ctx: RoutingContext): number {
  let score = 0;

  // Query length
  const queryLen = ctx.query.length;
  if (queryLen < 50) score += 0;
  else if (queryLen < 200) score += 1;
  else if (queryLen < 1000) score += 2;
  else score += 3;

  // Conversation depth
  if (ctx.conversationLength > 10) score += 2;
  else if (ctx.conversationLength > 5) score += 1;

  // Attachments
  if (ctx.hasAttachments) score += 1;
  if (ctx.attachmentCount > 1) score += 1;
  if (ctx.hasVisionAttachments) score += 1;

  // Tools
  if (ctx.toolsRequested) score += 2;

  // Keyword analysis
  const queryLower = ctx.query.toLowerCase();

  const fastMatch = FAST_KEYWORDS.some(kw => queryLower.includes(kw));
  if (fastMatch && queryLen < 100) score -= 2;

  const powerfulMatch = POWERFUL_KEYWORDS.some(kw => queryLower.includes(kw));
  if (powerfulMatch) score += 3;

  const codingMatch = CODING_KEYWORDS.some(kw => queryLower.includes(kw));
  if (codingMatch) score += 1;

  // Multi-part queries (presence of numbered lists or multiple questions)
  const questionCount = (ctx.query.match(/\?/g) || []).length;
  if (questionCount > 2) score += 2;
  else if (questionCount > 1) score += 1;

  // Numbered list detection (1. 2. 3. etc.)
  const numberedList = (ctx.query.match(/^\d+\.\s/gm) || []).length;
  if (numberedList >= 3) score += 2;

  return Math.max(0, score);
}

function scoreToTier(score: number): RoutingTier {
  if (score <= 1) return 'fast';
  if (score <= 4) return 'balanced';
  return 'powerful';
}

function tierToEffort(tier: RoutingTier): EffortLevel {
  switch (tier) {
    case 'fast': return 'low';
    case 'balanced': return 'medium';
    case 'powerful': return 'high';
  }
}

// ─── Main Router Class ──────────────────────────────────────────────
export class ModelRouter {
  private tierModels: TierModel[] = [];
  private lastFetched = 0;
  private readonly CACHE_TTL = 60_000; // 1 min

  constructor(private db: mysql.Pool) {}

  /**
   * Load tier configuration from database (cached).
   */
  private async loadTierModels(): Promise<TierModel[]> {
    if (this.tierModels.length > 0 && Date.now() - this.lastFetched < this.CACHE_TTL) {
      return this.tierModels;
    }

    try {
      const [rows] = await this.db.execute(
        `SELECT tier_name, model_id, provider, priority
         FROM model_routing_tiers
         WHERE is_enabled = TRUE
         ORDER BY tier_name, priority ASC`
      ) as any;
      this.tierModels = rows as TierModel[];
      this.lastFetched = Date.now();
    } catch {
      // Table might not exist yet — return empty
      this.tierModels = [];
    }

    return this.tierModels;
  }

  /**
   * Select the best healthy model from a tier.
   */
  private async selectModelFromTier(tier: RoutingTier): Promise<{ model: string; provider: string } | null> {
    const tiers = await this.loadTierModels();
    const candidates = tiers.filter(t => t.tier_name === tier);

    for (const candidate of candidates) {
      if (isProviderHealthy(candidate.model_id)) {
        return { model: candidate.model_id, provider: candidate.provider };
      }
    }

    // Fallback: try adjacent tiers
    const fallbackOrder: RoutingTier[] = tier === 'fast'
      ? ['balanced', 'powerful']
      : tier === 'powerful'
        ? ['balanced', 'fast']
        : ['fast', 'powerful'];

    for (const fbTier of fallbackOrder) {
      const fbCandidates = tiers.filter(t => t.tier_name === fbTier);
      for (const candidate of fbCandidates) {
        if (isProviderHealthy(candidate.model_id)) {
          return { model: candidate.model_id, provider: candidate.provider };
        }
      }
    }

    return null;
  }

  /**
   * Main routing method — analyzes query and returns the best model.
   */
  async route(ctx: RoutingContext): Promise<RoutingDecision> {
    const score = computeComplexityScore(ctx);
    const tier = scoreToTier(score);
    const effort = tierToEffort(tier);

    const selected = await this.selectModelFromTier(tier);

    if (!selected) {
      // No tier config — use a sensible default
      return {
        tier: 'balanced',
        model: '',  // empty = caller should use user's selected model
        reason: 'No routing tiers configured, using user selection',
        confidence: 0,
        effort: 'medium',
        estimatedCostPer1k: 0,
        routingMethod: 'rule',
      };
    }

    const pricing = MODEL_PRICING[selected.model] || { input: 0.01, output: 0.03 };
    const estimatedCostPer1k = (pricing.input + pricing.output) / 2;

    const reasons: string[] = [];
    if (ctx.query.length < 100) reasons.push('short query');
    if (ctx.query.length > 1000) reasons.push('long query');
    if (ctx.conversationLength > 10) reasons.push('deep conversation');
    if (ctx.hasAttachments) reasons.push(`${ctx.attachmentCount} attachment(s)`);
    if (ctx.toolsRequested) reasons.push('tools requested');
    if (POWERFUL_KEYWORDS.some(kw => ctx.query.toLowerCase().includes(kw))) reasons.push('complex keywords');
    if (FAST_KEYWORDS.some(kw => ctx.query.toLowerCase().includes(kw)) && ctx.query.length < 100) reasons.push('simple greeting/response');

    return {
      tier,
      model: selected.model,
      reason: `score=${score}, ${reasons.join(', ') || 'standard routing'}`,
      confidence: Math.min(1, 0.5 + (Math.abs(score - 2.5) / 5)),
      effort,
      estimatedCostPer1k,
      routingMethod: 'rule',
    };
  }

  /**
   * Record routing decision for feedback loop (FASE 8.5).
   */
  async recordDecision(
    decision: RoutingDecision,
    ctx: RoutingContext,
    result: { latencyMs: number; tokensInput: number; tokensOutput: number; costUsd: number }
  ): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO routing_decisions
          (conversation_id, user_id, query_length, query_complexity_score, selected_tier, selected_model,
           routing_reason, routing_confidence, latency_ms, tokens_input, tokens_output, cost_usd, routing_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          null, ctx.userId, ctx.query.length, computeComplexityScore(ctx),
          decision.tier, decision.model, decision.reason, decision.confidence,
          result.latencyMs, result.tokensInput, result.tokensOutput, result.costUsd,
          decision.routingMethod,
        ]
      );
    } catch {
      // Non-critical — don't break the request
    }
  }
}

// Singleton for shared use
let routerInstance: ModelRouter | null = null;

export function getModelRouter(db: mysql.Pool): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter(db);
  }
  return routerInstance;
}
