/**
 * RerankerService — LLM-based post-retrieval reranking
 * After Qdrant returns candidates by cosine similarity, this service
 * uses a small LLM to re-score them for actual relevance to the query.
 *
 * The rerank model is resolved dynamically:
 *   1. RERANK_MODEL env var (explicit override)
 *   2. First enabled lightweight Ollama model from ai_models table
 *   3. Fallback: first available Ollama model
 */
import { findOne } from '../database/index.js';
import type mysql from 'mysql2/promise';
import type { MemoryPoint } from './VectorMemoryService.js';

// Cache resolved rerank model for 5 minutes
let cachedRerankModel: { model: string; ts: number } | null = null;
const RERANK_CACHE_TTL = 5 * 60 * 1000;

export class RerankerService {
  private ollamaBaseUrl: string;
  private rerankModelOverride: string | null;
  private db: mysql.Pool | null;

  constructor(db?: mysql.Pool) {
    this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.rerankModelOverride = process.env.RERANK_MODEL || null;
    this.db = db || null;
  }

  /**
   * Resolve the rerank model: env override > DB lightweight Ollama model > hardcoded fallback
   */
  private async resolveModel(): Promise<string> {
    if (this.rerankModelOverride) return this.rerankModelOverride;

    if (cachedRerankModel && Date.now() - cachedRerankModel.ts < RERANK_CACHE_TTL) {
      return cachedRerankModel.model;
    }

    if (this.db) {
      try {
        // Prefer small models: order by context_window ascending to get the lightest
        const row = await findOne<any>(this.db,
          `SELECT m.model_id FROM ai_models m
           JOIN ai_providers p ON m.provider_id = p.id
           WHERE p.name = 'ollama' AND m.is_enabled = TRUE
           ORDER BY m.context_window ASC, m.sort_order ASC
           LIMIT 1`,
        );
        if (row?.model_id) {
          cachedRerankModel = { model: row.model_id, ts: Date.now() };
          return row.model_id;
        }
      } catch {
        // DB query failed, fall through
      }
    }

    return 'qwen3:14b';
  }

  /**
   * Rerank memory points by actual relevance to the query
   * Takes top-N from Qdrant, asks LLM to score each, returns reordered top-K
   */
  async rerank(query: string, points: MemoryPoint[], topK: number = 3): Promise<MemoryPoint[]> {
    if (points.length <= topK) return points;

    try {
      const model = await this.resolveModel();
      const scoredPoints = await Promise.all(
        points.map(async (point) => {
          const score = await this.scoreRelevance(query, point.content, model);
          return { ...point, rerankScore: score };
        })
      );

      scoredPoints.sort((a, b) => b.rerankScore - a.rerankScore);
      return scoredPoints.slice(0, topK).map(({ rerankScore, ...point }) => point);
    } catch (error: any) {
      console.error(`[Reranker] Reranking failed, returning original order: ${error.message}`);
      return points.slice(0, topK);
    }
  }

  /**
   * Score the relevance of a document to a query (0.0 to 1.0)
   */
  private async scoreRelevance(query: string, document: string, model: string): Promise<number> {
    const prompt = `Rate the relevance of the following document to the query on a scale of 0 to 10.
Only respond with a single number.

Query: ${query.substring(0, 200)}
Document: ${document.substring(0, 500)}

Relevance score (0-10):`;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const authKey = process.env.OLLAMA_AUTH_KEY || '';
      if (authKey) headers['X-Ollama-Key'] = authKey;

      const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { num_predict: 5, temperature: 0.0 },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return 0.5;

      const data = await response.json() as any;
      const text = (data.response || '').trim();
      const score = parseFloat(text);
      if (isNaN(score)) return 0.5;
      return Math.min(Math.max(score / 10, 0), 1);
    } catch {
      return 0.5;
    }
  }
}
