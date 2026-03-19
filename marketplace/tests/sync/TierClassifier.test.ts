import { describe, it, expect } from 'vitest';
import { classifyTier } from '../../src/sync/TierClassifier.js';

describe('TierClassifier', () => {
  describe('classifyTier', () => {
    const tier1Categories = [
      'document-processing',
      'database',
      'security',
      'development-tools',
      'ai-research',
      'web-data',
      'browser_automation',
    ];

    const tier2Categories = [
      'deep-research-team',
      'data-ai',
      'enterprise-communication',
      'git-workflow',
      'monitoring',
    ];

    const tier3Categories = [
      'game-development',
      'blockchain',
      'sports',
      'pentest',
      'framework-specific',
      'unknown',
      '',
      'some-random-category',
    ];

    it.each(tier1Categories)('should classify "%s" as tier1', (category) => {
      expect(classifyTier(category)).toBe('tier1');
    });

    it.each(tier2Categories)('should classify "%s" as tier2', (category) => {
      expect(classifyTier(category)).toBe('tier2');
    });

    it.each(tier3Categories)('should classify "%s" as tier3 (default)', (category) => {
      expect(classifyTier(category)).toBe('tier3');
    });

    it('should return tier3 for unknown categories', () => {
      expect(classifyTier('totally-made-up')).toBe('tier3');
    });

    it('should be case-sensitive', () => {
      expect(classifyTier('Database')).toBe('tier3');
      expect(classifyTier('SECURITY')).toBe('tier3');
    });
  });
});
