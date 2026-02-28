/**
 * Embedding Service
 * Generates text embeddings using configured AI providers (OpenAI, Ollama)
 */

import { findOne, findMany } from '../database/index.js';
import { createHash } from 'crypto';
import type mysql from 'mysql2/promise';
import { CACHE_TTL, CACHE_KEYS } from '../cache/index.js';

// ============================================================
// Types
// ============================================================

interface EmbeddingProvider {
    name: string;
    type: string;
    baseUrl: string;
    apiKey: string | null;
    modelId: string;
    dimensions: number;
}

export interface EmbeddingResult {
    embedding: number[];
    model: string;
    dimensions: number;
}

// ============================================================
// Provider Detection
// ============================================================

let cachedProvider: EmbeddingProvider | null = null;

/**
 * Auto-detect available embedding provider from DB configuration
 */
export async function detectEmbeddingProvider(db: mysql.Pool): Promise<EmbeddingProvider | null> {
    if (cachedProvider) return cachedProvider;

    try {
        // Look for enabled embedding models
        const embeddingModel = await findOne<{
            model_id: string;
            provider_id: number;
            context_window: number;
        }>(
            db,
            `SELECT m.model_id, m.provider_id, m.context_window
       FROM ai_models m
       JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.model_type = 'embedding'
         AND m.is_enabled = TRUE
         AND p.is_enabled = TRUE
       ORDER BY m.sort_order ASC
       LIMIT 1`
        );

        if (!embeddingModel) return null;

        // Get provider details
        const provider = await findOne<{
            name: string;
            provider_type: string;
        }>(
            db,
            'SELECT name, provider_type FROM ai_providers WHERE id = ?',
            [embeddingModel.provider_id]
        );

        if (!provider) return null;

        // Get provider settings
        const settings = await findMany<{
            setting_key: string;
            setting_value: string;
            is_secret: boolean;
        }>(
            db,
            'SELECT setting_key, setting_value, is_secret FROM ai_provider_settings WHERE provider_id = ?',
            [embeddingModel.provider_id]
        );

        const config: Record<string, string> = {};
        for (const s of settings) {
            config[s.setting_key] = s.setting_value;
        }

        // Determine dimensions based on model
        let dimensions = 1536; // default for text-embedding-3-small
        if (embeddingModel.model_id.includes('nomic')) dimensions = 768;
        if (embeddingModel.model_id.includes('3-large')) dimensions = 3072;

        cachedProvider = {
            name: provider.name,
            type: provider.provider_type,
            baseUrl: config.base_url || (provider.name === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434'),
            apiKey: config.api_key || null,
            modelId: embeddingModel.model_id,
            dimensions,
        };

        return cachedProvider;
    } catch (error: any) {
        console.error(`[EmbeddingService] Provider detection failed: ${error.message}`);
        return null;
    }
}

/**
 * Clear cached provider (call when settings change)
 */
export function clearEmbeddingCache(): void {
    cachedProvider = null;
}

// ============================================================
// Embedding Generation
// ============================================================

/**
 * Generate embeddings for a text string.
 * Optionally caches results in Redis (v4.0: embedding caching).
 */
export async function generateEmbedding(
    db: mysql.Pool,
    text: string,
    redis?: any
): Promise<EmbeddingResult | null> {
    // v4.0: Check Redis cache first
    const cacheKey = redis ? CACHE_KEYS.EMBEDDING(createHash('sha256').update(text).digest('hex')) : null;
    if (redis && cacheKey) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch { /* cache miss or error, proceed */ }
    }

    const provider = await detectEmbeddingProvider(db);
    if (!provider) {
        console.warn('[EmbeddingService] No embedding provider configured');
        return null;
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
                // Try OpenAI-compatible API as fallback
                result = await generateOpenAIEmbedding(provider, text);
        }

        // v4.0: Store in Redis cache (TTL 24h)
        if (redis && cacheKey) {
            try {
                await redis.setex(cacheKey, CACHE_TTL.EMBEDDING, JSON.stringify(result));
            } catch { /* cache write failed, non-critical */ }
        }

        return result;
    } catch (error: any) {
        console.error(`[EmbeddingService] Embedding generation failed: ${error.message}`);
        return null;
    }
}

/**
 * Generate embeddings for multiple texts (batch)
 */
export async function generateEmbeddings(
    db: mysql.Pool,
    texts: string[]
): Promise<(EmbeddingResult | null)[]> {
    const provider = await detectEmbeddingProvider(db);
    if (!provider) {
        return texts.map(() => null);
    }

    // For OpenAI, batch is supported natively
    if (provider.type === 'openai' || provider.type === 'openai_compatible') {
        try {
            return await generateOpenAIEmbeddingBatch(provider, texts);
        } catch (error: any) {
            console.error(`[EmbeddingService] Batch embedding failed: ${error.message}`);
            return texts.map(() => null);
        }
    }

    // For others, process one by one
    const results: (EmbeddingResult | null)[] = [];
    for (const text of texts) {
        try {
            const result = await generateEmbedding(db, text);
            results.push(result);
        } catch {
            results.push(null);
        }
    }
    return results;
}

// ============================================================
// Provider-specific implementations
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
        body: JSON.stringify({
            model: provider.modelId,
            input: text,
        }),
    });

    if (!response.ok) {
        throw new Error(`OpenAI embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const embedding = data.data?.[0]?.embedding;

    if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from OpenAI');
    }

    return {
        embedding,
        model: provider.modelId,
        dimensions: embedding.length,
    };
}

async function generateOpenAIEmbeddingBatch(
    provider: EmbeddingProvider,
    texts: string[]
): Promise<EmbeddingResult[]> {
    const response = await fetch(`${provider.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
            model: provider.modelId,
            input: texts,
        }),
    });

    if (!response.ok) {
        throw new Error(`OpenAI batch embedding API error: ${response.status}`);
    }

    const data = await response.json() as any;
    return (data.data || []).map((item: any) => ({
        embedding: item.embedding,
        model: provider.modelId,
        dimensions: item.embedding.length,
    }));
}

async function generateOllamaEmbedding(
    provider: EmbeddingProvider,
    text: string
): Promise<EmbeddingResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authKey = process.env.OLLAMA_AUTH_KEY || '';
    if (authKey) headers['X-Ollama-Key'] = authKey;

    const response = await fetch(`${provider.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: provider.modelId,
            prompt: text,
        }),
    });

    if (!response.ok) {
        throw new Error(`Ollama embedding API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const embedding = data.embedding;

    if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from Ollama');
    }

    return {
        embedding,
        model: provider.modelId,
        dimensions: embedding.length,
    };
}
