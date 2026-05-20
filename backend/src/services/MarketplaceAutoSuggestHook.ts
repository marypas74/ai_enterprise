/**
 * Marketplace Auto-Suggest Hook
 *
 * Registers a `before_llm_call` hook (priority 50) that queries the Qdrant
 * `competency_catalog` collection for competency suggestions relevant to the
 * user's message.  Results are appended to `data.metadata.marketplace_suggestions`.
 *
 * Design constraints:
 *   - Never throws — always returns data unchanged on any error
 *   - 100 ms hard timeout on the Qdrant + embedding round-trip
 *   - Caches per conversation_id in Redis (TTL 5 min)
 *   - Respects global and per-user opt-out settings
 */

import { eventBus } from './EventBusService.js';
import type { HookContext } from './EventBusService.js';
import { generateEmbedding } from './EmbeddingService.js';
import { findOne } from '../database/index.js';
import type mysql from 'mysql2/promise';

// ============================================================
// Constants
// ============================================================

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = 'competency_catalog';
const SCORE_THRESHOLD = 0.75;
const TOP_K = 3;
const TIMEOUT_MS = 100;
const REDIS_TTL_SECONDS = 300; // 5 minutes

// ============================================================
// Types
// ============================================================

interface CompetencySuggestion {
  readonly id: string | number;
  readonly title: string;
  readonly description: string;
  readonly score: number;
}

// ============================================================
// Helpers
// ============================================================

function redisCacheKey(conversationId: number): string {
  return `marketplace:autosuggest:conv:${conversationId}`;
}

/**
 * Run a promise with a hard timeout. Resolves to `null` if it exceeds the limit.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timer = new Promise<null>((resolve) => {
    const id = setTimeout(() => resolve(null), ms);
    // Ensure the timer does not keep the process alive
    if (typeof id === 'object' && 'unref' in id) {
      (id as NodeJS.Timeout).unref();
    }
  });
  return Promise.race([promise, timer]);
}

// ============================================================
// Setting Checks
// ============================================================

async function isGloballyEnabled(db: mysql.Pool): Promise<boolean> {
  try {
    const row = await findOne<{ setting_value: string }>(
      db,
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      ['marketplace_autosuggest_enabled'],
    );
    // Default to enabled if the setting does not exist
    if (!row) return true;
    return row.setting_value !== '0' && row.setting_value !== 'false';
  } catch {
    // If the table/column doesn't exist yet, treat as enabled
    return true;
  }
}

async function isUserOptedIn(db: mysql.Pool, userId: number): Promise<boolean> {
  try {
    const row = await findOne<{ setting_value: string }>(
      db,
      'SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ?',
      [userId, 'marketplace_autosuggest_enabled'],
    );
    // Default to enabled if the user hasn't set a preference
    if (!row) return true;
    return row.setting_value !== '0' && row.setting_value !== 'false';
  } catch {
    return true;
  }
}

// ============================================================
// Qdrant Search
// ============================================================

async function searchCompetencies(
  db: mysql.Pool,
  messageContent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  redis?: any,
): Promise<readonly CompetencySuggestion[]> {
  const embeddingResult = await generateEmbedding(db, messageContent, redis);
  if (!embeddingResult) return [];

  const searchBody = {
    vector: embeddingResult.embedding,
    limit: TOP_K,
    score_threshold: SCORE_THRESHOLD,
    with_payload: true,
  };

  const response = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody),
    },
  );

  if (!response.ok) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const data = (await response.json()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const hits: any[] = data.result || [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  return hits.map((hit: any) => ({
    id: hit.id,
    title: hit.payload?.title ?? hit.payload?.name ?? '',
    description: hit.payload?.description ?? hit.payload?.content ?? '',
    score: hit.score,
  }));
}

// ============================================================
// Hook Registration
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
export function registerAutoSuggestHook(db: any, redis?: any): void {
  eventBus.register({
    id: 'marketplace-auto-suggest',
    name: 'Marketplace Auto-Suggest',
    hookName: 'before_llm_call',
    priority: 50,
    enabled: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    handler: async (data: any, context: HookContext) => {
      try {
        // 1. Check global setting
        const globalEnabled = await isGloballyEnabled(db);
        if (!globalEnabled) return data;

        // 2. Check per-user opt-out
        const userEnabled = await isUserOptedIn(db, context.userId);
        if (!userEnabled) return data;

        // 3. Extract message content
        const messageContent: string | undefined =
          data?.message?.content ?? data?.messages?.[data.messages.length - 1]?.content;
        if (!messageContent || typeof messageContent !== 'string') return data;

        const conversationId = context.conversationId;

        // 4. Check Redis cache
        if (redis && conversationId) {
          try {
            const cached = await redis.get(redisCacheKey(conversationId));
            if (cached) {
              const suggestions: readonly CompetencySuggestion[] = JSON.parse(cached);
              return {
                ...data,
                metadata: {
                  ...(data.metadata ?? {}),
                  marketplace_suggestions: suggestions,
                },
              };
            }
          } catch {
            // Cache read failed — continue without cache
          }
        }

        // 5. Search Qdrant with 100ms timeout
        const suggestions = await withTimeout(
          searchCompetencies(db, messageContent, redis),
          TIMEOUT_MS,
        );

        if (!suggestions || suggestions.length === 0) return data;

        // 6. Cache in Redis
        if (redis && conversationId) {
          try {
            await redis.setex(
              redisCacheKey(conversationId),
              REDIS_TTL_SECONDS,
              JSON.stringify(suggestions),
            );
          } catch {
            // Cache write failed — non-critical
          }
        }

        // 7. Append to metadata (immutable)
        return {
          ...data,
          metadata: {
            ...(data.metadata ?? {}),
            marketplace_suggestions: suggestions,
          },
        };
      } catch {
        // Never break the pipeline
        return data;
      }
    },
  });
}
