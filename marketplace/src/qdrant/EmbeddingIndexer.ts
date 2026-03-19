import type mysql from 'mysql2/promise';
import type { QdrantClient, QdrantPoint } from './QdrantClient.js';
import { findMany, execute } from '../database/helpers.js';

const COLLECTION_NAME = 'competency_catalog';
const EMBEDDING_DIMENSIONS = 384;
const BATCH_LIMIT = 50;

interface UnindexedItem {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly type: string;
  readonly tier: string;
}

interface EmbeddingResponse {
  readonly embeddings: readonly number[][];
}

export class EmbeddingIndexer {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly qdrantClient: QdrantClient,
    private readonly backendUrl: string,
    private readonly serviceToken: string,
  ) {}

  async indexUnindexedItems(): Promise<number> {
    const available = await this.qdrantClient.isAvailable();
    if (!available) {
      console.warn('[EmbeddingIndexer] Qdrant not available, skipping indexing');
      return 0;
    }

    await this.qdrantClient.ensureCollection(COLLECTION_NAME, EMBEDDING_DIMENSIONS);

    const items = await findMany<UnindexedItem>(
      this.pool,
      `SELECT id, name, description, category, type, tier
       FROM marketplace_catalog_items
       WHERE embedding_indexed = FALSE
       LIMIT ?`,
      [BATCH_LIMIT],
    );

    if (items.length === 0) {
      return 0;
    }

    const texts = items.map((item) => this.buildTextForEmbedding(item));

    let embeddings: readonly number[][];
    try {
      embeddings = await this.generateEmbeddings(texts);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[EmbeddingIndexer] Embedding generation failed: ${message}`);
      return 0;
    }

    if (embeddings.length !== items.length) {
      console.warn('[EmbeddingIndexer] Embedding count mismatch, skipping indexing');
      return 0;
    }

    const points: QdrantPoint[] = items.map((item, idx) => ({
      id: item.id,
      vector: [...embeddings[idx]],
      payload: {
        name: item.name,
        description: item.description ?? '',
        category: item.category ?? '',
        type: item.type,
        tier: item.tier,
      },
    }));

    await this.qdrantClient.upsertPoints(COLLECTION_NAME, points);

    const ids = items.map((item) => item.id);
    await execute(
      this.pool,
      `UPDATE marketplace_catalog_items SET embedding_indexed = TRUE WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );

    return items.length;
  }

  private buildTextForEmbedding(item: UnindexedItem): string {
    const parts = [item.name];
    if (item.description) {
      parts.push(item.description);
    }
    if (item.category) {
      parts.push(item.category);
    }
    return parts.join(' ');
  }

  private async generateEmbeddings(texts: readonly string[]): Promise<readonly number[][]> {
    const response = await fetch(`${this.backendUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.serviceToken}`,
      },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Embedding endpoint returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as EmbeddingResponse;
    return data.embeddings;
  }
}
