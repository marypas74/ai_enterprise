import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorStatusBar } from '../../../src/modules/orchestrator/OrchestratorStatusBar';
import { OrchestratorService } from '../../../src/modules/orchestrator/OrchestratorService';
import { ConfigService } from '../../../src/core/ConfigService';
import { EventBus } from '../../../src/core/EventBus';

const mockStatusBarItem = {
  text: '',
  tooltip: '',
  command: '',
  color: undefined as string | undefined,
  alignment: 1,
  priority: 50,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
  ThemeColor: class ThemeColor { id: string; constructor(id: string) { this.id = id; } },
}));

describe('OrchestratorStatusBar', () => {
  let statusBar: OrchestratorStatusBar;
  let orchestratorService: OrchestratorService;
  let configService: ConfigService;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';
    mockStatusBarItem.color = undefined;
    eventBus = new EventBus();
    orchestratorService = {
      getStatus: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      startEventStream: vi.fn(),
      stopEventStream: vi.fn(),
      dispose: vi.fn(),
    } as unknown as OrchestratorService;
    configService = {
      getOrchestratorShowStatusBar: vi.fn().mockReturnValue(true),
      getOrchestratorPollingInterval: vi.fn().mockReturnValue(10000),
    } as unknown as ConfigService;
    statusBar = new OrchestratorStatusBar(orchestratorService, configService, eventBus);
  });

  afterEach(() => {
    statusBar.dispose();
  });

  it('should set statusBarItem command to enterprise-ai.openOrchestrator', () => {
    expect(mockStatusBarItem.command).toBe('enterprise-ai.openOrchestrator');
  });

  it('should show status bar and start polling on auth:login', () => {
    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(mockStatusBarItem.show).toHaveBeenCalled();
    expect(orchestratorService.startPolling).toHaveBeenCalled();
  });

  it('should hide status bar and stop polling on auth:logout', () => {
    eventBus.emit('auth:logout', undefined as never);
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
    expect(orchestratorService.stopPolling).toHaveBeenCalled();
  });

  it('should update text on orchestrator:update', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 3, totalSlots: 5 });
    expect(mockStatusBarItem.text).toBe('$(pulse) 3/5 slots');
  });

  it('should use default color when usage is below 50%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 2, totalSlots: 5 });
    expect(mockStatusBarItem.color).toBeUndefined();
  });

  it('should use warning color when usage is between 50% and 80%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 3, totalSlots: 5 });
    expect(mockStatusBarItem.color).toEqual({ id: 'statusBarItem.warningBackground' });
  });

  it('should use error color when usage is above 80%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 5, totalSlots: 5 });
    expect(mockStatusBarItem.color).toEqual({ id: 'statusBarItem.errorBackground' });
  });

  it('should stop polling when panel is opened', () => {
    statusBar.onPanelOpened();
    expect(orchestratorService.stopPolling).toHaveBeenCalled();
  });

  it('should resume polling when panel is closed', () => {
    statusBar.onPanelClosed();
    expect(orchestratorService.startPolling).toHaveBeenCalled();
  });
});
