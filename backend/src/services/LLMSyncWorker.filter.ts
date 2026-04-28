/**
 * Heuristic to determine whether a remote provider model ID is compatible with
 * the standard chat-completions style API (i.e. the path used by OpenAI's
 * `/v1/chat/completions`, Anthropic's `/v1/messages`, etc.).
 *
 * Decision pipeline:
 *  1. Empty / non-string input → not compatible (defensive).
 *  2. ID matches a precise blacklist pattern (audio / tts / embeddings /
 *     realtime / `gpt-5-pro` / etc.) → not compatible.
 *  3. Otherwise → compatible (open default).
 *
 * The exported allowlist (`KNOWN_CHAT_MODEL_PREFIXES`) is used by callers that
 * want to *guarantee* a model never gets disabled (e.g. for documentation /
 * sanity checks); it is not part of the runtime decision because that would
 * defeat the purpose of the blacklist.
 *
 * Both lists are exported so they can be exercised in unit tests and reused
 * by admin UIs that want to surface why a model was filtered.
 */

/**
 * Prefix patterns for known chat-completions-compatible model families.
 * Anchored at the start of the model id and followed by a separator/end so
 * that we do not accidentally match unrelated suffixes.
 */
export const KNOWN_CHAT_MODEL_PREFIXES: readonly RegExp[] = Object.freeze([
    // OpenAI chat families: gpt-3.5, gpt-4, gpt-4o, gpt-4.1, gpt-5, gpt-5.5, ...
    /^gpt-(?:3\.5|4|4o|4\.1|4\.5|5|5\.5|6)(?:[-.]|$)/i,
    // OpenAI reasoning families: o1, o3, o4 with optional digit suffix
    /^o[134](?:[-.]|$)/i,
    // Anthropic: claude-...
    /^claude-/i,
    // Google: gemini-...
    /^gemini-/i,
    // Mistral / Mixtral
    /^(?:mistral|mixtral|magistral)(?:[-:]|$)/i,
    // Llama family
    /^llama(?:\d+)?(?:[-:.]|$)/i,
    // Qwen chat families (qwen, qwen2, qwen2.5, qwen3) — vision/embedding
    // variants are excluded explicitly below by the blacklist.
    /^qwen(?:\d+(?:\.\d+)?)?(?:[-:]|$)/i,
    // DeepSeek (chat / coder / r1) — embeddings/ocr excluded by blacklist
    /^deepseek(?:[-:]|$)/i,
    // Phi
    /^phi(?:\d+)?(?:[-:.]|$)/i,
    // Gemma
    /^gemma(?:\d+)?(?:[-:.]|$)/i,
    // GLM
    /^glm(?:[-:.]|$)/i,
]);

/**
 * Patterns for IDs that are NOT compatible with chat-completions style APIs.
 * These models target other endpoints (Realtime, Audio, TTS, Images, etc.)
 * and would produce 4xx errors if invoked through a chat handler.
 */
export const CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS: readonly RegExp[] = Object.freeze([
    /realtime/i,                         // Realtime API (WebSockets)
    /audio/i,                            // Audio/speech API
    /(?:^|[-_])tts(?:[-_]|$)/i,          // TTS models
    /transcribe/i,                       // Transcription API
    /whisper/i,                          // Whisper transcription
    /(?:^|[-_])image(?:[-_\d]|$)/i,      // Image generation (image, gpt-image-1)
    /dall-?e/i,                          // DALL-E image models
    /(?:^|[-_])codex(?:[-_]|$)/i,        // Codex (different API format)
    /search-api/i,                       // Search API
    /\binstruct\b/i,                     // Completion-style instruct (NOT for chat)
    /^gpt-5-pro(?:[-_]|$)/i,             // gpt-5-pro family — Responses API only
    /diarize/i,                          // Diarization API
    /embed(?:ding)?/i,                   // Embedding endpoints (text-embedding-*, nomic-embed-*)
    /^bge[-:_]/i,                        // BAAI BGE embedding models (bge-m3, bge-large-en)
    /\bocr\b/i,                          // OCR-only models
    /(?:^|[-_])vision(?:[-_]|$)/i,       // Vision-only models (chat handled separately)
    /minicpm-v/i,                        // MiniCPM-V vision
    /granite\d+(?:\.\d+)?-vision/i,      // Granite vision variants
    /moderation/i,                       // Moderation endpoint
    /davinci/i,                          // Legacy completion models (text-davinci, code-davinci)
]);

/**
 * Returns true when `modelId` matches any allowlisted chat-model prefix.
 * Pure / side-effect free.
 */
export function matchesAllowlist(modelId: string): boolean {
    return KNOWN_CHAT_MODEL_PREFIXES.some(p => p.test(modelId));
}

/**
 * Returns true when `modelId` matches any incompatible blacklist pattern.
 * Pure / side-effect free.
 */
export function matchesBlacklist(modelId: string): boolean {
    return CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS.some(p => p.test(modelId));
}

/**
 * Decide whether `modelId` should be treated as compatible with chat-completions.
 *
 * Rules:
 *  - Empty / non-string → false (defensive: input is always validated upstream).
 *  - Blacklist match → false.
 *  - Otherwise → true (open default — unknown families are kept enabled).
 */
export function isChatCompletionsCompatible(modelId: string): boolean {
    if (typeof modelId !== 'string' || modelId.length === 0) return false;
    if (matchesBlacklist(modelId)) return false;
    return true;
}
