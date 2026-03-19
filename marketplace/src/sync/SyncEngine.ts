import type mysql from 'mysql2/promise';
import type { SourceAdapter } from './CLIAdapter.js';
import type { CatalogItemInput } from './CatalogParser.js';
import type { EmbeddingIndexer } from '../qdrant/EmbeddingIndexer.js';
import { parseRawCatalog } from './CatalogParser.js';
import { HealthChecker } from './HealthChecker.js';
import { calculateDiff } from './DiffCalculator.js';
import { findMany, execute } from '../database/helpers.js';

const COMPONENT_TYPES = ['skill', 'agent', 'mcp', 'hook'] as const;

export interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly errors: readonly string[];
}

interface LocalRow {
  source_id: string;
  version: string;
}

export class SyncEngine {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly adapter: SourceAdapter,
    private readonly healthChecker: HealthChecker,
    private readonly embeddingIndexer?: EmbeddingIndexer,
  ) {}

  async sync(): Promise<SyncResult> {
    if (this.healthChecker.isSuspended()) {
      throw new Error('Sync suspended');
    }

    const healthy = await this.healthChecker.check();
    if (!healthy) {
      await this.updateSyncState({
        status: 'failed',
        error_message: 'Health check failed',
        consecutive_failures: this.healthChecker.getConsecutiveFailures(),
      });
      return { added: 0, updated: 0, removed: 0, errors: ['Health check failed'] };
    }

    const errors: string[] = [];
    const allRemoteItems: CatalogItemInput[] = [];

    for (const type of COMPONENT_TYPES) {
      try {
        const raw = this.adapter.fetchComponents(type);
        const parsed = parseRawCatalog(raw, type);
        allRemoteItems.push(...parsed);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to fetch ${type}: ${message}`);
      }
    }

    const localRows = await findMany<LocalRow>(
      this.pool,
      'SELECT source_id, version FROM marketplace_catalog_items',
    );

    const localSourceIds = new Set(localRows.map((r) => r.source_id));
    const localVersions = new Map(localRows.map((r) => [r.source_id, r.version]));

    const diff = calculateDiff(allRemoteItems, localSourceIds, localVersions);

    await this.applyAdded(diff.added);
    await this.applyUpdated(diff.updated);
    await this.applyRemoved(diff.removed);

    const status = this.healthChecker.isSuspended() ? 'suspended' : 'success';
    await this.updateSyncState({
      status,
      items_added: diff.added.length,
      items_updated: diff.updated.length,
      items_removed: diff.removed.length,
      consecutive_failures: 0,
      error_message: errors.length > 0 ? errors.join('; ') : null,
    });

    if (this.embeddingIndexer) {
      try {
        const indexed = await this.embeddingIndexer.indexUnindexedItems();
        if (indexed > 0) {
          console.log(`[SyncEngine] Indexed ${indexed} items into Qdrant`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[SyncEngine] Embedding indexing failed (non-fatal): ${message}`);
      }
    }

    return {
      added: diff.added.length,
      updated: diff.updated.length,
      removed: diff.removed.length,
      errors,
    };
  }

  private async applyAdded(items: readonly CatalogItemInput[]): Promise<void> {
    for (const item of items) {
      await execute(
        this.pool,
        `INSERT INTO marketplace_catalog_items
         (source_id, type, tier, name, display_name, description, category, metadata, version, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          item.source_id,
          item.type,
          item.tier,
          item.name,
          item.display_name,
          item.description,
          item.category,
          JSON.stringify(item.metadata),
          item.version,
        ],
      );
    }
  }

  private async applyUpdated(items: readonly CatalogItemInput[]): Promise<void> {
    for (const item of items) {
      await execute(
        this.pool,
        `UPDATE marketplace_catalog_items
         SET type = ?, tier = ?, name = ?, display_name = ?, description = ?,
             category = ?, metadata = ?, version = ?, last_synced_at = NOW()
         WHERE source_id = ?`,
        [
          item.type,
          item.tier,
          item.name,
          item.display_name,
          item.description,
          item.category,
          JSON.stringify(item.metadata),
          item.version,
          item.source_id,
        ],
      );
    }
  }

  private async applyRemoved(sourceIds: readonly string[]): Promise<void> {
    for (const sourceId of sourceIds) {
      await execute(
        this.pool,
        'DELETE FROM marketplace_catalog_items WHERE source_id = ?',
        [sourceId],
      );
    }
  }

  private async updateSyncState(state: {
    status: string;
    items_added?: number;
    items_updated?: number;
    items_removed?: number;
    consecutive_failures?: number;
    error_message?: string | null;
  }): Promise<void> {
    await execute(
      this.pool,
      `INSERT INTO marketplace_sync_state
       (id, last_sync_at, status, items_added, items_updated, items_removed, consecutive_failures, error_message)
       VALUES (1, NOW(), ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_sync_at = NOW(),
         status = VALUES(status),
         items_added = VALUES(items_added),
         items_updated = VALUES(items_updated),
         items_removed = VALUES(items_removed),
         consecutive_failures = VALUES(consecutive_failures),
         error_message = VALUES(error_message)`,
      [
        state.status,
        state.items_added ?? 0,
        state.items_updated ?? 0,
        state.items_removed ?? 0,
        state.consecutive_failures ?? 0,
        state.error_message ?? null,
      ],
    );
  }
}
