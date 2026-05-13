import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tests for the toggleManuallyEnabled logic extracted from ModelsPage.
// Full E2E coverage lives in frontend/tests/e2e/admin-models-toggle.spec.ts.

type ModelStub = {
  id: number;
  is_manually_enabled: boolean;
};

function applyToggleManuallyEnabled(models: ModelStub[], id: number, value: boolean): ModelStub[] {
  return models.map(m => m.id === id ? { ...m, is_manually_enabled: value } : m);
}

describe('ModelsPage — toggleManuallyEnabled (N4)', () => {
  const baseModels: ModelStub[] = [
    { id: 1, is_manually_enabled: false },
    { id: 2, is_manually_enabled: true },
  ];

  it('sets is_manually_enabled = true for the target model', () => {
    const updated = applyToggleManuallyEnabled(baseModels, 1, true);
    expect(updated.find(m => m.id === 1)?.is_manually_enabled).toBe(true);
  });

  it('sets is_manually_enabled = false (reset) for the target model', () => {
    const updated = applyToggleManuallyEnabled(baseModels, 2, false);
    expect(updated.find(m => m.id === 2)?.is_manually_enabled).toBe(false);
  });

  it('does not mutate other models', () => {
    const updated = applyToggleManuallyEnabled(baseModels, 1, true);
    expect(updated.find(m => m.id === 2)?.is_manually_enabled).toBe(true);
  });

  it('is idempotent when value equals current state', () => {
    const updated = applyToggleManuallyEnabled(baseModels, 1, false);
    expect(updated.find(m => m.id === 1)?.is_manually_enabled).toBe(false);
  });

  it('does not modify models with non-matching id', () => {
    const updated = applyToggleManuallyEnabled(baseModels, 999, true);
    expect(updated).toEqual(baseModels);
  });
});
