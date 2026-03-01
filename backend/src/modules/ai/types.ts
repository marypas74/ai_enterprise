// Types
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface CompletionOptions {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[]; // Allow passing tools definitions
  // --- v4.0: Advanced provider features ---
  cacheControl?: boolean;              // Enable Anthropic prompt caching
  thinking?: {                          // Extended/adaptive thinking
    type: 'enabled' | 'adaptive';
    budgetTokens?: number;
  };
  outputSchema?: {                      // Structured outputs (JSON schema)
    type: 'json_schema';
    jsonSchema: Record<string, any>;
  };
  documentBlocks?: Array<{              // Native PDF/document blocks (Anthropic)
    type: 'document';
    source: { type: 'base64' | 'text'; media_type: string; data: string };
    title?: string;
    citations?: { enabled: boolean };
    cache_control?: { type: 'ephemeral' };
  }>;
}

export interface CompletionResult {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  provider: ProviderType;
  toolCalls?: any[];
  // --- v4.0: Advanced metrics ---
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  thinkingContent?: string;
  thinkingTokens?: number;
  citations?: Array<{
    type: string;
    citedText: string;
    documentIndex: number;
    documentTitle?: string;
    startCharIndex?: number;
    endCharIndex?: number;
    startPageNumber?: number;
    endPageNumber?: number;
  }>;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  toolCalls?: any[];
  // --- v4.0: Extended thinking & citations ---
  thinking?: string;           // Thinking block content
  thinkingDone?: boolean;      // End of thinking phase
  citations?: any[];           // Citations delta
  usage?: {                    // Token usage from stream (Anthropic message_delta)
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    thinkingTokens?: number;
  };
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  keepAlive?: string;
  customHeaders?: Record<string, string>;
}

// Model pricing (USD per 1K tokens) - Updated March 2026
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI - Latest models
  'gpt-4.1': { input: 0.002, output: 0.008 },          // Latest GPT-4.1
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },   // GPT-4.1 Mini
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },   // GPT-4.1 Nano
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  // OpenAI Reasoning models
  'o1': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
  'o1-preview': { input: 0.015, output: 0.06 },
  'o3-mini': { input: 0.0011, output: 0.0044 },
  // Anthropic - Claude 4.6 (Latest - Feb 2026)
  'claude-opus-4-6': { input: 0.005, output: 0.025 },
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  // Anthropic - Claude 4.5 (aliases + date-stamped)
  'claude-opus-4-5': { input: 0.015, output: 0.075 },
  'claude-opus-4-5-20251101': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-5': { input: 0.003, output: 0.015 },
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5': { input: 0.001, output: 0.005 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  // Anthropic - Claude 4
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  // Anthropic - Claude 3 (Legacy — claude-3-haiku retiring April 2026)
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  // Google Gemini
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gemini-2.0-flash-thinking': { input: 0.0001, output: 0.0004 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  // Ollama local models (free, cost=0 for tracking purposes)
  // --- Text Generation ---
  'qwen3:14b': { input: 0, output: 0 },
  'qwen3:30b-a3b': { input: 0, output: 0 },
  'qwen3:32b': { input: 0, output: 0 },
  'gemma3:12b': { input: 0, output: 0 },
  'phi4:latest': { input: 0, output: 0 },
  'mistral:latest': { input: 0, output: 0 },
  'mixtral:latest': { input: 0, output: 0 },
  'glm-4.7-flash:latest': { input: 0, output: 0 },
  'gpt-oss:latest': { input: 0, output: 0 },
  'llama4:scout': { input: 0, output: 0 },
  // --- Thinking / Reasoning ---
  'deepseek-r1:14b': { input: 0, output: 0 },
  'deepseek-r1:32b': { input: 0, output: 0 },
  'qwq:32b': { input: 0, output: 0 },
  // --- Coding ---
  'qwen2.5-coder:32b': { input: 0, output: 0 },
  'deepseek-coder-v2:latest': { input: 0, output: 0 },
  // --- Vision / OCR / Documents ---
  'deepseek-ocr:latest': { input: 0, output: 0 },
  'glm-ocr:latest': { input: 0, output: 0 },
  'qwen2.5vl:7b': { input: 0, output: 0 },
  'minicpm-v:latest': { input: 0, output: 0 },
  'granite3.2-vision:latest': { input: 0, output: 0 },
  // --- Embeddings ---
  'bge-m3:latest': { input: 0, output: 0 },
  'nomic-embed-text:latest': { input: 0, output: 0 },
  // --- Translation ---
  'translategemma:4b': { input: 0, output: 0 },
};

// Calculate cost
export function calculateCost(model: string, tokensInput: number, tokensOutput: number): number {
  const pricing = MODEL_PRICING[model] || { input: 0.01, output: 0.03 };
  return (tokensInput * pricing.input + tokensOutput * pricing.output) / 1000;
}

// Provider interface (Strategy pattern)
export interface AIProvider {
  name: ProviderType;
  complete(options: CompletionOptions): Promise<CompletionResult>;
  streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk>;
}
