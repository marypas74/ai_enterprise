/**
 * Embedding Service
 * Generates text embeddings using configured AI providers (OpenAI, Ollama).
 *
 * v9.3 changes:
 *   - Dynamic dimension detection from API response (no hardcoded dimension map)
 *   - Ollama: uses /api/embed (new) with native batch support, fallback to /api/embeddings
 *   - Cache key includes model ID to prevent stale hits on model change
 *   - Supports qwen3-embedding, bge-m3, snowflake-arctic-embed, and all future models
 *   - Fetch timeouts on all production calls (30s single, 60s batch)
 *   - Race-condition guard on provider detection (in-flight promise coalescing)
 */

import { findOne, findMany } from '../database/index.js';
import { createHash } from 'crypto';
import type mysql from 'mysql2/promise';
import { CACHE_TTL, CACHE_KEYS } from '../cache/index.js';

// ============================================================
// Constants
// ============================================================

const FETCH_TIMEOUT_SINGLE = 30_000;
const FETCH_TIMEOUT_BATCH = 60_000;
const FETCH_TIMEOUT_PROBE = 10_000;

// ============================================================
// Types
// ============================================================

interface EmbeddingProvider {
    readonly name: string;
    readonly type: string;
    readonly baseUrl: string;
    readonly apiKey: string | null;
    readonly modelId: string;
    readonly dimensions: number;
}

export interface EmbeddingResult {
    readonly embedding: number[];
    readonly model: string;
    readonly dimensions: number;
}

// ============================================================
// Provider Detection (with in-flight coalescing)
// ============================================================

let cachedProvider: EmbeddingProvider | null = null;
let detectionPromise: Promise<EmbeddingProvider | null> | null = null;

/**
 * Auto-detect available embedding provider from DB configuration.
 * Coalesces concurrent calls to prevent thundering herd on cold start.
 */
export async function detectEmbeddingProvider(db: mysql.Pool): Promise<EmbeddingProvider | null> {
    if (cachedProvider) return cachedProvider;
    if (detectionPromise) return detectionPromise;

    detectionPromise = doDetectProvider(db).finally(() => {
        detectionPromise = null;
    });
    return detectionPromise;
}

async function doDetectProvider(db: mysql.Pool): Promise<EmbeddingProvider | null> {
    try {
        // Single query: join model + provider in one round trip
        const row = await findOne<{
            model_id: string;
            provider_id: number;
            context_window: number;
            provider_name: string;
            provider_type: string;
        }>(
            db,
            `SELECT m.model_id, m.provider_id, m.context_window,
                    p.name AS provider_name, p.provider_type
             FROM ai_models m
             JOIN ai_providers p ON m.provider_id = p.id
             WHERE m.model_type = 'embedding'
               AND m.is_enabled = TRUE
               AND p.is_enabled = TRUE
             ORDER BY m.sort_order ASC
             LIMIT 1`
        );

        if (!row) return null;

        const settings = await findMany<{
            setting_key: string;
            setting_value: string;
            is_secret: boolean;
        }>(
            db,
            'SELECT setting_key, setting_value, is_secret FROM ai_provider_settings WHERE provider_id = ?',
            [row.provider_id]
        );

        const config: Record<string, string> = {};
        for (const s of settings) {
            config[s.setting_key] = s.setting_value;
        }

        // PERF-79-B1: For ollama providers, prefer OLLAMA_EMBED_BASE_URL (CPU-only embed instance)
        // over OLLAMA_BASE_URL (GPU instance shared with OCR). Falls back to DB config or defaults.
        const ollamaEmbedBaseUrl = process.env.OLLAMA_EMBED_BASE_URL?.replace(/\/$/, '');
        const defaultBaseUrl = row.provider_type === 'ollama' && ollamaEmbedBaseUrl
            ? ollamaEmbedBaseUrl
            : (row.provider_type === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434');
        const baseUrl = (config.base_url || defaultBaseUrl).replace(/\/$/, '');

        const dimensions = await probeDimensions(row.provider_type, baseUrl, config.api_key || null, row.model_id);

        cachedProvider = {
            name: row.provider_name,
            type: row.provider_type,
            baseUrl,
            apiKey: config.api_key || null,
            modelId: row.model_id,
            dimensions,
        };

        console.info(`[EmbeddingService] Provider detected: ${cachedProvider.modelId} (${dimensions}d, ${row.provider_type})`);
        return cachedProvider;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[EmbeddingService] Provider detection failed: ${msg}`);
        return null;
    }
}

/**
 * Probe actual embedding dimensions by sending a short test string.
 * Falls back to heuristic if the probe fails.
 */
async function probeDimensions(
    providerType: string,
    baseUrl: string,
    apiKey: string | null,
    modelId: string,
): Promise<number> {
    try {
        if (providerType === 'ollama') {
            const resp = await fetch(`${baseUrl}/api/embed`, {
                method: 'POST',
                headers: ollamaHeaders(),
                body: JSON.stringify({ model: modelId, input: 'dimension probe' }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_PROBE),
            });

            if (resp.ok) {
                const data = await resp.json() as any;
                const vec = data.embeddings?.[0];
                if (Array.isArray(vec) && vec.length > 0) return vec.length;
            }
        } else {
            const resp = await fetch(`${baseUrl}/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ model: modelId, input: 'dimension probe' }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_PROBE),
            });

            if (resp.ok) {
                const data = await resp.json() as any;
                const vec = data.data?.[0]?.embedding;
                if (Array.isArray(vec) && vec.length > 0) return vec.length;
            }
        }
    } catch {
        // probe failed — use heuristic fallback
    }

    // Heuristic fallback (only used if probe fails)
    if (modelId.includes('3-large')) return 3072;
    if (modelId.includes('bge-m3') || modelId.includes('qwen3-embedding')) return 1024;
    if (modelId.includes('nomic') || modelId.includes('snowflake-arctic')) return 768;
    return 1536;
}

/**
 * Clear cached provider (call when settings change or model is switched)
 */
export function clearEmbeddingCache(): void {
    cachedProvider = null;
}

// ============================================================
// Cache key helper
// ============================================================

function embeddingCacheKey(modelId: string, text: string): string {
    const hash = createHash('sha256')
        .update(modelId)
        .update('\0')
        .update(text)
        .digest('hex');
    return CACHE_KEYS.EMBEDDING(hash);
}

// ============================================================
// Embedding Generation
// ============================================================

/**
 * Generate embedding for a single text string.
 * Optionally caches results in Redis (keyed by model+text hash).
 */
export async function generateEmbedding(
    db: mysql.Pool,
    text: string,
    redis?: any
): Promise<EmbeddingResult | null> {
    const provider = await detectEmbeddingProvider(db);
    if (!provider) {
        console.warn('[EmbeddingService] No embedding provider configured');
        return null;
    }

    const cacheKey = redis ? embeddingCacheKey(provider.modelId, text) : null;
    if (redis && cacheKey) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch { /* cache miss, proceed */ }
    }

    try {
        let result: EmbeddingResult;
        switch (provider.type) {
            case 'openai':
            case 'openai_compatible':
                result = await generateOpenAIEmbedding(provider, text);
                break;
            case 'ollama':
                result = await generateOllamaEmbedding(provider, text);
                break;
            default:
                result = await generateOpenAIEmbedding(provider, text);
        }

        if (redis && cacheKey) {
            try {
                await redis.setex(cacheKey, CACHE_TTL.EMBEDDING, JSON.stringify(result));
            } catch { /* cache write failed, non-critical */ }
        }

        return result;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[EmbeddingService] Embedding generation failed: ${msg}`);
        return null;
    }
}

/**
 * Generate embeddings for multiple texts (batch).
 * Uses native batch API for both OpenAI and Ollama /api/embed.
 */
export async function generateEmbeddings(
    db: mysql.Pool,
    texts: string[]
): Promise<(EmbeddingResult | null)[]> {
    const provider = await detectEmbeddingProvider(db);
    if (!provider) {
        return texts.map(() => null);
    }

    try {
        if (provider.type === 'openai' || provider.type === 'openai_compatible') {
            return await generateOpenAIEmbeddingBatch(provider, texts);
        }
        if (provider.type === 'ollama') {
            return await generateOllamaEmbeddingBatch(provider, texts);
        }
        return await sequentialFallback(db, texts);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[EmbeddingService] Batch embedding failed: ${msg}`);
        return texts.map(() => null);
    }
}

async function sequentialFallback(
    db: mysql.Pool,
    texts: string[],
): Promise<(EmbeddingResult | null)[]> {
    const results: (EmbeddingResult | null)[] = [];
    for (const text of texts) {
        try {
            results.push(await generateEmbedding(db, text));
        } catch {
            results.push(null);
        }
    }
    return results;
}

// ============================================================
// OpenAI provider
// ============================================================

async function generateOpenAIEmbedding(
    provider: EmbeddingProvider,
    text: string
): Promise<EmbeddingResult> {
    const response = await fetch(`${provider.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({ model: provider.modelId, input: text }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_SINGLE),
    });

    if (!response.ok) {
        throw new Error(`OpenAI embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const embedding = data.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding response from OpenAI');
    }

    return { embedding, model: provider.modelId, dimensions: embedding.length };
}

async function generateOpenAIEmbeddingBatch(
    provider: EmbeddingProvider,
    texts: string[]
): Promise<(EmbeddingResult | null)[]> {
    const response = await fetch(`${provider.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({ model: provider.modelId, input: texts }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_BATCH),
    });

    if (!response.ok) {
        throw new Error(`OpenAI batch embedding API error: ${response.status}`);
    }

    const data = await response.json() as any;
    return (data.data || []).map((item: any) => {
        if (!Array.isArray(item?.embedding) || item.embedding.length === 0) return null;
        return { embedding: item.embedding, model: provider.modelId, dimensions: item.embedding.length };
    });
}

// ============================================================
// Ollama provider — uses /api/embed (new, with batch support)
// ============================================================

function ollamaHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authKey = process.env.OLLAMA_AUTH_KEY || '';
    if (authKey) headers['X-Ollama-Key'] = authKey;
    return headers;
}

async function generateOllamaEmbedding(
    provider: EmbeddingProvider,
    text: string
): Promise<EmbeddingResult> {
    // Try new /api/embed first (supports batch, returns "embeddings" array)
    const embedResp = await fetch(`${provider.baseUrl}/api/embed`, {
        method: 'POST',
        headers: ollamaHeaders(),
        body: JSON.stringify({ model: provider.modelId, input: text }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_SINGLE),
    });

    if (embedResp.ok) {
        const data = await embedResp.json() as any;
        const embedding = data.embeddings?.[0];
        if (Array.isArray(embedding) && embedding.length > 0) {
            return { embedding, model: provider.modelId, dimensions: embedding.length };
        }
        console.warn('[EmbeddingService] /api/embed returned ok but no embedding vector; falling back to legacy');
    }

    // Fallback: legacy /api/embeddings (returns single "embedding" array)
    const legacyResp = await fetch(`${provider.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: ollamaHeaders(),
        body: JSON.stringify({ model: provider.modelId, prompt: text }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_SINGLE),
    });

    if (!legacyResp.ok) {
        throw new Error(`Ollama embedding API error: ${legacyResp.status}`);
    }

    const data = await legacyResp.json() as any;
    const embedding = data.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding response from Ollama');
    }

    return { embedding, model: provider.modelId, dimensions: embedding.length };
}

/**
 * Batch embeddings via Ollama /api/embed (native batch support).
 * Falls back to sequential if batch call fails.
 */
async function generateOllamaEmbeddingBatch(
    provider: EmbeddingProvider,
    texts: string[]
): Promise<(EmbeddingResult | null)[]> {
    const resp = await fetch(`${provider.baseUrl}/api/embed`, {
        method: 'POST',
        headers: ollamaHeaders(),
        body: JSON.stringify({ model: provider.modelId, input: texts }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_BATCH),
    });

    if (!resp.ok) {
        console.warn(`[EmbeddingService] Ollama batch failed (${resp.status}), falling back to sequential`);
        const results: (EmbeddingResult | null)[] = [];
        for (const text of texts) {
            try {
                results.push(await generateOllamaEmbedding(provider, text));
            } catch {
                results.push(null);
            }
        }
        return results;
    }

    const data = await resp.json() as any;
    const embeddings: number[][] = data.embeddings || [];

    return texts.map((_, i) => {
        const vec = embeddings[i];
        if (!Array.isArray(vec) || vec.length === 0) return null;
        return { embedding: vec, model: provider.modelId, dimensions: vec.length };
    });
}
