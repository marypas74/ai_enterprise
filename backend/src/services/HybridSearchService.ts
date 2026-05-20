/**
 * HybridSearchService — BM25 + Vector fusion with Reciprocal Rank Fusion (RRF)
 * Combines keyword-based retrieval (MySQL FULLTEXT) with semantic retrieval (Qdrant)
 */
import { findMany } from '../database/index.js';
import { recall, type MemoryPoint, type MemoryCollection } from './VectorMemoryService.js';
import type mysql from 'mysql2/promise';

interface HybridResult {
  content: string;
  score: number;
  source: 'keyword' | 'vector' | 'both';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  metadata: Record<string, any>;
}

export class HybridSearchService {
  private readonly RRF_K = 60; // RRF constant (standard value)

  /**
   * Perform hybrid search combining keyword + vector results
   */
  async search(
    db: mysql.Pool,
    userId: number,
    query: string,
    options: {
      collections?: MemoryCollection[];
      vectorK?: number;
      vectorThreshold?: number;
      keywordLimit?: number;
      topK?: number;
    } = {},
  ): Promise<HybridResult[]> {
    const {
      collections = ['episodic_memory', 'declarative_memory'],
      vectorK = 10,
      vectorThreshold = 0.5,
      keywordLimit = 10,
      topK = 5,
    } = options;

    // Run keyword + vector search in parallel
    const [keywordResults, vectorResults] = await Promise.all([
      this.keywordSearch(db, userId, query, keywordLimit),
      this.vectorSearch(db, userId, query, collections, vectorK, vectorThreshold),
    ]);

    // Fuse results using Reciprocal Rank Fusion
    return this.reciprocalRankFusion(keywordResults, vectorResults, topK);
  }

  /**
   * MySQL FULLTEXT keyword search on memory_observations
   */
  private async keywordSearch(
    db: mysql.Pool,
    userId: number,
    query: string,
    limit: number,
  ): Promise<HybridResult[]> {
    try {
      const words = query.split(/\s+/).filter(w => w.length > 2).join(' ');
      if (!words) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const rows = await findMany<any>(
        db,
        `SELECT content, observation_type, importance, created_at,
                MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
         FROM memory_observations
         WHERE user_id = ? AND is_archived = FALSE
           AND MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE)
         ORDER BY relevance DESC
         LIMIT ?`,
        [words, userId, words, limit],
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      return rows.map((r: any) => ({
        content: r.content,
        score: r.relevance,
        source: 'keyword' as const,
        metadata: {
          observation_type: r.observation_type,
          importance: r.importance,
          created_at: r.created_at,
        },
      }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      console.error(`[HybridSearch] Keyword search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Qdrant vector search via VectorMemoryService
   */
  private async vectorSearch(
    db: mysql.Pool,
    userId: number,
    query: string,
    collections: MemoryCollection[],
    k: number,
    threshold: number,
  ): Promise<HybridResult[]> {
    try {
      const results = await recall(db, {
        userId,
        query,
        collections,
        episodicK: k,
        episodicThreshold: threshold,
        declarativeK: k,
        declarativeThreshold: threshold,
        proceduralK: k,
        proceduralThreshold: threshold,
      });

      const allPoints: HybridResult[] = [];
      for (const collection of ['episodic', 'declarative', 'procedural'] as const) {
        for (const point of results[collection]) {
          allPoints.push({
            content: point.content,
            score: point.score,
            source: 'vector',
            metadata: { ...point.metadata, collection },
          });
        }
      }
      return allPoints;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      console.error(`[HybridSearch] Vector search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) to merge ranked lists
   * RRF_score = sum(1 / (k + rank_i)) for each list where document appears
   */
  private reciprocalRankFusion(
    keywordResults: HybridResult[],
    vectorResults: HybridResult[],
    topK: number,
  ): HybridResult[] {
    const scoreMap = new Map<string, { score: number; result: HybridResult; sources: Set<string> }>();

    // Score keyword results
    keywordResults.forEach((result, rank) => {
      const key = result.content.substring(0, 200);
      const rrfScore = 1 / (this.RRF_K + rank + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add('keyword');
      } else {
        scoreMap.set(key, { score: rrfScore, result, sources: new Set(['keyword']) });
      }
    });

    // Score vector results
    vectorResults.forEach((result, rank) => {
      const key = result.content.substring(0, 200);
      const rrfScore = 1 / (this.RRF_K + rank + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add('vector');
      } else {
        scoreMap.set(key, { score: rrfScore, result, sources: new Set(['vector']) });
      }
    });

    // Sort by combined RRF score and return top-K
    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ result, score, sources }) => ({
        ...result,
        score,
        source: sources.size > 1 ? 'both' as const : (sources.has('keyword') ? 'keyword' as const : 'vector' as const),
      }));
  }
}
