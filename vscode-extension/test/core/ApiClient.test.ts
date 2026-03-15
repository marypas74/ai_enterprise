import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../../src/core/ApiClient';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';
import { createMockOutputChannel } from '../setup';

vi.mock('axios', () => {
  const mockInstance = {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: 'test' } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: 'created' } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    default: { create: vi.fn().mockReturnValue(mockInstance) },
  };
});

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_key: string, def: unknown) => def),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('ApiClient', () => {
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    apiClient = new ApiClient(configService, eventBus, outputChannel);
  });

  it('should perform GET request', async () => {
    const result = await apiClient.get<string>('/api/test');
    expect(result).toBe('test');
  });

  it('should perform POST request', async () => {
    const result = await apiClient.post<string>('/api/test', { data: 'value' });
    expect(result).toBe('created');
  });

  it('should perform DELETE request', async () => {
    await expect(apiClient.delete('/api/test')).resolves.not.toThrow();
  });

  it('should set auth token', () => {
    apiClient.setToken('test-token');
    expect(apiClient.hasToken()).toBe(true);
  });

  it('should clear auth token', () => {
    apiClient.setToken('test-token');
    apiClient.clearToken();
    expect(apiClient.hasToken()).toBe(false);
  });
});
