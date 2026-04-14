import { describe, it, expect } from 'vitest';
import { estimateMessageTokens, ASYNC_TOKEN_THRESHOLD, MAX_TOKEN_LIMIT } from './tokenEstimator.js';
import type { Message } from '../modules/ai/providers.js';

describe('estimateMessageTokens', () => {
  it('estimates text-only messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello world' },
    ];
    // 17 chars system + 11 chars user = 28 chars / 4 = 7 tokens
    expect(estimateMessageTokens(messages)).toBe(7);
  });

  it('estimates multipart messages with image_url', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(100) } },
        ] as any,
      },
    ];
    const result = estimateMessageTokens(messages);
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(20000);
  });

  it('returns 0 for empty messages array', () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it('ASYNC_TOKEN_THRESHOLD is 8000', () => {
    expect(ASYNC_TOKEN_THRESHOLD).toBe(8000);
  });

  it('MAX_TOKEN_LIMIT is 64000', () => {
    expect(MAX_TOKEN_LIMIT).toBe(64000);
  });

  it('correctly identifies large document over threshold', () => {
    const messages: Message[] = [
      { role: 'user', content: 'A'.repeat(40000) },
    ];
    expect(estimateMessageTokens(messages)).toBeGreaterThan(ASYNC_TOKEN_THRESHOLD);
  });

  it('correctly identifies small message under threshold', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Summarize this in one line.' },
    ];
    expect(estimateMessageTokens(messages)).toBeLessThan(ASYNC_TOKEN_THRESHOLD);
  });

  it('applies x100 factor to base64 image token estimation', () => {
    // base64 string of 1000 chars => estimatedBytes = 750 => tokens = ceil(750 / 560 * 100) = ceil(133.9) = 134
    const base64Str = 'A'.repeat(1000);
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64Str } },
        ] as any,
      },
    ];
    const result = estimateMessageTokens(messages);
    // Expected: ceil(1000 * 0.75 / 560 * 100) = ceil(133.93) = 134
    expect(result).toBe(134);
  });

  it('returns at least 64 tokens for tiny base64 images', () => {
    const tinyBase64 = 'A'.repeat(10);
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + tinyBase64 } },
        ] as any,
      },
    ];
    const result = estimateMessageTokens(messages);
    expect(result).toBeGreaterThanOrEqual(64);
  });

  it('returns 1000 tokens for non-base64 image url', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ] as any,
      },
    ];
    const result = estimateMessageTokens(messages);
    expect(result).toBe(1000);
  });
});
