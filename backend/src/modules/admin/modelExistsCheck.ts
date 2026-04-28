import type { FastifyInstance } from 'fastify';
import { findOne } from '../../database/index.js';
import { decrypt } from '../../utils/crypto.js';
import { OpenAIProvider } from '../ai/providers/OpenAIProvider.js';
import { AnthropicProvider } from '../ai/providers/AnthropicProvider.js';
import { GoogleProvider } from '../ai/providers/GoogleProvider.js';
import { OllamaProvider } from '../ai/providers/OllamaProvider.js';
import type { ModelExistsResult } from '../ai/types.js';

/**
 * Result of an admin-side existence check. `skipped=true` indicates that no
 * verification was attempted (provider unsupported / no credentials) — admin
 * code must let the request through in this case rather than 422-blocking it.
 */
export interface VerifyOnProviderResult {
    skipped: boolean;
    result?: ModelExistsResult;
    providerType?: string;
}

interface ProviderRow {
    id: number;
    provider_type: string;
}

interface SettingRow {
    setting_key: string;
    setting_value: string;
    is_secret: 0 | 1 | boolean;
}

/**
 * Build a per-request provider instance with the admin-stored credentials and
 * the Fastify Redis client (for shared cache).
 */
async function buildProvider(
    fastify: FastifyInstance,
    providerId: number,
): Promise<{ instance: { verifyModelExists?: (id: string) => Promise<ModelExistsResult> }; type: string } | null> {
    const provider = await findOne<ProviderRow>(
        fastify.db,
        'SELECT id, provider_type FROM ai_providers WHERE id = ?',
        [providerId],
    );
    if (!provider) return null;

    const settings = await fastify.db
        .execute(
            'SELECT setting_key, setting_value, is_secret FROM ai_provider_settings WHERE provider_id = ?',
            [providerId],
        )
        .then(([rows]) => rows as SettingRow[]);

    const cfg: Record<string, string> = {};
    for (const s of settings) {
        cfg[s.setting_key] = s.is_secret ? decrypt(s.setting_value) : s.setting_value;
    }

    const redisClient = (fastify as any).redis;
    const type = provider.provider_type.toLowerCase();

    switch (type) {
        case 'openai':
            if (!cfg.api_key) return null;
            return { instance: new OpenAIProvider({ apiKey: cfg.api_key, baseUrl: cfg.base_url, redisClient }), type };
        case 'anthropic':
        case 'anthropic_api':
        case 'anthropic_oauth':
            if (!cfg.api_key && !cfg.oauth_token) return null;
            return {
                instance: new AnthropicProvider({ apiKey: cfg.api_key || cfg.oauth_token, redisClient }),
                type,
            };
        case 'google':
        case 'google_ai':
            if (!cfg.api_key) return null;
            return { instance: new GoogleProvider({ apiKey: cfg.api_key, redisClient }), type };
        case 'ollama':
            return { instance: new OllamaProvider({ baseUrl: cfg.base_url, redisClient }), type };
        default:
            // vllm / custom / unknown — skip verification
            return null;
    }
}

/**
 * Verify a model id exists on the upstream provider associated with `providerId`.
 * Returns `{skipped:true}` when no verification is possible (e.g. custom provider,
 * no API key configured) so callers can let the save through.
 */
export async function verifyModelOnProvider(
    fastify: FastifyInstance,
    providerId: number,
    modelId: string,
): Promise<VerifyOnProviderResult> {
    const built = await buildProvider(fastify, providerId);
    if (!built) return { skipped: true };
    if (typeof built.instance.verifyModelExists !== 'function') {
        return { skipped: true, providerType: built.type };
    }
    try {
        const result = await built.instance.verifyModelExists(modelId);
        return { skipped: false, result, providerType: built.type };
    } catch (err: any) {
        fastify.log.warn(
            { err: err?.message },
            `[admin] verifyModelExists failed for ${built.type}/${modelId}`,
        );
        // Defensive: surface as skipped so admin save is not blocked by an
        // upstream incident. The chat path will surface real failures later.
        return { skipped: true, providerType: built.type };
    }
}

/**
 * Build the 422 envelope returned to the frontend when a model id is not
 * recognised by the upstream provider.
 */
export function mapModelExistsErrorBody(
    modelId: string,
    providerType: string,
    reason: string | undefined,
): { code: 'MODEL_NOT_FOUND_ON_PROVIDER'; model_id: string; provider: string; suggestion: string; reason?: string } {
    return {
        code: 'MODEL_NOT_FOUND_ON_PROVIDER',
        model_id: modelId,
        provider: providerType,
        suggestion: `Il modello "${modelId}" non risulta disponibile su ${providerType}. Verifica l'identificatore e riprova, oppure salva con force=true per bypassare il controllo.`,
        reason,
    };
}
