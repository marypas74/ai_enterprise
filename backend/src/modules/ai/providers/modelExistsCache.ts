import type { ModelExistsResult } from '../types.js';

/**
 * Cache layer for `verifyModelExists` results.
 *
 * Tries Redis first (when a client is provided), falls back to an in-process
 * Map. TTL is fixed at 1 hour — model lifecycles on remote providers are
 * measured in days, but admin actions (enabling a freshly-published model)
 * should not be blocked for too long after a release.
 *
 * Pure / immutable: every entry is stored as a frozen object.
 */
const TTL_SECONDS = 3600;
const memoryCache = new Map<string, { value: Readonly<ModelExistsResult>; ts: number }>();
const MAX_MEMORY_ENTRIES = 1000;

export function buildCacheKey(provider: string, modelId: string): string {
    return `model:exists:${provider}:${modelId}`;
}

/** Read from cache. Returns `null` on miss / expired / I/O error. */
export async function getCachedExists(
    provider: string,
    modelId: string,
    redisClient?: any,
): Promise<Readonly<ModelExistsResult> | null> {
    const key = buildCacheKey(provider, modelId);

    if (redisClient) {
        try {
            const raw = await redisClient.get(key);
            if (raw) {
                const parsed = JSON.parse(raw) as ModelExistsResult;
                return Object.freeze({ ...parsed, fetchedAt: new Date(parsed.fetchedAt) });
            }
        } catch {
            // Redis unavailable — fall through to memory
        }
    }

    const entry = memoryCache.get(key);
    if (entry && Date.now() - entry.ts < TTL_SECONDS * 1000) {
        return entry.value;
    }
    if (entry) memoryCache.delete(key);
    return null;
}

/** Write a fresh result to both Redis (if available) and memory. */
export async function setCachedExists(
    provider: string,
    modelId: string,
    result: ModelExistsResult,
    redisClient?: any,
): Promise<void> {
    const key = buildCacheKey(provider, modelId);
    const frozen = Object.freeze({ ...result });

    if (redisClient) {
        try {
            await redisClient.set(key, JSON.stringify(frozen), 'EX', TTL_SECONDS);
        } catch {
            // Best-effort cache; ignore Redis errors so the caller is unaffected
        }
    }

    if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
        const oldest = memoryCache.keys().next().value;
        if (oldest) memoryCache.delete(oldest);
    }
    memoryCache.set(key, { value: frozen, ts: Date.now() });
}

/** Test helper: drop every in-memory entry. Not exported in production paths. */
export function __resetMemoryCacheForTests(): void {
    memoryCache.clear();
}
