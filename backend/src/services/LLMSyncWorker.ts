import { FastifyInstance } from 'fastify';
import { findAll, findOne } from '../database/index.js';
import { AIProviderFactory, ProviderType } from '../modules/ai/providers.js';
import { fetchAllModels } from './ModelFetcher.js';
import { getOllamaModelSyncService } from './OllamaModelSyncService.js';
import { decrypt as decryptSecret } from '../utils/crypto.js';

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
        'qwen-fast': 'qwen2.5:3b',
        'llama-fast': 'llama3.2:3b',
        'gemma-fast': 'gemma2:2b',
        'phi-fast': 'phi3:mini',
        'glm-4.7-flash': 'glm4:latest',
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

                await this.fastify.db.execute(
                    `INSERT INTO ai_models (provider_id, model_id, display_name, description, model_type, supports_streaming, is_enabled, sort_order)
                     VALUES (?, ?, ?, ?, 'chat', TRUE, FALSE, 999)`,
                    [ollamaProvider.id, installed.name, displayName, desc]
                );
                this.fastify.log.info(`[LLMSyncWorker] Discovered new Ollama model: ${installed.name} (added as disabled)`);
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

        if (providers.length === 0) return;

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
            }
        }

        if (providerConfigs.length === 0) return;

        const availableModels = await fetchAllModels(providerConfigs);
        let addedCount = 0;

        for (const model of availableModels) {
            const provider = providers.find((p: any) => p.provider_type === model.provider);
            if (!provider) continue;

            const existing = await findOne<any>(
                this.fastify.db,
                'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
                [provider.id, model.id]
            );

            if (!existing) {
                await this.fastify.db.execute(
                    `INSERT INTO ai_models (provider_id, model_id, display_name, description, model_type, supports_streaming, is_enabled)
                     VALUES (?, ?, ?, ?, 'chat', TRUE, TRUE)`,
                    [provider.id, model.id, model.name, model.description || `From ${model.provider}`]
                );
                addedCount++;
            }
        }

        if (addedCount > 0) {
            this.fastify.log.info(`[LLMSyncWorker] Added ${addedCount} new API models`);
        }
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
