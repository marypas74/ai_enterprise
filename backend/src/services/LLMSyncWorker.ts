import { FastifyInstance } from 'fastify';
import { findAll, findOne } from '../database/index.js';
import { AIProviderFactory, ProviderType } from '../modules/ai/providers.js';
import { fetchAllModels } from './ModelFetcher.js';
import { getOllamaModelSyncService } from './OllamaModelSyncService.js';
import { decrypt as decryptSecret } from '../utils/crypto.js';
import { inferModelCapabilities } from '../utils/model-capabilities.js';

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

    // Alias model_ids in DB → actual Ollama model names
    // These are virtual names used in the DB that map to real installed models
    private static readonly OLLAMA_MODEL_ALIASES: Record<string, string> = {
        'qwen-fast': 'qwen3:30b-a3b',       // MoE ultra-fast
        'qwen-thinking': 'qwen3:32b',       // Qwen3 32B with native thinking
        'gemma-fast': 'gemma3:12b',          // Gemma 3 12B
        'phi-fast': 'phi4:latest',           // Phi-4
        'glm-4.7-flash': 'glm-4.7-flash:latest',
        'deepseek-think': 'deepseek-r1:32b', // DeepSeek R1 32B reasoning
        'qwq-think': 'qwq:32b',             // QwQ 32B reasoning
        'coder': 'qwen2.5-coder:32b',       // Best local coding model
        'gpt-oss': 'gpt-oss:latest',        // OpenAI open-source
        'llama4': 'llama4:scout',           // Llama 4 Scout MoE
        'doc-vision': 'granite3.2-vision:latest', // Document understanding
    };

    /**
     * Resolve a DB model_id to the actual Ollama model name
     */
    private resolveOllamaModelName(modelId: string): string {
        return LLMSyncWorker.OLLAMA_MODEL_ALIASES[modelId] || modelId;
    }

    /**
     * Sync Ollama models: check installed models, update DB availability, auto-pull missing
     */
    private async syncOllamaModels() {
        const ollamaProvider = await findOne<any>(
            this.fastify.db,
            "SELECT id FROM ai_providers WHERE provider_type = 'ollama' AND is_enabled = TRUE"
        );
        if (!ollamaProvider) return;

        const baseUrlSetting = await findOne<any>(
            this.fastify.db,
            "SELECT setting_value FROM ai_provider_settings WHERE provider_id = ? AND setting_key = 'base_url'",
            [ollamaProvider.id]
        );
        const baseUrl = baseUrlSetting?.setting_value || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

        const ollamaService = getOllamaModelSyncService(baseUrl);
        const isRunning = await ollamaService.isOllamaRunning();
        if (!isRunning) {
            this.fastify.log.warn('[LLMSyncWorker] Ollama is not reachable, skipping Ollama sync');
            return;
        }

        // Get installed models from Ollama
        const installedModels = await ollamaService.getInstalledModels();
        const installedNames = new Set<string>();
        for (const m of installedModels) {
            installedNames.add(m.name);
            installedNames.add(m.name.replace(/:latest$/, ''));
            installedNames.add(m.name.split(':')[0]);
        }

        this.fastify.log.info(`[LLMSyncWorker] Ollama has ${installedModels.length} installed models: ${installedModels.map(m => m.name).join(', ')}`);

        // Get all Ollama models from DB
        const dbModels = await findAll<any>(
            this.fastify.db,
            "SELECT id, model_id, display_name, is_enabled FROM ai_models WHERE provider_id = ?",
            [ollamaProvider.id]
        );

        // Check which enabled DB models are actually installed
        for (const dbModel of dbModels) {
            const modelId = dbModel.model_id;
            // Resolve aliases: e.g. 'glm-4.7-flash' → 'glm4:latest'
            const resolvedName = this.resolveOllamaModelName(modelId);

            const isInstalled = installedNames.has(resolvedName)
                || installedNames.has(resolvedName.replace(/:latest$/, ''))
                || installedNames.has(resolvedName.split(':')[0])
                || installedNames.has(modelId)
                || installedNames.has(modelId.replace(/:latest$/, ''))
                || installedNames.has(modelId.split(':')[0]);

            if (dbModel.is_enabled && !isInstalled) {
                // Try to pull the resolved (actual) model name
                this.fastify.log.warn(`[LLMSyncWorker] Model "${modelId}" (resolved: "${resolvedName}") not installed, attempting pull...`);
                const result = await ollamaService.pullModel(resolvedName);
                if (!result.success) {
                    this.fastify.log.error(`[LLMSyncWorker] Failed to pull "${resolvedName}": ${result.message}. Disabling model.`);
                    await this.fastify.db.execute(
                        "UPDATE ai_models SET is_enabled = FALSE, description = CONCAT(COALESCE(description, ''), ' [AUTO-DISABLED: not available on Ollama]') WHERE id = ?",
                        [dbModel.id]
                    );
                } else {
                    this.fastify.log.info(`[LLMSyncWorker] Successfully pulled "${resolvedName}" for model "${modelId}"`);
                }
            }
        }

        // Add newly discovered Ollama models that aren't in DB yet
        for (const installed of installedModels) {
            const normalizedName = installed.name.replace(/:latest$/, '');
            const exists = await findOne<any>(
                this.fastify.db,
                "SELECT id FROM ai_models WHERE provider_id = ? AND (model_id = ? OR model_id = ? OR model_id = ?)",
                [ollamaProvider.id, installed.name, normalizedName, installed.name.split(':')[0]]
            );

            if (!exists) {
                const displayName = installed.name.split(':')[0].charAt(0).toUpperCase() + installed.name.split(':')[0].slice(1);
                const desc = installed.details
                    ? `${installed.details.parameter_size || ''} ${installed.details.quantization_level || ''}`.trim()
                    : `Discovered from Ollama`;

                const caps = inferModelCapabilities(installed.name);
                await this.fastify.db.execute(
                    `INSERT INTO ai_models (provider_id, model_id, display_name, description, model_type,
                     supports_streaming, supports_functions, supports_vision, supports_thinking, is_enabled, sort_order)
                     VALUES (?, ?, ?, ?, 'chat', ?, ?, ?, ?, FALSE, 999)`,
                    [ollamaProvider.id, installed.name, displayName, desc,
                     caps.supports_streaming, caps.supports_functions, caps.supports_vision, caps.supports_thinking]
                );
                this.fastify.log.info(`[LLMSyncWorker] Discovered new Ollama model: ${installed.name} (tools=${caps.supports_functions}, vision=${caps.supports_vision}, thinking=${caps.supports_thinking})`);
            }
        }
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
                this.fastify.log.warn(`[LLMSyncWorker] Provider "${p.provider_type}" has no apiKey or baseUrl configured, skipping`);
            }
        }

        if (providerConfigs.length === 0) {
            this.fastify.log.warn('[LLMSyncWorker] No API providers with valid config found');
            return;
        }

        const availableModels = await fetchAllModels(providerConfigs);
        this.fastify.log.info(`[LLMSyncWorker] fetchAllModels returned ${availableModels.length} model(s): ${availableModels.map(m => `${m.provider}/${m.id}`).join(', ')}`);
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
