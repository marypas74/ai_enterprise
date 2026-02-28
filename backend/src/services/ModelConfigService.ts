/**
 * ModelConfigService — Adaptive model parameters and context management
 * Reads per-model configuration from DB and adjusts chat parameters accordingly.
 */
import { findOne } from '../database/index.js';
import type mysql from 'mysql2/promise';

export interface ModelConfig {
  modelId: string;
  modelFamily: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  timeoutMs: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isLightModel: boolean; // < 3B params (qwen:3b, gemma:2b, phi3:mini, llama3.2:3b)
  // --- v4.0: Advanced capabilities ---
  supportsThinking: boolean;   // Extended/adaptive thinking support
  supportsCitations: boolean;  // Citations API support
  supportsCaching: boolean;    // Prompt caching support
  supportsNativePdf: boolean;  // Native PDF document blocks
}

// Cache model configs for 5 minutes
const configCache = new Map<string, { config: ModelConfig; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Models known to be lightweight (< 3B params)
const LIGHT_MODELS = new Set([
  'qwen2.5:3b', 'qwen-fast', 'gemma2:2b', 'gemma-fast',
  'phi3:mini', 'phi-fast', 'llama3.2:3b', 'llama-fast',
]);

export class ModelConfigService {
  /**
   * Get the optimal configuration for a model
   */
  static async getConfig(db: mysql.Pool, modelId: string): Promise<ModelConfig> {
    const cached = configCache.get(modelId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.config;

    const row = await findOne<any>(db,
      `SELECT m.model_id, m.model_family, m.context_window, m.max_output_tokens,
              m.optimal_temperature, m.optimal_top_p, m.optimal_repeat_penalty,
              m.timeout_ms, m.supports_functions, m.supports_streaming
       FROM ai_models m WHERE m.model_id = ? AND m.is_enabled = TRUE LIMIT 1`,
      [modelId],
    );

    const isClaude = modelId.startsWith('claude-');
    const isReasoningModel = modelId.startsWith('o1') || modelId.startsWith('o3');

    const config: ModelConfig = {
      modelId,
      modelFamily: row?.model_family || null,
      contextWindow: row?.context_window || 4096,
      maxOutputTokens: row?.max_output_tokens || 4096,
      temperature: parseFloat(row?.optimal_temperature ?? 0.7),
      topP: parseFloat(row?.optimal_top_p ?? 0.9),
      repeatPenalty: parseFloat(row?.optimal_repeat_penalty ?? 1.1),
      timeoutMs: row?.timeout_ms || 120000,
      supportsTools: !!(row?.supports_functions) || false,
      supportsStreaming: !!(row?.supports_streaming) || true,
      isLightModel: LIGHT_MODELS.has(modelId),
      // v4.0: infer from DB or model name
      supportsThinking: !!(row?.supports_thinking) || (isClaude || isReasoningModel),
      supportsCitations: !!(row?.supports_citations) || isClaude,
      supportsCaching: !!(row?.supports_caching) || isClaude,
      supportsNativePdf: !!(row?.supports_native_pdf) || isClaude,
    };

    configCache.set(modelId, { config, ts: Date.now() });
    return config;
  }

  /**
   * Get recommended history depth based on context window
   */
  static getHistoryDepth(config: ModelConfig): number {
    if (config.isLightModel) return 5;
    if (config.contextWindow <= 4096) return 8;
    if (config.contextWindow <= 8192) return 15;
    return 20;
  }

  /**
   * Get max context injection size (chars) for recalled memories
   */
  static getMaxContextSize(config: ModelConfig): number {
    if (config.isLightModel) return 800;
    if (config.contextWindow <= 4096) return 1500;
    if (config.contextWindow <= 8192) return 3000;
    return 5000;
  }

  /**
   * Get recall K (number of results) adjusted for model size
   */
  static getRecallK(config: ModelConfig): { episodic: number; declarative: number; procedural: number } {
    if (config.isLightModel) return { episodic: 2, declarative: 2, procedural: 1 };
    return { episodic: 5, declarative: 5, procedural: 3 };
  }

  /**
   * Get model-family-specific system prompt additions.
   * Different model families have different strengths and instruction-following styles.
   */
  static getSystemPromptForFamily(config: ModelConfig): string {
    const family = (config.modelFamily || config.modelId).toLowerCase();

    if (family.includes('qwen') || family.includes('alibaba')) {
      return 'You follow instructions precisely. When given a structured task, respond with clean formatting. Use numbered lists for steps. Keep responses focused and avoid unnecessary preamble.';
    }
    if (family.includes('llama') || family.includes('meta')) {
      return 'You are a helpful, harmless, and honest assistant. Provide clear, well-structured answers. When you are uncertain, say so rather than guessing.';
    }
    if (family.includes('gemma') || family.includes('google')) {
      return 'Be concise and direct. Provide factual, well-sourced answers. Use markdown formatting for structure when appropriate.';
    }
    if (family.includes('phi') || family.includes('microsoft')) {
      return 'You are a precise and efficient assistant. Focus on accuracy over verbosity. Structure complex answers with clear headers and bullet points.';
    }
    if (family.includes('claude') || family.includes('anthropic')) {
      return 'You are a thoughtful assistant. Reason step by step for complex problems. Be transparent about uncertainty and provide nuanced answers.';
    }
    if (family.includes('gpt') || family.includes('openai') || family.includes('o1') || family.includes('o3')) {
      return 'You are a versatile assistant. Adapt your response style to the task at hand. Use code blocks, lists, and structured formatting when appropriate.';
    }
    if (family.includes('gemini')) {
      return 'You are a knowledgeable assistant with strong reasoning capabilities. Provide comprehensive yet concise answers. Use markdown for clarity.';
    }
    if (family.includes('mistral') || family.includes('mixtral')) {
      return 'You are a multilingual assistant. Respond in the same language as the user. Be precise, structured, and helpful.';
    }

    // Default for unknown families
    return '';
  }

  /**
   * Clear cache (call when model settings change)
   */
  static clearCache(): void {
    configCache.clear();
  }
}
