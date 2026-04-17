import { FastifyInstance } from 'fastify';
import { findAll, findOne } from '../database/index.js';
import { AIProviderFactory, ProviderType } from '../modules/ai/providers.js';
import { fetchAllModels } from './ModelFetcher.js';
import { decrypt as decryptSecret } from '../utils/crypto.js';
import { inferModelCapabilities } from '../utils/model-capabilities.js';

/**
 * Model ID patterns that are NOT compatible with /v1/chat/completions.
 * These models target other OpenAI APIs (Realtime, Audio, TTS, Images, Responses, etc.)
 * and would cause 404 errors if used in a standard chat completion request.
 */
const CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS: RegExp[] = [
    /realtime/i,      // Realtime API (WebSockets)
    /audio/i,         // Audio/speech API
    /[-_]tts[-_]|[-_]tts$/i,  // TTS models
    /transcribe/i,    // Transcription API
    /[-_]image[-_]|[-_]image$/i, // Image generation
    /-codex/i,        // Codex (different API format)
    /search-api/i,    // Search API
    /instruct/i,      // Completion-style instruct models (not chat)
    /gpt-5-pro/i,     // Responses API only
    /diarize/i,       // Diarization API
];

function isChatCompletionsCompatible(modelId: string): boolean {
    return !CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS.some(pattern => pattern.test(modelId));
}

export class LLMSyncWorker {
    private fastify: FastifyInstance;
    private configInterval: NodeJS.Timeout | null = null;
    private modelInterval: NodeJS.Timeout | null = null;

    private readonly CONFIG_SYNC_MS = 2 * 60 * 1000;   // 2 minutes
    private readonly MODEL_SYNC_MS = 5 * 60 * 1000;    // 5 minutes (was 15)

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
    }

    public start() {
        this.fastify.log.info('[LLMSyncWorker] Starting background synchronization worker');

        // Initial sync (staggered to avoid boot overload)
        this.syncConfigs().catch(err => this.fastify.log.error(`[LLMSyncWorker] Initial config sync failed: ${err.message}`));
        setTimeout(() => {
            this.syncModels().catch(err => this.fastify.log.error(`[LLMSyncWorker] Initial model sync failed: ${err.message}`));
        }, 10000); // 10s delay for initial model sync

        this.configInterval = setInterval(() => this.syncConfigs(), this.CONFIG_SYNC_MS);
        this.modelInterval = setInterval(() => this.syncModels(), this.MODEL_SYNC_MS);
    }

    public stop() {
        if (this.configInterval) clearInterval(this.configInterval);
        if (this.modelInterval) clearInterval(this.modelInterval);
        this.fastify.log.info('[LLMSyncWorker] Background synchronization worker stopped');
    }

    /**
     * Trigger an immediate config + model sync (e.g., after admin enables/disables a provider)
     */
    public async triggerSync(): Promise<void> {
        this.fastify.log.info('[LLMSyncWorker] Triggered immediate sync (admin action)');
        await this.syncConfigs();
        await this.syncModels();
    }

    /**
     * Sync provider configurations from database to AIProviderFactory
     */
    private async syncConfigs() {
        try {
            this.fastify.log.debug('[LLMSyncWorker] Syncing provider configurations...');

            interface ProviderSetting {
                provider_name: string;
                setting_key: string;
                setting_value: string;
                is_secret: boolean;
                provider_id: number;
            }

            const providerSettings = await findAll<ProviderSetting>(
                this.fastify.db,
                `SELECT p.provider_type as provider_name, ps.setting_key, ps.setting_value, ps.is_secret, p.id as provider_id
         FROM ai_provider_settings ps
         JOIN ai_providers p ON ps.provider_id = p.id
         WHERE p.is_enabled = TRUE`
            );

            const configByProvider: Record<string, Record<string, string>> = {};
            for (const setting of providerSettings) {
                if (!configByProvider[setting.provider_name]) {
                    configByProvider[setting.provider_name] = {};
                }
                const value = setting.is_secret ? decryptSecret(setting.setting_value) : setting.setting_value;
                configByProvider[setting.provider_name][setting.setting_key] = value;
            }

            // Anthropic variants
            const anthropicOAuthSettings = configByProvider['anthropic_oauth'];
            const anthropicApiSettings = configByProvider['anthropic_api'] || configByProvider['anthropic'];
            let anthropicApiKey: string | undefined;
            if (anthropicApiSettings?.api_key) {
                anthropicApiKey = anthropicApiSettings.api_key;
            } else if (anthropicOAuthSettings?.oauth_token) {
                anthropicApiKey = anthropicOAuthSettings.oauth_token;
            }
            if (anthropicApiKey) {
                AIProviderFactory.setProviderConfig('anthropic', { apiKey: anthropicApiKey });
            }

            for (const [providerName, settings] of Object.entries(configByProvider)) {
                if (['anthropic', 'anthropic_oauth', 'anthropic_api'].includes(providerName)) continue;
                AIProviderFactory.setProviderConfig(providerName as ProviderType, {
                    apiKey: settings.api_key,
                    baseUrl: settings.base_url,
                    timeout: settings.timeout ? parseInt(settings.timeout, 10) : 120000,
                    keepAlive: settings.keep_alive || '5m'
                });
            }

            this.fastify.log.debug('[LLMSyncWorker] Provider configurations synchronized');
        } catch (error: any) {
            this.fastify.log.error(`[LLMSyncWorker] Config sync error: ${error.message}`);
        }
    }

    /**
     * Full model sync: discover new models, validate availability, auto-pull missing Ollama models
     */
    private async syncModels() {
        try {
            this.fastify.log.info('[LLMSyncWorker] Starting full model sync...');

            // 1. Sync Ollama models (validate installed vs DB)
            await this.syncOllamaModels();

            // 2. Sync API provider models (discover new, validate existing)
            await this.syncApiProviderModels();

            // 3. Disable models whose provider is disabled
            await this.disableOrphanedModels();

            this.fastify.log.info('[LLMSyncWorker] Full model sync complete');
        } catch (error: any) {
            this.fastify.log.error(`[LLMSyncWorker] Model sync error: ${error.message}`);
        }
    }

    /**
     * Ollama model sync is no longer needed — Ollama is only used for vision/embedding
     * models which are managed manually. This method is a no-op.
     */
    private async syncOllamaModels() {
        // Ollama retained only for vision/embedding — no automatic model sync needed
    }

    /**
     * Sync API provider models (OpenAI, Anthropic, Google): discover new models
     */
    private async syncApiProviderModels() {
        const providers = await findAll<any>(
            this.fastify.db,
            "SELECT id, name, display_name, provider_type FROM ai_providers WHERE is_enabled = TRUE AND provider_type != 'ollama'"
        );

        if (providers.length === 0) {
            this.fastify.log.debug('[LLMSyncWorker] No enabled API providers found');
            return;
        }

        this.fastify.log.info(`[LLMSyncWorker] Syncing ${providers.length} API provider(s): ${providers.map((p: any) => p.provider_type).join(', ')}`);

        const providerConfigs: any[] = [];
        for (const p of providers) {
            const settings = await findAll<any>(
                this.fastify.db,
                'SELECT setting_key, setting_value, is_secret FROM ai_provider_settings WHERE provider_id = ?',
                [p.id]
            );

            const config: any = { type: p.provider_type, id: p.id };
            for (const s of settings) {
                const value = s.is_secret ? decryptSecret(s.setting_value) : s.setting_value;
                if (s.setting_key === 'api_key') config.apiKey = value;
                if (s.setting_key === 'base_url') config.baseUrl = value;
            }

            if (config.apiKey || config.baseUrl) {
                providerConfigs.push(config);
                this.fastify.log.info(`[LLMSyncWorker] Provider "${p.provider_type}" has apiKey=${!!config.apiKey}, baseUrl=${config.baseUrl || 'default'}`);
            } else {
                this.fastify.log.debug(`[LLMSyncWorker] Provider "${p.provider_type}" has no apiKey or baseUrl configured, skipping`);
            }
        }

        if (providerConfigs.length === 0) {
            this.fastify.log.warn('[LLMSyncWorker] No API providers with valid config found');
            return;
        }

        const allModels = await fetchAllModels(providerConfigs);
        // Filter out models incompatible with /v1/chat/completions (Realtime, Audio, TTS, Image, etc.)
        const availableModels = allModels.filter(m => isChatCompletionsCompatible(m.id));
        const skippedCount = allModels.length - availableModels.length;
        this.fastify.log.info(`[LLMSyncWorker] fetchAllModels returned ${allModels.length} model(s), ${skippedCount} filtered (non-chat-completions): ${availableModels.map(m => `${m.provider}/${m.id}`).join(', ')}`);
        let addedCount = 0;

        for (const model of availableModels) {
            const provider = providers.find((p: any) => p.provider_type === model.provider);
            if (!provider) continue;

            const existing = await findOne<any>(
                this.fastify.db,
                'SELECT id, is_enabled FROM ai_models WHERE provider_id = ? AND model_id = ?',
                [provider.id, model.id]
            );

            if (!existing) {
                // Before inserting, check if there's an obsolete version of this model
                // e.g., DB has "claude-opus-4-6-20250610" but fetcher now returns "claude-opus-4-6"
                const obsolete = await this.findObsoleteModel(provider.id, model.id);
                if (obsolete) {
                    await this.fastify.db.execute(
                        'UPDATE ai_models SET model_id = ?, display_name = ? WHERE id = ?',
                        [model.id, model.name, obsolete.id]
                    );
                    this.fastify.log.info(`[LLMSyncWorker] Updated obsolete model ID: "${obsolete.model_id}" → "${model.id}" (${model.name})`);
                } else {
                    const caps = inferModelCapabilities(model.id);
                    await this.fastify.db.execute(
                        `INSERT INTO ai_models (provider_id, model_id, display_name, description, model_type,
                         supports_streaming, supports_functions, supports_vision, supports_thinking, is_enabled)
                         VALUES (?, ?, ?, ?, 'chat', ?, ?, ?, ?, TRUE)`,
                        [provider.id, model.id, model.name, model.description || `From ${model.provider}`,
                         caps.supports_streaming, caps.supports_functions, caps.supports_vision, caps.supports_thinking]
                    );
                    addedCount++;
                    this.fastify.log.info(`[LLMSyncWorker] Added new model: ${model.provider}/${model.id} (${model.name}) [tools=${caps.supports_functions}, vision=${caps.supports_vision}]`);
                }
            } else if (!existing.is_enabled) {
                // Re-enable models that were disabled when their provider was off
                await this.fastify.db.execute(
                    'UPDATE ai_models SET is_enabled = TRUE WHERE id = ?',
                    [existing.id]
                );
                this.fastify.log.info(`[LLMSyncWorker] Re-enabled model: ${model.provider}/${model.id} (provider is active)`);
            }
        }

        if (addedCount > 0) {
            this.fastify.log.info(`[LLMSyncWorker] Added ${addedCount} new API models total`);
        }

        // Disable any previously-synced models that are now known to be chat-completions-incompatible
        await this.disableIncompatibleModels(providers);
    }

    /**
     * Disable models already in the DB that are incompatible with /v1/chat/completions.
     * This handles models that were synced before the filter was introduced.
     */
    private async disableIncompatibleModels(providers: any[]) {
        const providerIds = providers.map((p: any) => p.id);
        if (providerIds.length === 0) return;

        const placeholders = providerIds.map(() => '?').join(',');
        const allDbModels = await findAll<any>(
            this.fastify.db,
            `SELECT id, model_id FROM ai_models WHERE provider_id IN (${placeholders}) AND is_enabled = TRUE`,
            providerIds
        );

        let disabledCount = 0;
        for (const m of allDbModels) {
            if (!isChatCompletionsCompatible(m.model_id)) {
                await this.fastify.db.execute(
                    'UPDATE ai_models SET is_enabled = FALSE WHERE id = ?',
                    [m.id]
                );
                this.fastify.log.info(`[LLMSyncWorker] Disabled incompatible model: ${m.model_id}`);
                disabledCount++;
            }
        }
        if (disabledCount > 0) {
            this.fastify.log.info(`[LLMSyncWorker] Disabled ${disabledCount} chat-completions-incompatible model(s)`);
        }
    }

    /**
     * Find an obsolete model in DB that matches a new model ID.
     * Matches models with date-stamped IDs to their alias versions.
     * E.g., "claude-opus-4-6-20250610" matches "claude-opus-4-6"
     */
    private async findObsoleteModel(providerId: number, newModelId: string): Promise<{ id: number; model_id: string } | null> {
        // Look for models with the same base name plus a date suffix (-YYYYMMDD)
        const obsolete = await findOne<any>(
            this.fastify.db,
            `SELECT id, model_id FROM ai_models
             WHERE provider_id = ? AND model_id LIKE ? AND model_id != ?`,
            [providerId, `${newModelId}-%`, newModelId]
        );
        if (obsolete) return obsolete;

        // Also check reverse: new ID has date but DB has alias (less common)
        const dateMatch = newModelId.match(/^(.+)-(\d{8})$/);
        if (dateMatch) {
            const baseId = dateMatch[1];
            const existing = await findOne<any>(
                this.fastify.db,
                `SELECT id, model_id FROM ai_models WHERE provider_id = ? AND model_id = ?`,
                [providerId, baseId]
            );
            if (existing) return existing;
        }

        return null;
    }

    /**
     * Disable models whose parent provider is disabled
     */
    private async disableOrphanedModels() {
        // Find enabled models with disabled providers
        const orphaned = await findAll<any>(
            this.fastify.db,
            `SELECT m.id, m.model_id, p.name as provider_name
             FROM ai_models m
             JOIN ai_providers p ON m.provider_id = p.id
             WHERE m.is_enabled = TRUE AND p.is_enabled = FALSE`
        );

        for (const m of orphaned) {
            this.fastify.log.info(`[LLMSyncWorker] Disabling model "${m.model_id}" (provider "${m.provider_name}" is disabled)`);
            await this.fastify.db.execute(
                "UPDATE ai_models SET is_enabled = FALSE WHERE id = ?",
                [m.id]
            );
        }
    }
}
