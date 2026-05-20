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
  // qwen3-vl is a Qwen3 family vision-language model; ensure vision=true even
  // though `vl` is already covered by VISION_PATTERNS — explicit assertion for
  // future-proofing across tag variants like "qwen3-vl:8b" / "qwen3-vl-instruct".
  const isQwen3Vl = /^qwen3-vl(?:[:_-]|$)/i.test(modelId);
  const hasVision = isQwen3Vl || VISION_PATTERNS.some(p => p.test(modelId)) || isOcrOnly;
  const hasThinking = THINKING_PATTERNS.some(p => p.test(modelId));

  return {
    supports_functions: !isEmbedding && !isOcrOnly,
    supports_vision: hasVision,
    supports_thinking: hasThinking,
    supports_streaming: true,
  };
}

/**
 * Context window in tokens for known local model families.
 * Returns null if unknown (caller should fall back to provider default / 4096).
 */
export function inferContextWindow(modelId: string): number | null {
  if (/^qwen3-vl(?:[:_-]|$)/i.test(modelId)) return 128_000;
  if (/^qwen3(?:[:_-]|$)/i.test(modelId)) return 128_000;
  if (/^qwen2\.5/i.test(modelId)) return 128_000;
  return null;
}

/**
 * v2.1.64 — Legacy local-model deprecations.
 *
 * Each entry maps an OLD ollama tag to a SUCCESSOR model. When the chat code
 * resolves a model id, callers should call {@link redirectLegacyModel} so that
 * a deprecated tag is silently upgraded (with a warning) to the supported one.
 *
 * NOTE: the underlying ollama models are NOT removed by this change — physical
 * cleanup is scheduled for the operativa post-deploy v2.1.64.
 */
export const LEGACY_MODEL_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  // @deprecated — superseded by qwen3-vl:8b (same vendor, larger context, better reasoning)
  'qwen2.5vl:7b': 'qwen3-vl:8b',
  // @deprecated — superseded by qwen3-vl:8b (broader VLM coverage)
  'granite3.2-vision:latest': 'qwen3-vl:8b',
  // @deprecated — superseded by qwen3-vl:8b (minicpm-v unmaintained at this tag)
  'minicpm-v:latest': 'qwen3-vl:8b',
  // @deprecated — embedding tags consolidated onto qwen3-embedding (separate path; emits warning)
  'nomic-embed-text:latest': 'qwen3-embedding',
  'snowflake-arctic-embed:110m': 'qwen3-embedding',
});

/**
 * If `modelId` is a deprecated local tag, return its successor and emit a
 * one-line warning. Otherwise return the input unchanged.
 *
 * This is a pure function: it does not mutate state.
 */
export function redirectLegacyModel(modelId: string): string {
  const target = LEGACY_MODEL_REDIRECTS[modelId];
  if (!target) return modelId;
   
  console.warn(`[model-capabilities] legacy model "${modelId}" redirected to "${target}" (v2.1.64 deprecation)`);
  return target;
}
