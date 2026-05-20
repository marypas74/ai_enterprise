/**
 * ProviderRegistryService — DEBT-82-F
 *
 * Maintains an in-process cache of provider_override values loaded from the
 * ai_models DB table.  Loaded once at startup and refreshed every 60 seconds.
 *
 * This allows AIProviderFactory.getProviderName() to consult DB-driven overrides
 * without making synchronous DB calls (the static getProviderName method must
 * remain synchronous for backward compatibility with all callers).
 *
 * Usage:
 *   1. Call ProviderRegistryService.init(pool) once at backend startup (after DB init).
 *   2. AIProviderFactory.getProviderName() will automatically consult the cache.
 */

import type mysql from 'mysql2/promise';
import type { ProviderType } from './types.js';

interface ModelOverrideRow {
  readonly model_id: string;
  readonly provider_override: string;
}

const VALID_PROVIDER_TYPES = new Set<string>([
  'openai', 'anthropic', 'google', 'ollama', 'vllm', 'custom',
]);

function isValidProviderType(value: string): value is ProviderType {
  return VALID_PROVIDER_TYPES.has(value);
}

export class ProviderRegistryService {
  // model_id → ProviderType override (populated from DB)
  private static overrideCache = new Map<string, ProviderType>();
  private static refreshTimer: NodeJS.Timeout | null = null;
  private static pool: mysql.Pool | null = null;
  private static readonly REFRESH_INTERVAL_MS = 60_000;

  /**
   * Initialise the service. Must be called once after the DB pool is ready.
   * Performs the first load synchronously (awaited) then schedules background refreshes.
   */
  static async init(pool: mysql.Pool): Promise<void> {
    ProviderRegistryService.pool = pool;
    await ProviderRegistryService.refresh();
    if (ProviderRegistryService.refreshTimer) {
      clearInterval(ProviderRegistryService.refreshTimer);
    }
    ProviderRegistryService.refreshTimer = setInterval(
      () => { void ProviderRegistryService.refresh(); },
      ProviderRegistryService.REFRESH_INTERVAL_MS,
    );
  }

  /** Reload override map from DB. Silently swallows errors (non-critical). */
  static async refresh(): Promise<void> {
    if (!ProviderRegistryService.pool) return;
    try {
      const [rows] = await ProviderRegistryService.pool.execute(
        `SELECT model_id, provider_override
         FROM ai_models
         WHERE provider_override IS NOT NULL AND provider_override != ''`,
      ) as [ModelOverrideRow[], unknown];

      const newCache = new Map<string, ProviderType>();
      for (const row of rows) {
        if (isValidProviderType(row.provider_override)) {
          newCache.set(row.model_id, row.provider_override);
        }
      }
      // Atomic swap — never leave the cache in a half-built state
      ProviderRegistryService.overrideCache = newCache;
    } catch {
      // Non-critical: if the column doesn't exist yet (first deploy before migration)
      // we keep the existing cache and fall back to regex routing.
    }
  }

  /**
   * Look up the DB-driven provider override for a given model_id.
   * Returns undefined if no override is registered.
   */
  static getOverride(modelId: string): ProviderType | undefined {
    return ProviderRegistryService.overrideCache.get(modelId);
  }

  /** Stop background refresh (useful in tests / graceful shutdown). */
  static destroy(): void {
    if (ProviderRegistryService.refreshTimer) {
      clearInterval(ProviderRegistryService.refreshTimer);
      ProviderRegistryService.refreshTimer = null;
    }
    ProviderRegistryService.pool = null;
    ProviderRegistryService.overrideCache = new Map();
  }
}
