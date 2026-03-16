import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorService } from '../../../src/modules/orchestrator/OrchestratorService';
import { ApiClient } from '../../../src/core/ApiClient';
import { ConfigService } from '../../../src/core/ConfigService';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let apiClient: ApiClient;
  let configService: ConfigService;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ApiClient;
    configService = {
      getOrchestratorPollingInterval: vi.fn().mockReturnValue(10000),
      getOrchestratorShowStatusBar: vi.fn().mockReturnValue(true),
      getServerUrl: vi.fn().mockReturnValue('https://test.example.com'),
      getAllowSelfSigned: vi.fn().mockReturnValue(false),
    } as unknown as ConfigService;
    const outputChannel = createMockOutputChannel();
    service = new OrchestratorService(apiClient, configService, eventBus, outputChannel);
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it('should fetch orchestrator status via getStatus()', async () => {
    const status = { activeSlots: 2, totalSlots: 5, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);
    const result = await service.getStatus();
    expect(result).toEqual(status);
    expect(apiClient.get).toHaveBeenCalledWith('/api/orchestrator/status');
  });

  it('should emit orchestrator:update after getStatus()', async () => {
    const listener = vi.fn();
    eventBus.on('orchestrator:update', listener);
    const status = { activeSlots: 3, totalSlots: 5, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);
    await service.getStatus();
    expect(listener).toHaveBeenCalledWith({ activeSlots: 3, totalSlots: 5 });
  });

  it('should start polling and call getStatus immediately then at interval', async () => {
    const status = { activeSlots: 1, totalSlots: 4, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);
    service.startPolling();
    // Flush the immediate call
    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    // Advance by one interval
    await vi.advanceTimersByTimeAsync(10000);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('should stop polling when stopPolling() is called', async () => {
    const status = { activeSlots: 1, totalSlots: 4, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);
    service.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    service.stopPolling();
    await vi.advanceTimersByTimeAsync(20000);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('should start event stream via startEventStream()', () => {
    const onUpdate = vi.fn();
    const onError = vi.fn();
    service.startEventStream(onUpdate, onError);
    expect(apiClient.stream).toHaveBeenCalledWith(
      '/api/orchestrator/events',
      { stream: true },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('should stop event stream via stopEventStream()', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    service.startEventStream(vi.fn(), vi.fn());
    service.stopEventStream();
    expect(abortFn).toHaveBeenCalled();
  });

  it('should release a slot via releaseSlot()', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await service.releaseSlot(3);
    expect(apiClient.post).toHaveBeenCalledWith('/api/orchestrator/slots/release/3/release');
  });

  it('should terminate a session via terminateSession()', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await service.terminateSession('session-42');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/session-42/cancel');
  });

  it('should handle polling error gracefully without throwing', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network failure'));
    service.startPolling();
    // Flush the immediate call — should not throw
    await vi.advanceTimersByTimeAsync(0);
    // Polling continues despite error
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ activeSlots: 1, totalSlots: 4, slots: [] });
    await vi.advanceTimersByTimeAsync(10000);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('should not emit orchestrator:update when getStatus fails', async () => {
    const listener = vi.fn();
    eventBus.on('orchestrator:update', listener);
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Timeout'));
    await expect(service.getStatus()).rejects.toThrow('Timeout');
    expect(listener).not.toHaveBeenCalled();
  });
});
