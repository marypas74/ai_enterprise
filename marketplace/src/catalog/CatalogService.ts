import type mysql from 'mysql2/promise';
import type { QdrantClient } from '../qdrant/QdrantClient.js';
import { findOne, findMany } from '../database/helpers.js';

interface CatalogListOptions {
  readonly type?: string;
  readonly tier?: string;
  readonly category?: string;
  readonly search?: string;
  readonly page?: number;
  readonly limit?: number;
}

interface CatalogListResult {
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

const COLLECTION_NAME = 'competency_catalog';

export class CatalogService {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly qdrantClient?: QdrantClient,
    private readonly backendUrl?: string,
    private readonly serviceToken?: string,
  ) {}

  async list(opts: CatalogListOptions): Promise<CatalogListResult> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;

    const { whereClause, whereParams } = this.buildWhereClause(opts);

    const countRow = await findOne<{ total: number }>(
      this.pool,
      `SELECT COUNT(*) AS total FROM marketplace_catalog_items ${whereClause}`,
      whereParams,
    );
    const total = countRow?.total ?? 0;

    const items = await findMany<Record<string, unknown>>(
      this.pool,
      `SELECT * FROM marketplace_catalog_items ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset],
    );

    return { items, total, page, limit };
  }

  async getById(id: number): Promise<Record<string, unknown> | null> {
    return findOne<Record<string, unknown>>(
      this.pool,
      'SELECT * FROM marketplace_catalog_items WHERE id = ?',
      [id],
    );
  }

  async search(query: string): Promise<readonly Record<string, unknown>[]> {
    if (this.qdrantClient && this.backendUrl) {
      try {
        const available = await this.qdrantClient.isAvailable();
        if (available) {
          return await this.semanticSearch(query);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[CatalogService] Semantic search failed, falling back to SQL: ${message}`);
      }
    }

    return this.sqlFallbackSearch(query);
  }

  private async semanticSearch(query: string): Promise<readonly Record<string, unknown>[]> {
    const embedding = await this.generateQueryEmbedding(query);
    const results = await this.qdrantClient!.search(COLLECTION_NAME, embedding, 20);

    if (results.length === 0) {
      return [];
    }

    const ids = results.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const items = await findMany<Record<string, unknown>>(
      this.pool,
      `SELECT * FROM marketplace_catalog_items WHERE id IN (${placeholders})`,
      ids,
    );

    const scoreMap = new Map(results.map((r) => [r.id, r.score]));
    return items
      .map((item) => ({
        ...item,
        search_score: scoreMap.get(item.id as number) ?? 0,
      }))
      .sort((a, b) => (b.search_score as number) - (a.search_score as number));
  }

  private async sqlFallbackSearch(query: string): Promise<readonly Record<string, unknown>[]> {
    const searchTerm = `%${query}%`;
    return findMany<Record<string, unknown>>(
      this.pool,
      `SELECT * FROM marketplace_catalog_items
       WHERE name LIKE ? OR description LIKE ?
       ORDER BY id ASC LIMIT 20`,
      [searchTerm, searchTerm],
    );
  }

  private async generateQueryEmbedding(text: string): Promise<readonly number[]> {
    const response = await fetch(`${this.backendUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.serviceToken ?? ''}`,
      },
      body: JSON.stringify({ texts: [text] }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Embedding endpoint returned ${response.status}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    return data.embeddings[0];
  }

  private buildWhereClause(opts: CatalogListOptions): {
    readonly whereClause: string;
    readonly whereParams: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }

    if (opts.tier) {
      conditions.push('tier = ?');
      params.push(opts.tier);
    }

    if (opts.category) {
      conditions.push('category = ?');
      params.push(opts.category);
    }

    if (opts.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)');
      const searchTerm = `%${opts.search}%`;
      params.push(searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    return { whereClause, whereParams: params };
  }
}
