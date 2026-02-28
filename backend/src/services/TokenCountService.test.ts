import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokens, contextUsagePercent, countTokensAnthropic } from './TokenCountService.js';

describe('TokenCountService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('estimateTokens', () => {
    it('should estimate ~4 chars per token', () => {
      expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle null/undefined gracefully', () => {
      expect(estimateTokens(null as any)).toBe(0);
      expect(estimateTokens(undefined as any)).toBe(0);
    });

    it('should ceil the result', () => {
      expect(estimateTokens('ab')).toBe(1); // 2 / 4 = 0.5 → 1
    });

    it('should handle long text', () => {
      const longText = 'a'.repeat(4000);
      expect(estimateTokens(longText)).toBe(1000);
    });
  });

  describe('contextUsagePercent', () => {
    it('should calculate percentage correctly', () => {
      expect(contextUsagePercent(500, 1000)).toBe(50);
    });

    it('should return 0 for zero context window', () => {
      expect(contextUsagePercent(500, 0)).toBe(0);
    });

    it('should handle over 100%', () => {
      expect(contextUsagePercent(1500, 1000)).toBe(150);
    });
  });

  describe('countTokensAnthropic', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should call Anthropic count_tokens API and return result', async () => {
      const mockResponse = { input_tokens: 42 };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const result = await countTokensAnthropic(
        'test-api-key',
        'claude-sonnet-4-20250514',
        [{ role: 'user', content: 'Hello' }],
        'Be helpful',
      );

      expect(result.inputTokens).toBe(42);
      expect(result.source).toBe('api');

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.anthropic.com/v1/messages/count_tokens');
      expect(fetchCall[1].headers['x-api-key']).toBe('test-api-key');
      expect(fetchCall[1].headers['anthropic-beta']).toBe('token-counting-2024-11-01');
    });

    it('should throw on API error with truncated message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }));

      await expect(
        countTokensAnthropic('bad-key', 'claude-sonnet-4-20250514', [])
      ).rejects.toThrow('Anthropic count_tokens failed (401)');
    });

    it('should include system and tools when provided', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ input_tokens: 100 }),
      }));

      await countTokensAnthropic(
        'key',
        'claude-sonnet-4-20250514',
        [{ role: 'user', content: 'Hi' }],
        'System prompt',
        [{ name: 'tool', description: 'desc', input_schema: {} }],
      );

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.system).toBe('System prompt');
      expect(body.tools).toHaveLength(1);
    });
  });
});
