import type { ModelExistsResult } from '../types.js';
import { getCachedExists, setCachedExists } from './modelExistsCache.js';

/**
 * Inputs for an HTTP-backed `verifyModelExists` call.
 * Provider implementations supply the URL + headers; the helper handles
 * caching, fetch, classification of statuses, and timeouts.
 */
export interface ModelExistsHttpInput {
    provider: string;
    modelId: string;
    url: string;
    headers?: Record<string, string>;
    /** Override fetch (used in tests). */
    fetchImpl?: typeof fetch;
    /** Optional Redis client for shared cache. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    redisClient?: any;
    /** Defaults to 8 seconds — admin requests must not hang. */
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Run a HEAD/GET-style existence check against `url` and classify the result.
 *
 * Status mapping:
 *  - 2xx       → exists=true
 *  - 404, 410  → exists=false (model is unknown / retired)
 *  - other     → exists=true with `reason` set, but result is NOT cached so the
 *                next admin attempt will retry. This prevents a transient 5xx
 *                from poisoning the cache.
 */
export async function verifyModelExistsHttp(input: ModelExistsHttpInput): Promise<ModelExistsResult> {
    const { provider, modelId, url, headers, fetchImpl, redisClient, timeoutMs } = input;

    const cached = await getCachedExists(provider, modelId, redisClient);
    if (cached) return cached;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const doFetch = fetchImpl ?? fetch;
    let response: Response;
    try {
        response = await doFetch(url, { method: 'GET', headers, signal: ctrl.signal });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
        clearTimeout(t);
        // Network / abort: do NOT cache, surface as "exists=true" so admin save
        // is not blocked by transient connectivity (verified=false-positive is
        // less harmful than blocking a legitimate save).
        return { exists: true, fetchedAt: new Date(), reason: `network_error:${err?.name || 'unknown'}` };
    }
    clearTimeout(t);

    if (response.status >= 200 && response.status < 300) {
        const result: ModelExistsResult = { exists: true, fetchedAt: new Date() };
        await setCachedExists(provider, modelId, result, redisClient);
        return result;
    }

    if (response.status === 404 || response.status === 410) {
        const result: ModelExistsResult = {
            exists: false,
            fetchedAt: new Date(),
            reason: `http_${response.status}`,
        };
        await setCachedExists(provider, modelId, result, redisClient);
        return result;
    }

    // Auth errors / 5xx → uncached "exists" so the admin can retry.
    return {
        exists: true,
        fetchedAt: new Date(),
        reason: `http_${response.status}_uncached`,
    };
}
