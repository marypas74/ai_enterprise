import type mysql from 'mysql2/promise';
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

export class CatalogService {
  constructor(private readonly pool: mysql.Pool) {}

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

  async search(_query: string): Promise<readonly Record<string, unknown>[]> {
    // Stub for Phase 4 (Qdrant integration)
    return [];
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
