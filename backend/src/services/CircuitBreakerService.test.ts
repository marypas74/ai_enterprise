import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isProviderHealthy,
  recordProviderError,
  recordProviderSuccess,
  getProviderHealthStatus,
  resetAllProviders,
} from './CircuitBreakerService.js';

describe('CircuitBreakerService', () => {
  beforeEach(() => {
    resetAllProviders();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isProviderHealthy', () => {
    it('should return true for unknown providers', () => {
      expect(isProviderHealthy('new-provider')).toBe(true);
    });

    it('should return true when errors are below threshold', () => {
      recordProviderError('claude');
      recordProviderError('claude');
      expect(isProviderHealthy('claude')).toBe(true); // 2 < 3
    });

    it('should return false when errors reach threshold', () => {
      recordProviderError('claude');
      recordProviderError('claude');
      recordProviderError('claude');
      expect(isProviderHealthy('claude')).toBe(false); // 3 >= 3
    });

    it('should reset after timeout period', () => {
      recordProviderError('claude');
      recordProviderError('claude');
      recordProviderError('claude');
      expect(isProviderHealthy('claude')).toBe(false);

      // Fast-forward past the reset timeout (60s)
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
      expect(isProviderHealthy('claude')).toBe(true);
    });
  });

  describe('recordProviderSuccess', () => {
    it('should clear error tracking', () => {
      recordProviderError('claude');
      recordProviderError('claude');
      recordProviderError('claude');
      expect(isProviderHealthy('claude')).toBe(false);

      recordProviderSuccess('claude');
      expect(isProviderHealthy('claude')).toBe(true);
    });
  });

  describe('getProviderHealthStatus', () => {
    it('should return empty for no tracked providers', () => {
      expect(getProviderHealthStatus()).toEqual({});
    });

    it('should return status for tracked providers', () => {
      recordProviderError('claude');
      recordProviderError('openai');
      recordProviderError('openai');
      recordProviderError('openai');

      const status = getProviderHealthStatus();
      expect(status.claude.healthy).toBe(true);
      expect(status.claude.errorCount).toBe(1);
      expect(status.openai.healthy).toBe(false);
      expect(status.openai.errorCount).toBe(3);
    });
  });

  describe('resetAllProviders', () => {
    it('should clear all tracking', () => {
      recordProviderError('claude');
      recordProviderError('openai');
      resetAllProviders();
      expect(getProviderHealthStatus()).toEqual({});
    });
  });
});
