/**
 * Model Capability Inference
 * Automatically detects model capabilities from the model name/family.
 * Used by LLMSyncWorker and admin sync endpoints to set correct flags
 * when new models are discovered or added.
 */

export interface InferredCapabilities {
  supports_functions: boolean;
  supports_vision: boolean;
  supports_thinking: boolean;
  supports_streaming: boolean;
}

// Models that are embedding-only or single-purpose (no tool calling)
const NO_TOOL_PATTERNS = [
  /^nomic-embed/i,
  /^mxbai-embed/i,
  /^all-minilm/i,
  /^snowflake-arctic-embed/i,
  /^bge-/i,
  /^paraphrase-/i,
  /^qwen3-embedding/i,
  /^granite-embedding/i,
  /^embeddinggemma/i,
  /[-_]embed[-_:]|[-_]embed$/i,  // Embedding models with word boundary
  /^translategemma/i, // Translation-only model
];

// Models with OCR-only focus (no general tool calling)
const OCR_ONLY_PATTERNS = [
  /^deepseek-ocr/i,
  /^glm-ocr/i,
];

// Vision-capable model patterns
const VISION_PATTERNS = [
  /vision/i,
  /\bvl\b/i,        // e.g. qwen2.5vl
  /-v\b/i,           // e.g. minicpm-v
  /^llava/i,
  /^bakllava/i,
  /^moondream/i,
  /gemma3/i,         // Gemma 3 has vision
  /^pixtral/i,
  /^granite.*vision/i,
];

// Thinking/reasoning model patterns
const THINKING_PATTERNS = [
  /^deepseek-r1/i,
  /^deepseek-r\d/i,
  /^deepseek-v3/i,
  /^qwen3/i,
  /^qwq/i,
  /^o1/i,
  /^o3/i,
  /reasoning/i,
  /^phi4-reasoning/i,
  /^phi4-mini-reasoning/i,
  /^granite-3\.2/i,
  /^magistral/i,
  /^kimi.*thinking/i,
  /^gpt-oss/i,
  /^nemotron/i,
  /^glm-4\.7/i,
];

/**
 * Infer model capabilities from the model name.
 * Most modern LLMs support function calling (tool use) — we only exclude
 * models that are clearly embedding, translation, or OCR-only.
 */
export function inferModelCapabilities(modelId: string): InferredCapabilities {
  const isEmbedding = NO_TOOL_PATTERNS.some(p => p.test(modelId));
  const isOcrOnly = OCR_ONLY_PATTERNS.some(p => p.test(modelId));
  const hasVision = VISION_PATTERNS.some(p => p.test(modelId)) || isOcrOnly;
  const hasThinking = THINKING_PATTERNS.some(p => p.test(modelId));

  return {
    supports_functions: !isEmbedding && !isOcrOnly,
    supports_vision: hasVision,
    supports_thinking: hasThinking,
    supports_streaming: true,
  };
}
