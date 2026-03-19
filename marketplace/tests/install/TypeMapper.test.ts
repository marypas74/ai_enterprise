import { describe, it, expect } from 'vitest';
import {
  mapTargetType,
  mapCategory,
  requiresApproval,
} from '../../src/install/TypeMapper.js';

describe('TypeMapper', () => {
  describe('mapTargetType', () => {
    it('should map skill to skill', () => {
      expect(mapTargetType('skill')).toBe('skill');
    });

    it('should map agent to skill', () => {
      expect(mapTargetType('agent')).toBe('skill');
    });

    it('should map mcp to mcp_server', () => {
      expect(mapTargetType('mcp')).toBe('mcp_server');
    });

    it('should map hook to hook_handler', () => {
      expect(mapTargetType('hook')).toBe('hook_handler');
    });
  });

  describe('mapCategory', () => {
    const technicalCategories = [
      'document-processing',
      'database',
      'devops-infrastructure',
      'security',
    ];

    const codingCategories = [
      'development-tools',
      'programming-languages',
    ];

    const analysisCategories = [
      'ai-research',
      'data-ai',
    ];

    it.each(technicalCategories)('should map "%s" to technical', (category) => {
      expect(mapCategory(category)).toBe('technical');
    });

    it.each(codingCategories)('should map "%s" to coding', (category) => {
      expect(mapCategory(category)).toBe('coding');
    });

    it.each(analysisCategories)('should map "%s" to analysis', (category) => {
      expect(mapCategory(category)).toBe('analysis');
    });

    it('should map deep-research-team to research', () => {
      expect(mapCategory('deep-research-team')).toBe('research');
    });

    it('should map enterprise-communication to communication', () => {
      expect(mapCategory('enterprise-communication')).toBe('communication');
    });

    it('should map creative-design to creative', () => {
      expect(mapCategory('creative-design')).toBe('creative');
    });

    it('should map media to creative', () => {
      expect(mapCategory('media')).toBe('creative');
    });

    it('should map unknown categories to other', () => {
      expect(mapCategory('unknown')).toBe('other');
      expect(mapCategory('some-random-thing')).toBe('other');
      expect(mapCategory('')).toBe('other');
    });
  });

  describe('requiresApproval', () => {
    it('should return false for skill', () => {
      expect(requiresApproval('skill')).toBe(false);
    });

    it('should return false for agent', () => {
      expect(requiresApproval('agent')).toBe(false);
    });

    it('should return true for mcp', () => {
      expect(requiresApproval('mcp')).toBe(true);
    });

    it('should return true for hook', () => {
      expect(requiresApproval('hook')).toBe(true);
    });
  });
});
