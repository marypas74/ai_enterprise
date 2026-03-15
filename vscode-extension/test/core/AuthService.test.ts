import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/core/AuthService';
import { ApiClient } from '../../src/core/ApiClient';
import { EventBus } from '../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  Uri: {
    file: (path: string) => ({ scheme: 'file', fsPath: path, path }),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;
  let apiClient: ApiClient;
  let eventBus: EventBus;
  let context: ReturnType<typeof createMockExtensionContext>;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      post: vi.fn(),
      setToken: vi.fn(),
      clearToken: vi.fn(),
      hasToken: vi.fn().mockReturnValue(false),
    } as unknown as ApiClient;
    context = createMockExtensionContext();
    const outputChannel = createMockOutputChannel();
    authService = new AuthService(apiClient, eventBus, context, outputChannel);
  });

  it('should login successfully', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });

    const result = await authService.login('admin@test.com', 'password');
    expect(result).toBe(true);
    expect(apiClient.setToken).toHaveBeenCalledWith('jwt-token');
  });

  it('should emit auth:login on successful login', async () => {
    const listener = vi.fn();
    eventBus.on('auth:login', listener);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });

    await authService.login('admin@test.com', 'password');
    expect(listener).toHaveBeenCalledWith({ userId: '1', email: 'admin@test.com' });
  });

  it('should return false on login failure', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    const result = await authService.login('bad@test.com', 'wrong');
    expect(result).toBe(false);
  });

  it('should logout and emit event', () => {
    const listener = vi.fn();
    eventBus.on('auth:logout', listener);
    authService.logout();
    expect(apiClient.clearToken).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
  });

  it('should restore token from global state', async () => {
    await context.globalState.update('enterprise-ai.token', 'saved-token');
    await context.globalState.update('enterprise-ai.user', JSON.stringify({
      id: 1, email: 'test@test.com', name: 'Test', role: 'user',
    }));
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(true);
    expect(apiClient.setToken).toHaveBeenCalledWith('saved-token');
  });
});
