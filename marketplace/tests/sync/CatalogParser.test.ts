import { describe, it, expect } from 'vitest';
import { parseCatalogItem, parseRawCatalog } from '../../src/sync/CatalogParser.js';

describe('CatalogParser', () => {
  describe('parseCatalogItem', () => {
    const validRaw = {
      name: 'code-review',
      display_name: 'Code Review',
      description: 'Reviews code for quality issues',
      category: 'development-tools',
      version: '1.0.0',
      metadata: { author: 'test' },
    };

    it('should build correct source_id as {type}:{name}', () => {
      const result = parseCatalogItem(validRaw, 'skill');
      expect(result.source_id).toBe('skill:code-review');
    });

    it('should assign tier via TierClassifier', () => {
      const tier1Item = { ...validRaw, category: 'security' };
      const tier2Item = { ...validRaw, category: 'monitoring' };
      const tier3Item = { ...validRaw, category: 'unknown-cat' };

      expect(parseCatalogItem(tier1Item, 'skill').tier).toBe('tier1');
      expect(parseCatalogItem(tier2Item, 'agent').tier).toBe('tier2');
      expect(parseCatalogItem(tier3Item, 'mcp').tier).toBe('tier3');
    });

    it('should truncate long descriptions to 2000 chars', () => {
      const longDesc = 'a'.repeat(3000);
      const item = { ...validRaw, description: longDesc };

      const result = parseCatalogItem(item, 'skill');
      expect(result.description).toHaveLength(2000);
    });

    it('should sanitize HTML tags from description', () => {
      const item = {
        ...validRaw,
        description: 'Hello <b>world</b> and <script>alert("xss")</script> test',
      };

      const result = parseCatalogItem(item, 'skill');
      expect(result.description).toBe('Hello world and alert("xss") test');
      expect(result.description).not.toContain('<');
      expect(result.description).not.toContain('>');
    });

    it('should sanitize HTML before truncating', () => {
      const htmlDesc = '<p>' + 'a'.repeat(2500) + '</p>';
      const result = parseCatalogItem({ ...validRaw, description: htmlDesc }, 'skill');
      expect(result.description).toHaveLength(2000);
      expect(result.description).not.toContain('<');
    });

    it('should handle missing optional fields gracefully', () => {
      const minimal = { name: 'minimal-tool' };
      const result = parseCatalogItem(minimal, 'hook');

      expect(result.source_id).toBe('hook:minimal-tool');
      expect(result.type).toBe('hook');
      expect(result.tier).toBe('tier3');
      expect(result.name).toBe('minimal-tool');
      expect(result.display_name).toBe('');
      expect(result.description).toBe('');
      expect(result.category).toBe('');
      expect(result.metadata).toEqual({});
      expect(result.version).toBe('');
    });

    it('should set the correct type from the argument', () => {
      const result = parseCatalogItem(validRaw, 'agent');
      expect(result.type).toBe('agent');
    });

    it('should preserve metadata as-is', () => {
      const meta = { author: 'test', tags: ['a', 'b'] };
      const result = parseCatalogItem({ ...validRaw, metadata: meta }, 'skill');
      expect(result.metadata).toEqual(meta);
    });

    it('should handle non-object input by using defaults', () => {
      const result = parseCatalogItem(null, 'skill');
      expect(result.name).toBe('');
      expect(result.source_id).toBe('skill:');
    });
  });

  describe('parseRawCatalog', () => {
    it('should map over array calling parseCatalogItem', () => {
      const rawItems = [
        { name: 'tool-a', category: 'security' },
        { name: 'tool-b', category: 'monitoring' },
      ];

      const results = parseRawCatalog(rawItems, 'skill');

      expect(results).toHaveLength(2);
      expect(results[0].source_id).toBe('skill:tool-a');
      expect(results[0].tier).toBe('tier1');
      expect(results[1].source_id).toBe('skill:tool-b');
      expect(results[1].tier).toBe('tier2');
    });

    it('should return empty array for empty input', () => {
      expect(parseRawCatalog([], 'agent')).toEqual([]);
    });
  });
});
