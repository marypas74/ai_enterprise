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

describe('AuthService — edge cases', () => {
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

  it('should login with TOTP code', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-totp',
      user: { id: 2, email: 'totp@test.com', name: 'TOTP User', role: 'user' },
    });

    const result = await authService.login('totp@test.com', 'password', '123456');
    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/login', {
      email: 'totp@test.com',
      password: 'password',
      totp: '123456',
    });
    expect(apiClient.setToken).toHaveBeenCalledWith('jwt-totp');
  });

  it('should handle network error during login', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await authService.login('user@test.com', 'pass');
    expect(result).toBe(false);
  });

  it('should handle timeout during login', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    const result = await authService.login('user@test.com', 'pass');
    expect(result).toBe(false);
  });

  it('should return false for tryRestoreSession with no token', () => {
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(false);
    expect(apiClient.setToken).not.toHaveBeenCalled();
  });

  it('should return false for tryRestoreSession with corrupt JSON', async () => {
    await context.globalState.update('enterprise-ai.token', 'some-token');
    await context.globalState.update('enterprise-ai.user', 'NOT_VALID_JSON{{{');
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(false);
  });

  it('should return false when token exists but user missing', async () => {
    await context.globalState.update('enterprise-ai.token', 'some-token');
    // No user key set
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(false);
  });

  it('should clear state on auth:logout event', () => {
    // Simulate a login first by emitting auth:logout
    eventBus.emit('auth:logout', undefined);
    expect(apiClient.clearToken).toHaveBeenCalled();
    // isAuthenticated should be false
    expect(authService.isAuthenticated()).toBe(false);
  });

  it('should report isAuthenticated correctly', async () => {
    expect(authService.isAuthenticated()).toBe(false);

    // Simulate successful login
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });
    (apiClient.hasToken as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await authService.login('admin@test.com', 'password');
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('should persist token and user to globalState on login', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'persist-token',
      user: { id: 3, email: 'persist@test.com', name: 'Persist', role: 'user' },
    });

    await authService.login('persist@test.com', 'password');

    expect(context.globalState.get('enterprise-ai.token')).toBe('persist-token');
    expect(context.globalState.get('enterprise-ai.user')).toBe(
      JSON.stringify({ id: 3, email: 'persist@test.com', name: 'Persist', role: 'user' }),
    );
  });
});
