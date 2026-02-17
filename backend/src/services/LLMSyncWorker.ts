import { FastifyInstance } from 'fastify';
import { findAll, findOne } from '../database/index.js';
import { AIProviderFactory, ProviderType } from '../modules/ai/providers.js';
import { fetchAllModels } from './ModelFetcher.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production!!';

/**
 * Decrypt a secret value from the database
 */
function decryptSecret(text: string): string {
    try {
        const [ivHex, encrypted] = text.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        return text;
    }
}

export class LLMSyncWorker {
    private fastify: FastifyInstance;
    private configInterval: NodeJS.Timeout | null = null;
    private modelInterval: NodeJS.Timeout | null = null;

    // Interval settings
    private readonly CONFIG_SYNC_MS = 2 * 60 * 1000; // 2 minutes
    private readonly MODEL_SYNC_MS = 15 * 60 * 1000; // 15 minutes

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
    }

    /**
     * Start the background synchronization worker
     */
    public start() {
        this.fastify.log.info('[LLMSyncWorker] Starting background synchronization worker');

        // Initial sync
        this.syncConfigs().catch(err => this.fastify.log.error(`[LLMSyncWorker] Initial config sync failed: ${err.message}`));
        this.syncModels().catch(err => this.fastify.log.error(`[LLMSyncWorker] Initial model sync failed: ${err.message}`));

        // Set up intervals
        this.configInterval = setInterval(() => this.syncConfigs(), this.CONFIG_SYNC_MS);
        this.modelInterval = setInterval(() => this.syncModels(), this.MODEL_SYNC_MS);
    }

    /**
     * Stop the background synchronization worker
     */
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

            // Group settings by provider
            const configByProvider: Record<string, Record<string, string>> = {};
            for (const setting of providerSettings) {
                if (!configByProvider[setting.provider_name]) {
                    configByProvider[setting.provider_name] = {};
                }
                const value = setting.is_secret ? decryptSecret(setting.setting_value) : setting.setting_value;
                configByProvider[setting.provider_name][setting.setting_key] = value;
            }

            // Special handling for Anthropic variants
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

            // Configure other providers
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
     * Discover and sync available models from all enabled providers
     */
    private async syncModels() {
        try {
            this.fastify.log.info('[LLMSyncWorker] Syncing available models from providers...');

            // Get all enabled providers
            const providers = await findAll<any>(
                this.fastify.db,
                'SELECT id, name, display_name, provider_type FROM ai_providers WHERE is_enabled = TRUE'
            );

            // Get configurations for fetchAllModels
            const providerConfigs: any[] = [];
            for (const p of providers) {
                // Fetch settings for this provider
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

                if (config.apiKey || config.baseUrl || p.provider_type === 'ollama') {
                    providerConfigs.push(config);
                }
            }

            const availableModels = await fetchAllModels(providerConfigs);

            let addedCount = 0;
            for (const model of availableModels) {
                // Find the matching provider in DB to get the local provider_id
                const provider = providers.find((p: any) => p.provider_type === model.provider);
                if (!provider) continue;

                // Check if model already exists
                const existing = await findOne<any>(
                    this.fastify.db,
                    'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
                    [provider.id, model.id]
                );

                if (!existing) {
                    await this.fastify.db.execute(
                        `INSERT INTO ai_models (
              provider_id, model_id, display_name, description, 
              model_type, supports_streaming, is_enabled
            ) VALUES (?, ?, ?, ?, 'chat', TRUE, TRUE)`,
                        [provider.id, model.id, model.name, model.description || `Fetched from ${model.provider}`]
                    );
                    addedCount++;
                }
            }

            this.fastify.log.info(`[LLMSyncWorker] Model sync complete. Added ${addedCount} new models.`);
        } catch (error: any) {
            this.fastify.log.error(`[LLMSyncWorker] Model sync error: ${error.message}`);
        }
    }
}
