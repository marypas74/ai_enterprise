import { describe, it, expect } from 'vitest';
import { calculateDiff } from '../../src/sync/DiffCalculator.js';
import type { CatalogItemInput } from '../../src/sync/CatalogParser.js';

function makeItem(overrides: Partial<CatalogItemInput> = {}): CatalogItemInput {
  return {
    source_id: 'skill:test',
    type: 'skill',
    tier: 'tier1',
    name: 'test',
    display_name: 'Test',
    description: 'A test item',
    category: 'testing',
    metadata: {},
    version: '1.0.0',
    ...overrides,
  };
}

describe('DiffCalculator', () => {
  it('should detect new items (in remote, not in local)', () => {
    const remote = [
      makeItem({ source_id: 'skill:alpha', version: '1.0.0' }),
      makeItem({ source_id: 'skill:beta', version: '2.0.0' }),
    ];
    const localSourceIds = new Set<string>();
    const localVersions = new Map<string, string>();

    const result = calculateDiff(remote, localSourceIds, localVersions);

    expect(result.added).toHaveLength(2);
    expect(result.added[0].source_id).toBe('skill:alpha');
    expect(result.added[1].source_id).toBe('skill:beta');
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('should detect updated items (in both but version differs)', () => {
    const remote = [
      makeItem({ source_id: 'skill:alpha', version: '2.0.0' }),
    ];
    const localSourceIds = new Set(['skill:alpha']);
    const localVersions = new Map([['skill:alpha', '1.0.0']]);

    const result = calculateDiff(remote, localSourceIds, localVersions);

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].source_id).toBe('skill:alpha');
    expect(result.updated[0].version).toBe('2.0.0');
    expect(result.removed).toHaveLength(0);
  });

  it('should not mark as updated when versions match', () => {
    const remote = [
      makeItem({ source_id: 'skill:alpha', version: '1.0.0' }),
    ];
    const localSourceIds = new Set(['skill:alpha']);
    const localVersions = new Map([['skill:alpha', '1.0.0']]);

    const result = calculateDiff(remote, localSourceIds, localVersions);

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('should detect removed items (in local, not in remote)', () => {
    const remote: CatalogItemInput[] = [];
    const localSourceIds = new Set(['skill:alpha', 'skill:beta']);
    const localVersions = new Map([
      ['skill:alpha', '1.0.0'],
      ['skill:beta', '1.0.0'],
    ]);

    const result = calculateDiff(remote, localSourceIds, localVersions);

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(2);
    expect(result.removed).toContain('skill:alpha');
    expect(result.removed).toContain('skill:beta');
  });

  it('should handle empty remote gracefully', () => {
    const localSourceIds = new Set(['skill:alpha']);
    const localVersions = new Map([['skill:alpha', '1.0.0']]);

    const result = calculateDiff([], localSourceIds, localVersions);

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toEqual(['skill:alpha']);
  });

  it('should handle empty local gracefully', () => {
    const remote = [
      makeItem({ source_id: 'skill:new', version: '1.0.0' }),
    ];

    const result = calculateDiff(remote, new Set(), new Map());

    expect(result.added).toHaveLength(1);
    expect(result.added[0].source_id).toBe('skill:new');
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('should handle mixed add/update/remove scenario', () => {
    const remote = [
      makeItem({ source_id: 'skill:existing', version: '2.0.0' }),
      makeItem({ source_id: 'skill:brand-new', version: '1.0.0' }),
    ];
    const localSourceIds = new Set(['skill:existing', 'skill:gone']);
    const localVersions = new Map([
      ['skill:existing', '1.0.0'],
      ['skill:gone', '1.0.0'],
    ]);

    const result = calculateDiff(remote, localSourceIds, localVersions);

    expect(result.added).toHaveLength(1);
    expect(result.added[0].source_id).toBe('skill:brand-new');
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].source_id).toBe('skill:existing');
    expect(result.removed).toEqual(['skill:gone']);
  });
});
