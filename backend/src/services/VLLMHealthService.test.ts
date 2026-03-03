import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VLLMHealthService, getVLLMHealthService } from './VLLMHealthService.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('VLLMHealthService', () => {
  let service: VLLMHealthService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VLLM_AUTH_KEY = 'test-auth-key';
    process.env.VLLM_API_KEY = 'test-api-key';
    service = new VLLMHealthService('http://10.0.1.1:8087/vllm');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isHealthy', () => {
    it('should return true when health endpoint responds 200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await service.isHealthy();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://10.0.1.1:8087/vllm/health',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Vllm-Key': 'test-auth-key'
          })
        })
      );
    });

    it('should return false when health endpoint returns non-200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const result = await service.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

      const result = await service.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('getServedModels', () => {
    it('should return models from vLLM API', async () => {
      const mockModels = {
        data: [
          { id: 'Qwen/Qwen3-14B', object: 'model', created: 1234567890, owned_by: 'vllm' },
          { id: 'google/gemma-3-12b-it', object: 'model', created: 1234567891, owned_by: 'vllm' }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockModels)
      });

      const models = await service.getServedModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('Qwen/Qwen3-14B');
      expect(models[1].id).toBe('google/gemma-3-12b-it');
    });

    it('should return empty array when API returns non-200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const models = await service.getServedModels();

      expect(models).toEqual([]);
    });

    it('should return empty array when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const models = await service.getServedModels();

      expect(models).toEqual([]);
    });

    it('should handle missing data field gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({})
      });

      const models = await service.getServedModels();

      expect(models).toEqual([]);
    });

    it('should include auth headers in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] })
      });

      await service.getServedModels();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://10.0.1.1:8087/vllm/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Vllm-Key': 'test-auth-key',
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
    });
  });

  describe('getServedModelIds', () => {
    it('should return Set of model IDs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { id: 'Qwen/Qwen3-14B', object: 'model', created: 0, owned_by: 'vllm' },
            { id: 'microsoft/phi-4', object: 'model', created: 0, owned_by: 'vllm' }
          ]
        })
      });

      const ids = await service.getServedModelIds();

      expect(ids).toBeInstanceOf(Set);
      expect(ids.has('Qwen/Qwen3-14B')).toBe(true);
      expect(ids.has('microsoft/phi-4')).toBe(true);
      expect(ids.size).toBe(2);
    });
  });

  describe('getVLLMHealthService singleton', () => {
    it('should return same instance when called without baseUrl', () => {
      const s1 = getVLLMHealthService('http://test:8087/vllm');
      const s2 = getVLLMHealthService();

      expect(s1).toBe(s2);
    });

    it('should create new instance when baseUrl changes', () => {
      const s1 = getVLLMHealthService('http://test1:8087/vllm');
      const s2 = getVLLMHealthService('http://test2:8087/vllm');

      expect(s1).not.toBe(s2);
    });
  });

  describe('env fallback', () => {
    it('should use VLLM_BASE_URL env when no baseUrl provided', () => {
      process.env.VLLM_BASE_URL = 'http://from-env:8087/vllm';
      const s = new VLLMHealthService();
      // Verify by calling isHealthy and checking the URL
      mockFetch.mockResolvedValueOnce({ ok: true });
      s.isHealthy();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://from-env:8087/vllm/health',
        expect.any(Object)
      );
    });
  });
});
