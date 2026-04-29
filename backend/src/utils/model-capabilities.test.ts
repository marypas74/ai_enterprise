/**
 * Tests for model-capabilities — v2.1.64 additions:
 *   - qwen3-vl:8b vision detection + context window
 *   - LEGACY_MODEL_REDIRECTS mapping (deprecated → successor)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  inferModelCapabilities,
  inferContextWindow,
  redirectLegacyModel,
  LEGACY_MODEL_REDIRECTS,
} from './model-capabilities.js';

describe('inferModelCapabilities — qwen3-vl', () => {
  it('detects qwen3-vl:8b as vision + chat-capable + streaming', () => {
    const caps = inferModelCapabilities('qwen3-vl:8b');
    expect(caps.supports_vision).toBe(true);
    expect(caps.supports_functions).toBe(true);
    expect(caps.supports_streaming).toBe(true);
  });

  it('detects qwen3-vl-instruct variant as vision', () => {
    expect(inferModelCapabilities('qwen3-vl-instruct').supports_vision).toBe(true);
  });

  it('detects qwen3-vl as a thinking model (qwen3 family)', () => {
    expect(inferModelCapabilities('qwen3-vl:8b').supports_thinking).toBe(true);
  });

  it('does NOT mark plain qwen3:8b as vision (no vl)', () => {
    expect(inferModelCapabilities('qwen3:8b').supports_vision).toBe(false);
  });
});

describe('inferContextWindow', () => {
  it('returns 128k for qwen3-vl:8b', () => {
    expect(inferContextWindow('qwen3-vl:8b')).toBe(128_000);
  });

  it('returns 128k for qwen3:14b', () => {
    expect(inferContextWindow('qwen3:14b')).toBe(128_000);
  });

  it('returns null for unknown families', () => {
    expect(inferContextWindow('llama-foo:bar')).toBeNull();
  });
});

describe('LEGACY_MODEL_REDIRECTS / redirectLegacyModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects deprecated qwen2.5vl:7b to qwen3-vl:8b', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(redirectLegacyModel('qwen2.5vl:7b')).toBe('qwen3-vl:8b');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('qwen2.5vl:7b'));
  });

  it('redirects granite3.2-vision:latest, minicpm-v:latest', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(redirectLegacyModel('granite3.2-vision:latest')).toBe('qwen3-vl:8b');
    expect(redirectLegacyModel('minicpm-v:latest')).toBe('qwen3-vl:8b');
  });

  it('redirects deprecated embedding tags to qwen3-embedding', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(redirectLegacyModel('nomic-embed-text:latest')).toBe('qwen3-embedding');
    expect(redirectLegacyModel('snowflake-arctic-embed:110m')).toBe('qwen3-embedding');
  });

  it('returns the original id when no redirect is configured', () => {
    expect(redirectLegacyModel('claude-opus-4-7')).toBe('claude-opus-4-7');
  });

  it('LEGACY_MODEL_REDIRECTS is frozen (immutability invariant)', () => {
    expect(Object.isFrozen(LEGACY_MODEL_REDIRECTS)).toBe(true);
  });
});
