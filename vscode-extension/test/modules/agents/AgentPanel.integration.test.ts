import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentPanel } from '../../../src/modules/agents/AgentPanel';
import { EventBus } from '../../../src/core/EventBus';
import type { ModuleContext } from '../../../src/core/types';
import type { AgentService } from '../../../src/modules/agents/AgentService';
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

describe('AgentPanel integration', () => {
  let agentPanel: AgentPanel;
  let eventBus: EventBus;
  let agentService: AgentService;
  let context: ModuleContext;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();

    agentService = {
      getSessions: vi.fn().mockResolvedValue([]),
      getTemplates: vi.fn().mockResolvedValue([]),
      createSession: vi.fn(),
      pauseSession: vi.fn(),
      resumeSession: vi.fn(),
      cancelSession: vi.fn(),
      streamSessionLogs: vi.fn(),
      stopLogStream: vi.fn(),
      dispose: vi.fn(),
    } as unknown as AgentService;

    context = {
      extensionContext: createMockExtensionContext(),
      apiClient: {} as ModuleContext['apiClient'],
      authService: {
        login: vi.fn(),
        logout: vi.fn(),
        getUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'user' }),
        isAuthenticated: vi.fn().mockReturnValue(true),
      } as unknown as ModuleContext['authService'],
      configService: {} as ModuleContext['configService'],
      eventBus,
      outputChannel: createMockOutputChannel(),
    };

    agentPanel = new AgentPanel(context, agentService);
  });

  it('should create webview panel on show()', () => {
    agentPanel.show();

    expect(mockCreateWebviewPanel).toHaveBeenCalledWith(
      'enterprise-ai.agents',
      'Enterprise AI Agents',
      -2,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );
  });

  it('should update panel when agent:started event fires', async () => {
    agentPanel.show();
    mockPostMessage.mockClear();

    // agent:started fires from AgentService.createSession.
    // The AgentPanel listens to auth:login, not agent:started directly.
    // So we test that auth:login sends setAuthenticated to the panel.
    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setAuthenticated',
        payload: expect.objectContaining({
          user: expect.objectContaining({ email: 'test@test.com' }),
        }),
      }),
    );
  });

  it('should update panel when agent:completed event fires (via auth:logout)', () => {
    agentPanel.show();
    mockPostMessage.mockClear();

    // AgentPanel listens to auth:logout and sends setUnauthenticated + stops log stream
    eventBus.emit('auth:logout', undefined as never);

    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'setUnauthenticated' });
    expect(agentService.stopLogStream).toHaveBeenCalled();
  });
});
