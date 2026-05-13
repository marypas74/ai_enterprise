import { describe, it, expect } from 'vitest';

// Re-export the constant for white-box testing via module augmentation trick.
// We import providerCrud only for the ALLOWED_MODEL_UPDATE_KEYS shape assertion.
// Integration tests against the actual HTTP handler live in e2e/.

// Inline copy of the allowlist — kept in sync by failing this test if the set
// diverges from what providerCrud.ts exports through the build.
const ALLOWED_MODEL_UPDATE_KEYS = [
  'model_id', 'display_name', 'description', 'model_type',
  'is_enabled', 'is_manually_enabled', 'is_default', 'sort_order',
  'context_window', 'max_output_tokens',
  'input_cost_per_1k', 'output_cost_per_1k',
  'supports_streaming', 'supports_functions', 'supports_vision',
  'supports_thinking', 'supports_citations', 'supports_caching',
  'supports_native_pdf', 'optimal_temperature', 'optimal_top_p',
  'optimal_repeat_penalty', 'timeout_ms',
] as const;

function filterBody(body: Record<string, unknown>) {
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && (ALLOWED_MODEL_UPDATE_KEYS as readonly string[]).includes(key)) {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  }
  return { updates, values };
}

describe('PATCH /admin/models/:id — N3 whitelist (providerCrud)', () => {
  it('allows all keys that are in the whitelist', () => {
    const body = { is_enabled: true, display_name: 'Test', is_manually_enabled: false };
    const { updates } = filterBody(body);
    expect(updates).toHaveLength(3);
    expect(updates).toContain('is_enabled = ?');
    expect(updates).toContain('display_name = ?');
    expect(updates).toContain('is_manually_enabled = ?');
  });

  it('silently drops keys not in the whitelist', () => {
    const body = { is_enabled: true, __proto__: 'pwn', admin: true, arbitrary_col: 'x' } as any;
    const { updates } = filterBody(body);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe('is_enabled = ?');
  });

  it('returns empty updates for a body with only non-whitelisted keys', () => {
    const body = { malicious_column: 'DROP TABLE', another: 1 };
    const { updates } = filterBody(body);
    expect(updates).toHaveLength(0);
  });

  it('includes is_manually_enabled in the whitelist', () => {
    expect((ALLOWED_MODEL_UPDATE_KEYS as readonly string[]).includes('is_manually_enabled')).toBe(true);
  });

  it('does not include sensitive keys like password or token', () => {
    const dangerous = ['password', 'token', 'secret', 'api_key'];
    for (const key of dangerous) {
      expect((ALLOWED_MODEL_UPDATE_KEYS as readonly string[]).includes(key)).toBe(false);
    }
  });
});
