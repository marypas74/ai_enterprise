import { describe, it, expect } from 'vitest';
import { estimateMessageTokens, ASYNC_TOKEN_THRESHOLD } from './tokenEstimator.js';
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
    expect(result).toBeLessThan(2000);
  });

  it('returns 0 for empty messages array', () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it('ASYNC_TOKEN_THRESHOLD is 8000', () => {
    expect(ASYNC_TOKEN_THRESHOLD).toBe(8000);
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
});
