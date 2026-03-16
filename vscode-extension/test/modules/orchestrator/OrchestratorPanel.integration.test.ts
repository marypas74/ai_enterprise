import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorPanel } from '../../../src/modules/orchestrator/OrchestratorPanel';
import { EventBus } from '../../../src/core/EventBus';
import type { ModuleContext, OrchestratorStatus } from '../../../src/core/types';
import type { OrchestratorService } from '../../../src/modules/orchestrator/OrchestratorService';
import type { OrchestratorStatusBar } from '../../../src/modules/orchestrator/OrchestratorStatusBar';
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

describe('OrchestratorPanel integration', () => {
  let orchestratorPanel: OrchestratorPanel;
  let eventBus: EventBus;
  let orchestratorService: OrchestratorService;
  let statusBar: OrchestratorStatusBar;
  let context: ModuleContext;

  const mockStatus: OrchestratorStatus = {
    activeSlots: 2,
    totalSlots: 5,
    slots: [
      { id: 1, busy: true, sessionId: 's1', agentName: 'Agent 1' },
      { id: 2, busy: true, sessionId: 's2', agentName: 'Agent 2' },
      { id: 3, busy: false },
      { id: 4, busy: false },
      { id: 5, busy: false },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();

    orchestratorService = {
      getStatus: vi.fn().mockResolvedValue(mockStatus),
      startEventStream: vi.fn(),
      stopEventStream: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      releaseSlot: vi.fn(),
      terminateSession: vi.fn(),
      dispose: vi.fn(),
    } as unknown as OrchestratorService;

    statusBar = {
      onPanelOpened: vi.fn(),
      onPanelClosed: vi.fn(),
      dispose: vi.fn(),
    } as unknown as OrchestratorStatusBar;

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

    orchestratorPanel = new OrchestratorPanel(context, orchestratorService, statusBar);
  });

  it('should create panel on show()', () => {
    orchestratorPanel.show();

    expect(mockCreateWebviewPanel).toHaveBeenCalledWith(
      'enterprise-ai.orchestrator',
      'Enterprise AI Orchestrator',
      -2,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );
    expect(statusBar.onPanelOpened).toHaveBeenCalled();
  });

  it('should start SSE stream when panel opens via ready message', async () => {
    orchestratorPanel.show();

    // Simulate webview sending 'ready' message
    const messageHandler = mockOnDidReceiveMessage.mock.calls[0][0];
    await messageHandler({ type: 'ready' });

    expect(orchestratorService.startEventStream).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('should fetch initial status on show() via ready message', async () => {
    orchestratorPanel.show();

    const messageHandler = mockOnDidReceiveMessage.mock.calls[0][0];
    await messageHandler({ type: 'ready' });

    expect(orchestratorService.getStatus).toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setStatus',
        payload: mockStatus,
      }),
    );
  });

  it('should update on orchestrator:update event (via auth events)', () => {
    orchestratorPanel.show();
    mockPostMessage.mockClear();

    // OrchestratorPanel listens to auth:login to send setAuthenticated
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
});
