/**
 * HyDE Service — Hypothetical Document Embeddings
 *
 * Implements the HyDE pattern from the Cheshire Cat's `cat_recall_query` hook:
 * instead of embedding the raw user query for retrieval, the LLM first generates
 * a hypothetical answer, and THAT is embedded for semantic search.
 *
 * This improves retrieval because the hypothetical answer is closer in embedding space
 * to the actual stored documents than the short user question.
 *
 * Usage: register as a hook on `cat_recall_query` via EventBus.
 */

import type { FastifyInstance } from 'fastify';
import type mysql from 'mysql2/promise';
import { findOne } from '../database/index.js';
import { eventBus, type HookContext } from './EventBusService.js';

interface HyDEConfig {
  enabled: boolean;
  /** Max tokens for the hypothetical answer */
  maxTokens: number;
  /** Only apply HyDE if query is shorter than this */
  maxQueryLength: number;
}

const DEFAULT_CONFIG: HyDEConfig = {
  enabled: false,
  maxTokens: 150,
  maxQueryLength: 500,
};

export class HyDEService {
  private config: HyDEConfig = { ...DEFAULT_CONFIG };

  constructor(
    private fastify: FastifyInstance,
    private db: mysql.Pool,
  ) {}

  /** Load config from DB or use defaults */
  async loadConfig(): Promise<void> {
    try {
      const row = await findOne<any>(
        this.db,
        "SELECT setting_value FROM system_settings WHERE setting_key = 'hyde_config'",
        [],
      );
      if (row?.setting_value) {
        const parsed = JSON.parse(row.setting_value);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      // Use defaults
    }
  }

  /** Save config to DB */
  async saveConfig(config: Partial<HyDEConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    try {
      await this.db.execute(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES ('hyde_config', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [JSON.stringify(this.config)],
      );
    } catch (err: any) {
      this.fastify.log.warn(`[HyDE] Failed to save config: ${err.message}`);
    }
  }

  getConfig(): HyDEConfig {
    return { ...this.config };
  }

  /**
   * Register the HyDE hook on the EventBus.
   * When registered, the `cat_recall_query` pipe will receive the hypothetical
   * answer instead of the raw user query.
   */
  registerHook(): void {
    eventBus.register({
      id: 'hyde_recall_query',
      name: 'HyDE Recall Query Transform',
      hookName: 'cat_recall_query',
      priority: 50, // Run before other recall query hooks
      enabled: true,
      handler: async (query: string, context: HookContext) => {
        return this.transformQuery(query, context);
      },
    });
    this.fastify.log.info('[HyDE] Registered cat_recall_query hook');
  }

  /** Unregister the hook */
  unregisterHook(): void {
    eventBus.unregister('hyde_recall_query');
  }

  /**
   * Transform a user query into a hypothetical document.
   * If HyDE is disabled or the query is too long, returns the original query.
   */
  async transformQuery(query: string, _context: HookContext): Promise<string> {
    if (!this.config.enabled) return query;
    if (query.length > this.config.maxQueryLength) return query;

    try {
      const hypothetical = await this.generateHypotheticalAnswer(query);
      if (hypothetical) {
        this.fastify.log.debug(`[HyDE] Transformed query: "${query.substring(0, 50)}..." → "${hypothetical.substring(0, 80)}..."`);
        return hypothetical;
      }
    } catch (err: any) {
      this.fastify.log.warn(`[HyDE] Failed to generate hypothetical answer: ${err.message}`);
    }

    return query;
  }

  /**
   * Generate a hypothetical answer using the configured LLM.
   * Uses a lightweight prompt that asks the LLM to imagine what a good answer
   * would look like, without needing actual context.
   */
  private async generateHypotheticalAnswer(query: string): Promise<string | null> {
    // Find the default chat provider from DB
    const provider = await findOne<any>(
      this.db,
      `SELECT p.type, p.base_url, p.api_key, m.model_id
       FROM ai_providers p
       JOIN ai_models m ON m.provider_id = p.id
       WHERE p.is_enabled = 1 AND m.is_enabled = 1 AND m.capabilities LIKE '%chat%'
       ORDER BY p.id ASC LIMIT 1`,
      [],
    );

    if (!provider) return null;

    const systemPrompt = `You are a helpful assistant. Given the user's question, write a brief, informative passage that directly answers the question. Write as if you are a relevant document that contains the answer. Be concise and factual. Do not say "I" or reference being an AI. Just provide the information directly.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ];

    // Use the AIProviderFactory pattern to call the LLM
    const response = await this.callLLM(provider, messages);
    return response;
  }

  /**
   * Lightweight LLM call for HyDE — uses fetch directly to avoid
   * circular dependencies with the full AI module.
   */
  private async callLLM(
    provider: { type: string; base_url: string; api_key: string; model_id: string },
    messages: { role: string; content: string }[],
  ): Promise<string | null> {
    try {
      const { type, base_url, api_key, model_id } = provider;

      if (type === 'openai' || type === 'openai_compatible') {
        const url = `${base_url}/v1/chat/completions`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(api_key ? { 'Authorization': `Bearer ${api_key}` } : {}),
          },
          body: JSON.stringify({
            model: model_id,
            messages,
            max_tokens: this.config.maxTokens,
            temperature: 0.0, // Deterministic for consistency
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) return null;
        const data = await resp.json() as any;
        return data.choices?.[0]?.message?.content || null;
      }

      if (type === 'anthropic') {
        const url = `${base_url}/v1/messages`;
        const systemMsg = messages.find(m => m.role === 'system')?.content || '';
        const userMsgs = messages.filter(m => m.role !== 'system');

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': api_key || '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model_id,
            system: systemMsg,
            messages: userMsgs,
            max_tokens: this.config.maxTokens,
            temperature: 0.0,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) return null;
        const data = await resp.json() as any;
        return data.content?.[0]?.text || null;
      }

      if (type === 'google') {
        const url = `${base_url}/v1beta/models/${model_id}:generateContent?key=${api_key}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: this.config.maxTokens,
              temperature: 0.0,
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) return null;
        const data = await resp.json() as any;
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }

      if (type === 'ollama') {
        const url = `${base_url}/api/chat`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model_id,
            messages,
            stream: false,
            options: { num_predict: this.config.maxTokens, temperature: 0.0 },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) return null;
        const data = await resp.json() as any;
        return data.message?.content || null;
      }

      return null;
    } catch (err: any) {
      this.fastify.log.debug(`[HyDE] LLM call failed: ${err.message}`);
      return null;
    }
  }
}
