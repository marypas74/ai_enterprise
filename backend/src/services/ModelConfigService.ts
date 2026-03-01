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

// Models known to be lightweight (< 3B params or MoE with small active params)
const LIGHT_MODELS = new Set([
  'qwen3:30b-a3b',     // MoE 30B total but only 3B active — treat as light
  'qwen-fast',          // alias → qwen3:30b-a3b
  'glm-ocr:latest',    // 0.9B param OCR model
  'translategemma:4b',  // Small translation model
]);

// Ollama model name prefixes that support native thinking (think: true API)
// These models output <think>...</think> tags natively via Ollama's thinking API
const OLLAMA_THINKING_PREFIXES = [
  'deepseek-r1',        // DeepSeek R1 reasoning family (1.5b-671b)
  'deepseek-v3',        // DeepSeek V3.1 with thinking mode
  'qwen3',              // Qwen 3 / 3.5 / 3-next (all support think param)
  'qwq',                // Qwen QwQ reasoning model (legacy)
  'phi4-reasoning',     // Microsoft Phi-4 Reasoning (14b)
  'phi4-mini-reasoning',// Microsoft Phi-4 Mini Reasoning
  'granite-3.2',        // IBM Granite 3.2 thinking family
  'magistral',          // Mistral Magistral reasoning (24b)
  'kimi-k2-thinking',   // Moonshot Kimi K2 Thinking
  'gpt-oss',            // GPT-OSS reasoning
  'gpt-oss-safeguard',  // GPT-OSS with safety
  'nemotron',           // NVIDIA Nemotron reasoning
  'glm-4.7',            // GLM 4.7 Flash with thinking
];

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
    const isOllamaThinking = OLLAMA_THINKING_PREFIXES.some(p => modelId.startsWith(p));

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
      supportsStreaming: !!(row?.supports_streaming ?? true),
      isLightModel: LIGHT_MODELS.has(modelId),
      // v4.0+: infer from DB or model name (Ollama thinking models included)
      supportsThinking: !!(row?.supports_thinking) || isClaude || isReasoningModel || isOllamaThinking,
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
    const langInstruction = 'Rispondi sempre in italiano.';

    if (family.includes('qwen') || family.includes('alibaba')) {
      return `Segui le istruzioni con precisione. Per compiti strutturati, rispondi con formattazione pulita. Usa elenchi numerati per i passaggi. Mantieni le risposte focalizzate. ${langInstruction}`;
    }
    if (family.includes('llama') || family.includes('meta')) {
      return `Sei un assistente utile e onesto. Fornisci risposte chiare e ben strutturate. Quando non sei sicuro, dillo piuttosto che inventare. ${langInstruction}`;
    }
    if (family.includes('gemma') || family.includes('google')) {
      return `Sii conciso e diretto. Fornisci risposte fattuali e ben documentate. Usa la formattazione markdown quando appropriato. ${langInstruction}`;
    }
    if (family.includes('phi') || family.includes('microsoft')) {
      return `Sei un assistente preciso ed efficiente. Concentrati sull'accuratezza. Struttura le risposte complesse con intestazioni e punti elenco. ${langInstruction}`;
    }
    if (family.includes('claude') || family.includes('anthropic')) {
      return `Sei un assistente riflessivo. Ragiona passo dopo passo per problemi complessi. Sii trasparente sull'incertezza e fornisci risposte articolate. ${langInstruction}`;
    }
    if (family.includes('gpt') || family.includes('openai') || family.includes('o1') || family.includes('o3')) {
      return `Sei un assistente versatile. Adatta il tuo stile di risposta al compito. Usa blocchi di codice, elenchi e formattazione strutturata quando appropriato. ${langInstruction}`;
    }
    if (family.includes('gemini')) {
      return `Sei un assistente competente con forti capacità di ragionamento. Fornisci risposte complete ma concise. Usa il markdown per chiarezza. ${langInstruction}`;
    }
    if (family.includes('deepseek-r1') || family.includes('deepseek-r')) {
      return `Sei un modello di ragionamento avanzato. Analizza i problemi passo dopo passo, mostrando il processo logico. Fornisci risposte accurate e ben argomentate. ${langInstruction}`;
    }
    if (family.includes('deepseek')) {
      return `Sei un assistente versatile e preciso. Fornisci risposte strutturate con ragionamento chiaro. ${langInstruction}`;
    }
    if (family.includes('mistral') || family.includes('mixtral')) {
      return `Sei un assistente multilingue. Sii preciso, strutturato e utile. ${langInstruction}`;
    }
    if (family.includes('codellama') || family.includes('code')) {
      return `Sei un esperto assistente di programmazione. Fornisci codice completo con commenti chiari. ${langInstruction}`;
    }

    // Default for unknown families
    return langInstruction;
  }

  /**
   * Clear cache (call when model settings change)
   */
  static clearCache(): void {
    configCache.clear();
  }
}
