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

describe('ApiClient — retry edge cases', () => {
  let eventBus: EventBus;
  let apiClient: ApiClient;
  let mockAxiosInstance: Record<string, unknown>;

  beforeEach(async () => {
    const axiosModule = await import('axios');
    mockAxiosInstance = (axiosModule.default.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    apiClient = new ApiClient(configService, eventBus, outputChannel);
  });

  it('should retry on transient error and succeed on second attempt', async () => {
    const getMock = (apiClient as unknown as { client: { get: ReturnType<typeof vi.fn> } }).client?.get;
    // We need to access the axios mock instance directly
    const axiosModule = await import('axios');
    const instance = (axiosModule.default.create as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    let callCount = 0;
    (instance.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject({ response: { status: 500 }, isAxiosError: true });
      }
      return Promise.resolve({ data: { success: true, data: 'recovered' } });
    });

    const result = await apiClient.get<string>('/api/test');
    expect(result).toBe('recovered');
    expect(callCount).toBe(2);
  });

  it('should NOT retry on 401', async () => {
    const axiosModule = await import('axios');
    const instance = (axiosModule.default.create as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    let callCount = 0;
    (instance.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.reject({ response: { status: 401 }, isAxiosError: true });
    });

    await expect(apiClient.get('/api/test')).rejects.toBeTruthy();
    expect(callCount).toBe(1);
  });

  it('should NOT retry on 403', async () => {
    const axiosModule = await import('axios');
    const instance = (axiosModule.default.create as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    let callCount = 0;
    (instance.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.reject({ response: { status: 403 }, isAxiosError: true });
    });

    await expect(apiClient.get('/api/test')).rejects.toBeTruthy();
    expect(callCount).toBe(1);
  });

  it('should fail after max retries exhausted', async () => {
    const axiosModule = await import('axios');
    const instance = (axiosModule.default.create as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    let callCount = 0;
    (instance.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.reject({ response: { status: 500 }, isAxiosError: true });
    });

    await expect(apiClient.get('/api/test')).rejects.toBeTruthy();
    expect(callCount).toBe(3); // default retries = 3
  });

  it('should update baseURL when config:changed fires', async () => {
    const axiosModule = await import('axios');
    const instance = (axiosModule.default.create as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    eventBus.emit('config:changed', { key: 'enterprise-ai', value: {} });
    // After config:changed, the client defaults baseURL should be updated
    // It reads from configService.getServerUrl() which returns the default
    expect(instance.defaults.baseURL).toBeDefined();
  });
});

describe('ApiClient — SSE edge cases', () => {
  it('should return AbortController from stream()', () => {
    const eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    const apiClient = new ApiClient(configService, eventBus, outputChannel);

    // Mock global fetch to prevent actual network calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // hang forever

    const controller = apiClient.stream('/api/test', {}, vi.fn());
    expect(controller).toBeInstanceOf(AbortController);

    // Abort to clean up
    controller.abort();
    globalThis.fetch = originalFetch;
  });

  it('should abort streaming gracefully', async () => {
    const eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    const apiClient = new ApiClient(configService, eventBus, outputChannel);

    const onChunk = vi.fn();
    const onError = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    const controller = apiClient.stream('/api/test', {}, onChunk, onError);
    controller.abort();

    // Give the async doStream a tick to process
    await new Promise((r) => setTimeout(r, 50));

    // onError should NOT be called when abort is the cause
    expect(onError).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  it('should parse SSE data lines correctly', async () => {
    const eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    const apiClient = new ApiClient(configService, eventBus, outputChannel);

    const chunks: unknown[] = [];
    const ssePayload = 'data: {"content":"hello"}\ndata: {"content":"world"}\n\n';
    const encoder = new TextEncoder();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: () => {
              if (!sent) {
                sent = true;
                return Promise.resolve({ done: false, value: encoder.encode(ssePayload) });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      },
    });

    const controller = apiClient.stream('/api/test', {}, (chunk) => chunks.push(chunk));
    await new Promise((r) => setTimeout(r, 50));

    expect(chunks).toEqual([{ content: 'hello' }, { content: 'world' }]);
    controller.abort();
    globalThis.fetch = originalFetch;
  });

  it('should skip malformed SSE data lines', async () => {
    const eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    const apiClient = new ApiClient(configService, eventBus, outputChannel);

    const chunks: unknown[] = [];
    const ssePayload = 'data: {invalid json}\ndata: {"content":"valid"}\n\n';
    const encoder = new TextEncoder();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: () => {
              if (!sent) {
                sent = true;
                return Promise.resolve({ done: false, value: encoder.encode(ssePayload) });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      },
    });

    const controller = apiClient.stream('/api/test', {}, (chunk) => chunks.push(chunk));
    await new Promise((r) => setTimeout(r, 50));

    // Only the valid chunk should be received
    expect(chunks).toEqual([{ content: 'valid' }]);
    controller.abort();
    globalThis.fetch = originalFetch;
  });
});
