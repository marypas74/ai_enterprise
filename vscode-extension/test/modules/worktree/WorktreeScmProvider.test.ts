import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorktreeScmProvider } from '../../../src/modules/worktree/WorktreeScmProvider';
import type { WorktreeService } from '../../../src/modules/worktree/WorktreeService';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

const mockCreateSourceControl = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockExecuteCommand = vi.fn();

vi.mock('vscode', () => {
  const createMockResourceGroup = () => ({
    resourceStates: [] as unknown[],
    dispose: () => {},
    label: '',
    id: '',
    hideWhenEmpty: false,
  });
  const mockScm = {
    inputBox: { placeholder: '' },
    createResourceGroup: (_id: string, _label: string) => createMockResourceGroup(),
    dispose: () => {},
    statusBarCommands: undefined,
    count: 0,
  };
  return {
    scm: {
      createSourceControl: (...args: unknown[]) => {
        mockCreateSourceControl(...args);
        return mockScm;
      },
    },
    commands: {
      executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
    },
    window: {
      showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
      showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
      showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
    },
    Uri: {
      file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p })),
      parse: vi.fn((s: string) => ({ fsPath: s, scheme: 'file', path: s })),
      from: vi.fn((components: Record<string, string>) => ({
        fsPath: components.path,
        scheme: components.scheme,
        path: components.path,
        query: components.query,
      })),
    },
    ThemeIcon: function ThemeIcon(this: { id: string }, id: string) { this.id = id; },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((_k: string, d: unknown) => d),
      }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    },
  };
});

describe('WorktreeScmProvider', () => {
  let scmProvider: WorktreeScmProvider;
  let worktreeService: WorktreeService;
  let eventBus: EventBus;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateSourceControl.mockClear();
    mockShowInformationMessage.mockClear();
    mockShowWarningMessage.mockClear();
    mockShowErrorMessage.mockClear();
    mockExecuteCommand.mockClear();
    eventBus = new EventBus();
    worktreeService = {
      listWorktrees: vi.fn().mockResolvedValue([]),
      getWorktree: vi.fn(),
      mergeWorktree: vi.fn(),
      discardWorktree: vi.fn(),
    } as unknown as WorktreeService;
    outputChannel = createMockOutputChannel();
    scmProvider = new WorktreeScmProvider(worktreeService, eventBus, outputChannel);
  });

  afterEach(() => {
    scmProvider.dispose();
    vi.useRealTimers();
  });

  it('should create a VS Code SourceControl instance', () => {
    expect(mockCreateSourceControl).toHaveBeenCalledWith(
      'enterprise-ai-worktrees',
      'Enterprise AI Worktrees',
    );
  });

  it('should poll for worktrees on interval', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'wt-1',
        sessionId: 'session-1',
        path: '/tmp/wt-1',
        branch: 'agent/feat-1',
        targetBranch: 'main',
        modifiedFiles: [{ path: 'src/index.ts', status: 'modified' }],
        conflicts: [],
        status: 'ready',
        agentName: 'Agent 1',
        createdAt: '2026-03-15T10:00:00Z',
      },
    ]);

    await scmProvider.refresh();
    expect(worktreeService.listWorktrees).toHaveBeenCalledTimes(1);
  });

  it('should create resource groups for each worktree', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'wt-1',
        sessionId: 'session-1',
        path: '/tmp/wt-1',
        branch: 'agent/feat-1',
        targetBranch: 'main',
        modifiedFiles: [
          { path: 'src/index.ts', status: 'modified' },
          { path: 'src/new.ts', status: 'added' },
        ],
        conflicts: [],
        status: 'ready',
        agentName: 'Agent 1',
        createdAt: '2026-03-15T10:00:00Z',
      },
    ]);

    await scmProvider.refresh();
    const worktrees = scmProvider.getWorktrees();
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].branch).toBe('agent/feat-1');
    expect(worktrees[0].modifiedFiles).toHaveLength(2);
  });

  it('should react to worktree:ready event', () => {
    const refreshSpy = vi.spyOn(scmProvider, 'refresh');
    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });

    expect(refreshSpy).toHaveBeenCalled();
  });

  it('should show notification on worktree:ready event', () => {
    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('agent/feat-1'),
      'Merge',
      'Review',
      'Dismiss',
    );
  });

  it('should start polling and call listWorktrees on interval', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    scmProvider.startPolling(15000);
    // Advance one interval
    vi.advanceTimersByTime(15000);
    // Let the async refresh settle
    await Promise.resolve();

    expect(worktreeService.listWorktrees).toHaveBeenCalled();
  });

  it('should dispose timer and SCM on dispose', () => {
    scmProvider.startPolling(15000);
    scmProvider.dispose();
    // Should not throw, timers cleared
  });
});
