import type mysql from 'mysql2/promise';
import { findMany } from '../database/helpers.js';

interface NewItemRow {
  id: number;
  source_id: string;
  type: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  created_at: Date;
}

export interface NewItemsResult {
  readonly count: number;
  readonly items: readonly NewItemRow[];
}

export class NotificationService {
  constructor(private readonly pool: mysql.Pool) {}

  async getNewItemsSince(since: Date): Promise<NewItemsResult> {
    const items = await findMany<NewItemRow>(
      this.pool,
      `SELECT id, source_id, type, name, display_name, description, category, created_at
       FROM marketplace_catalog_items
       WHERE created_at > ?
       ORDER BY created_at DESC`,
      [since],
    );

    return { count: items.length, items };
  }
}
