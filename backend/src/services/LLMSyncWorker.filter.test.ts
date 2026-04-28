import { describe, it, expect } from 'vitest';
import {
    isChatCompletionsCompatible,
    matchesAllowlist,
    matchesBlacklist,
    KNOWN_CHAT_MODEL_PREFIXES,
    CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS,
} from './LLMSyncWorker.filter.js';

/**
 * Fixture inspired by a real GET https://api.openai.com/v1/models payload.
 * It mixes chat models that MUST stay enabled with non-chat models that
 * MUST be filtered out.
 */
const OPENAI_CHAT_MODELS_REAL: string[] = [
    // GPT-5.5 family (the model the bug report flagged)
    'gpt-5.5-pro-2026-04-23',
    'gpt-5.5-pro',
    'gpt-5.5',
    'gpt-5.5-mini',
    'gpt-5.5-nano',
    // GPT-5 family — note: gpt-5-pro is BLACKLISTED, gpt-5 is allowed
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5-2026-01-15',
    // GPT-4 family
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4o-2024-11-20',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    // Reasoning families
    'o1',
    'o1-mini',
    'o1-preview',
    'o3',
    'o3-mini',
    'o4-mini',
    // Anthropic
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-3-haiku-20240307',
    // Google
    'gemini-2.0-flash',
    'gemini-2.0-flash-thinking',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    // Local / open weights chat
    'mistral-7b',
    'mistral-large',
    'mixtral-8x7b',
    'llama4',
    'llama-3.1-70b',
    'qwen3:32b',
    'qwen3:14b',
    'qwen2.5-coder:32b',
    'deepseek-r1:32b',
    'deepseek-coder-v2:latest',
    'phi4:latest',
    'gemma3:12b',
    'glm-4.7-flash:latest',
    'gpt-oss:latest',
];

const OPENAI_NON_CHAT_MODELS_REAL: string[] = [
    // gpt-5-pro family — Responses API only
    'gpt-5-pro',
    'gpt-5-pro-2025-12-01',
    'gpt-5-pro-mini',
    // Realtime
    'gpt-4o-realtime-preview',
    'gpt-4o-realtime-preview-2024-12-17',
    'gpt-4o-mini-realtime-preview',
    // Audio
    'gpt-4o-audio-preview',
    'gpt-4o-audio-preview-2024-12-17',
    'gpt-4o-mini-audio-preview',
    // TTS
    'tts-1',
    'tts-1-hd',
    'gpt-4o-mini-tts',
    // Transcription / Whisper
    'whisper-1',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
    // Image gen
    'dall-e-3',
    'dall-e-2',
    'gpt-image-1',
    // Embeddings
    'text-embedding-3-small',
    'text-embedding-3-large',
    'text-embedding-ada-002',
    'bge-m3:latest',
    'nomic-embed-text:latest',
    // Moderation
    'omni-moderation-latest',
    'text-moderation-latest',
    // Codex / instruct (legacy completion API)
    'code-davinci-002',
    'davinci-002-codex',
    'text-davinci-003-instruct',
    // OCR / vision-only
    'deepseek-ocr:latest',
    'glm-ocr:latest',
    'minicpm-v:latest',
    'granite3.2-vision:latest',
];

describe('LLMSyncWorker.filter — allowlist (KNOWN_CHAT_MODEL_PREFIXES)', () => {
    it('exposes a non-empty, frozen list', () => {
        expect(KNOWN_CHAT_MODEL_PREFIXES.length).toBeGreaterThan(5);
        expect(Object.isFrozen(KNOWN_CHAT_MODEL_PREFIXES)).toBe(true);
    });

    it.each([
        'gpt-5.5-pro-2026-04-23',
        'gpt-5',
        'gpt-4o',
        'gpt-4.1-mini',
        'gpt-3.5-turbo',
        'o1',
        'o3-mini',
        'o4-mini',
        'claude-opus-4-6',
        'gemini-2.0-flash',
        'mistral-large',
        'llama-3.1-70b',
        'qwen3:32b',
        'phi4:latest',
        'gemma3:12b',
        'deepseek-r1:32b',
        'glm-4.7-flash:latest',
    ])('matches chat model prefix: %s', (modelId) => {
        expect(matchesAllowlist(modelId)).toBe(true);
    });

    it.each([
        'whisper-1',
        'tts-1',
        'dall-e-3',
        'text-embedding-3-small',
        'omni-moderation-latest',
    ])('does not match unrelated families: %s', (modelId) => {
        expect(matchesAllowlist(modelId)).toBe(false);
    });
});

describe('LLMSyncWorker.filter — blacklist (CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS)', () => {
    it('exposes a non-empty, frozen list', () => {
        expect(CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS.length).toBeGreaterThan(5);
        expect(Object.isFrozen(CHAT_COMPLETIONS_INCOMPATIBLE_PATTERNS)).toBe(true);
    });

    it('matches gpt-5-pro exactly but not gpt-5.5-pro', () => {
        expect(matchesBlacklist('gpt-5-pro')).toBe(true);
        expect(matchesBlacklist('gpt-5-pro-2025-12-01')).toBe(true);
        expect(matchesBlacklist('gpt-5.5-pro')).toBe(false);
        expect(matchesBlacklist('gpt-5.5-pro-2026-04-23')).toBe(false);
    });

    it.each([
        'whisper-1',
        'gpt-4o-transcribe',
        'tts-1',
        'gpt-4o-audio-preview',
        'dall-e-3',
        'gpt-image-1',
        'text-embedding-3-small',
        'omni-moderation-latest',
        'gpt-4o-realtime-preview',
        'deepseek-ocr:latest',
    ])('flags non-chat model as incompatible: %s', (modelId) => {
        expect(matchesBlacklist(modelId)).toBe(true);
    });
});

describe('LLMSyncWorker.filter — isChatCompletionsCompatible (decision)', () => {
    it('returns false for empty / invalid input', () => {
        expect(isChatCompletionsCompatible('')).toBe(false);
        // @ts-expect-error: defensive check on non-string input
        expect(isChatCompletionsCompatible(undefined)).toBe(false);
        // @ts-expect-error: defensive check on non-string input
        expect(isChatCompletionsCompatible(null)).toBe(false);
    });

    it('keeps gpt-5.5-pro-2026-04-23 (regression for the v2.1.62 false-positive)', () => {
        expect(isChatCompletionsCompatible('gpt-5.5-pro-2026-04-23')).toBe(true);
    });

    it('keeps every model in the realistic chat fixture', () => {
        const failing = OPENAI_CHAT_MODELS_REAL.filter(m => !isChatCompletionsCompatible(m));
        expect(failing).toEqual([]);
    });

    it('rejects every model in the realistic non-chat fixture', () => {
        const wronglyKept = OPENAI_NON_CHAT_MODELS_REAL.filter(m => isChatCompletionsCompatible(m));
        expect(wronglyKept).toEqual([]);
    });

    it('blacklist wins for a chat-prefix id that explicitly hits an incompatible pattern', () => {
        // gpt-5-pro is allowlisted by family but Responses-only — blacklist must win
        expect(matchesAllowlist('gpt-5-pro')).toBe(true);
        expect(matchesBlacklist('gpt-5-pro')).toBe(true);
        expect(isChatCompletionsCompatible('gpt-5-pro')).toBe(false);
    });

    it('open default: unknown but harmless ids are kept (no aggressive filtering)', () => {
        expect(isChatCompletionsCompatible('some-new-provider-chat-2030')).toBe(true);
    });
});
