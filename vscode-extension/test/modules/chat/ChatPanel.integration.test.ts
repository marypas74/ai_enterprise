import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatPanel } from '../../../src/modules/chat/ChatPanel';
import { EventBus } from '../../../src/core/EventBus';
import type { ModuleContext } from '../../../src/core/types';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';

const mockPostMessage = vi.fn();
const mockReveal = vi.fn();
const mockOnDidReceiveMessage = vi.fn();
const mockOnDidDispose = vi.fn();

const mockCreateWebviewPanel = vi.fn(() => ({
  webview: {
    html: '',
    onDidReceiveMessage: mockOnDidReceiveMessage,
    postMessage: mockPostMessage,
    asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
    cspSource: 'https://test.csp',
  },
  reveal: mockReveal,
  onDidDispose: mockOnDidDispose,
  dispose: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: (...args: unknown[]) => mockCreateWebviewPanel(...args),
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p })),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      scheme: 'file',
      path: [base.fsPath, ...segments].join('/'),
    }),
  },
  ViewColumn: { Beside: -2 },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('ChatPanel integration', () => {
  let chatPanel: ChatPanel;
  let eventBus: EventBus;
  let authService: ModuleContext['authService'];
  let apiClient: ModuleContext['apiClient'];
  let context: ModuleContext;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();

    authService = {
      login: vi.fn().mockResolvedValue(true),
      logout: vi.fn(),
      getUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'user' }),
      isAuthenticated: vi.fn().mockReturnValue(true),
      tryRestoreSession: vi.fn().mockReturnValue(false),
    } as unknown as ModuleContext['authService'];

    apiClient = {
      get: vi.fn().mockResolvedValue([{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }]),
      post: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ModuleContext['apiClient'];

    context = {
      extensionContext: createMockExtensionContext(),
      apiClient,
      authService,
      configService: {} as ModuleContext['configService'],
      eventBus,
      outputChannel: createMockOutputChannel(),
    };

    chatPanel = new ChatPanel(context);
  });

  it('should create webview panel on show()', () => {
    chatPanel.show();

    expect(mockCreateWebviewPanel).toHaveBeenCalledWith(
      'enterprise-ai.chat',
      'Enterprise AI Chat',
      -2,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );
  });

  it('should reveal existing panel on second show()', () => {
    chatPanel.show();
    chatPanel.show();

    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1);
    expect(mockReveal).toHaveBeenCalledTimes(1);
  });

  it('should send setAuthenticated when auth:login fires', async () => {
    chatPanel.show();
    mockPostMessage.mockClear();

    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });

    // Wait for async operations (loadModels)
    await vi.waitFor(() => {
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'setAuthenticated',
          payload: expect.objectContaining({
            user: expect.objectContaining({ email: 'test@test.com' }),
            models: expect.any(Array),
          }),
        }),
      );
    });
  });

  it('should send setUnauthenticated when auth:logout fires', () => {
    chatPanel.show();
    mockPostMessage.mockClear();

    eventBus.emit('auth:logout', undefined as never);

    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'setUnauthenticated' });
  });

  it('should route sendMessage to ChatService streaming', () => {
    chatPanel.show();

    // Get the message handler registered via onDidReceiveMessage
    const messageHandler = mockOnDidReceiveMessage.mock.calls[0][0];

    messageHandler({
      type: 'sendMessage',
      payload: { message: 'Hello', modelId: 'gpt-4o' },
    });

    expect(apiClient.stream).toHaveBeenCalled();
  });
});
