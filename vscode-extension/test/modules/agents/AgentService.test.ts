import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../../../src/modules/agents/AgentService';
import { ApiClient } from '../../../src/core/ApiClient';
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

describe('AgentService', () => {
  let agentService: AgentService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    agentService = new AgentService(apiClient, eventBus, outputChannel);
  });

  it('should fetch agent templates', async () => {
    const templates = [{ id: 't1', name: 'Code Review', description: 'Reviews code', category: 'dev' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(templates);
    const result = await agentService.getTemplates();
    expect(result).toEqual(templates);
  });

  it('should fetch sessions', async () => {
    const sessions = [{ id: 's1', templateId: 't1', templateName: 'Code Review', prompt: 'Review this', status: 'running', createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);
    const result = await agentService.getSessions();
    expect(result).toEqual(sessions);
  });

  it('should create a new session', async () => {
    const session = { id: 's2', templateId: 't1', templateName: 'Code Review', prompt: 'Fix bugs', status: 'running', createdAt: '', updatedAt: '' };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    const result = await agentService.createSession('t1', 'Fix bugs');
    expect(result).toEqual(session);
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions', { templateId: 't1', prompt: 'Fix bugs' });
  });

  it('should emit agent:started on session creation', async () => {
    const listener = vi.fn();
    eventBus.on('agent:started', listener);
    const session = { id: 's3', templateId: 't1', templateName: 'Test', prompt: 'Test', status: 'running', createdAt: '', updatedAt: '' };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    await agentService.createSession('t1', 'Test');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's3' });
  });

  it('should pause a session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await agentService.pauseSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/pause');
  });

  it('should resume a session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await agentService.resumeSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/resume');
  });

  it('should cancel a session and emit agent:completed', async () => {
    const listener = vi.fn();
    eventBus.on('agent:completed', listener);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await agentService.cancelSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/cancel');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's1', status: 'cancelled' });
  });

  it('should start log streaming for a session', () => {
    agentService.streamSessionLogs('s1', vi.fn(), vi.fn());
    expect(apiClient.stream).toHaveBeenCalled();
  });

  it('should stop log streaming', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    agentService.streamSessionLogs('s1', vi.fn(), vi.fn());
    agentService.stopLogStream();
    expect(abortFn).toHaveBeenCalled();
  });

  it('should handle error when creating session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Server error'));
    await expect(agentService.createSession('t1', 'Test')).rejects.toThrow('Server error');
  });

  it('should not emit agent:started when creation fails', async () => {
    const listener = vi.fn();
    eventBus.on('agent:started', listener);
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Server error'));
    await expect(agentService.createSession('t1', 'Test')).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('should dispose and stop log stream', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    agentService.streamSessionLogs('s1', vi.fn(), vi.fn());
    agentService.dispose();
    expect(abortFn).toHaveBeenCalled();
  });
});
