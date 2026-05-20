import { describe, it, expect } from 'vitest';
import { completionSchema } from './types.js';

// ─── DEBT-80-C: webSearch alias Zod ──────────────────────────────────────────
// Validates that completionSchema accepts the camelCase `webSearch` alias
// and maps it to the canonical `force_web_search` field internally.
// The TS type of the parsed output must remain unchanged (force_web_search boolean).
describe('completionSchema — DEBT-80-C webSearch alias', () => {
  const basePayload = {
    model: 'gpt-4o',
    message: 'test message',
  };

  it('parses {webSearch: true} and produces force_web_search=true in output', () => {
    const result = completionSchema.parse({ ...basePayload, webSearch: true });
    expect(result.force_web_search).toBe(true);
  });

  it('parses {webSearch: false} and produces force_web_search=false in output', () => {
    const result = completionSchema.parse({ ...basePayload, webSearch: false });
    expect(result.force_web_search).toBe(false);
  });

  it('force_web_search takes precedence when both are provided', () => {
    const result = completionSchema.parse({ ...basePayload, webSearch: false, force_web_search: true });
    expect(result.force_web_search).toBe(true);
  });

  it('canonical force_web_search still works without alias', () => {
    const result = completionSchema.parse({ ...basePayload, force_web_search: true });
    expect(result.force_web_search).toBe(true);
  });

  it('parsed output does not contain webSearch key (alias is normalized away)', () => {
    const result = completionSchema.parse({ ...basePayload, webSearch: true }) as any;
    expect(result.webSearch).toBeUndefined();
  });
});
// ─────────────────────────────────────────────────────────────────────────────
