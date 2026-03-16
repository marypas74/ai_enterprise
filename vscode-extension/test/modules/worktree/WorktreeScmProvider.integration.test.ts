import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorktreeScmProvider } from '../../../src/modules/worktree/WorktreeScmProvider';
import type { WorktreeService } from '../../../src/modules/worktree/WorktreeService';
import type { WorktreeInfo } from '../../../src/core/types';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

const mockCreateSourceControl = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockExecuteCommand = vi.fn();
const mockGroupDispose = vi.fn();

vi.mock('vscode', () => {
  const createMockResourceGroup = () => ({
    resourceStates: [] as unknown[],
    dispose: mockGroupDispose,
    label: '',
    id: '',
    hideWhenEmpty: false,
  });
  const mockScm = {
    inputBox: { placeholder: '' },
    createResourceGroup: vi.fn((_id: string, _label: string) => createMockResourceGroup()),
    dispose: vi.fn(),
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

const sampleWorktree: WorktreeInfo = {
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
};

const sampleWorktreeWithConflicts: WorktreeInfo = {
  id: 'wt-2',
  sessionId: 'session-2',
  path: '/tmp/wt-2',
  branch: 'agent/feat-2',
  targetBranch: 'main',
  modifiedFiles: [{ path: 'src/app.ts', status: 'modified' }],
  conflicts: [{ path: 'src/conflict.ts', status: 'conflicted' }],
  status: 'active',
  createdAt: '2026-03-15T11:00:00Z',
};

describe('WorktreeScmProvider integration', () => {
  let scmProvider: WorktreeScmProvider;
  let worktreeService: WorktreeService;
  let eventBus: EventBus;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    worktreeService = {
      listWorktrees: vi.fn().mockResolvedValue([]),
      getWorktree: vi.fn(),
      mergeWorktree: vi.fn().mockResolvedValue({ success: true }),
      discardWorktree: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorktreeService;
    outputChannel = createMockOutputChannel();
    scmProvider = new WorktreeScmProvider(worktreeService, eventBus, outputChannel);
  });

  afterEach(() => {
    scmProvider.dispose();
  });

  it('should register SCM provider on construction', () => {
    expect(mockCreateSourceControl).toHaveBeenCalledWith(
      'enterprise-ai-worktrees',
      'Enterprise AI Worktrees',
    );
  });

  it('should refresh worktrees on worktree:ready event', () => {
    const refreshSpy = vi.spyOn(scmProvider, 'refresh');

    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('should update resource groups when worktrees loaded', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([
      sampleWorktree,
      sampleWorktreeWithConflicts,
    ]);

    await scmProvider.refresh();

    const worktrees = scmProvider.getWorktrees();
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].branch).toBe('agent/feat-1');
    expect(worktrees[0].modifiedFiles).toHaveLength(2);
    expect(worktrees[1].branch).toBe('agent/feat-2');
    expect(worktrees[1].conflicts).toHaveLength(1);
  });

  it('should dispose old resource groups on refresh', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([sampleWorktree]);
    await scmProvider.refresh();

    // Second refresh should dispose old groups
    mockGroupDispose.mockClear();
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([sampleWorktreeWithConflicts]);
    await scmProvider.refresh();

    expect(mockGroupDispose).toHaveBeenCalled();
    const worktrees = scmProvider.getWorktrees();
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].branch).toBe('agent/feat-2');
  });

  it('should dispose SCM provider and clear resource groups', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([sampleWorktree]);
    await scmProvider.refresh();

    scmProvider.dispose();

    expect(scmProvider.getWorktrees()).toHaveLength(0);
  });

  it('should show notification with Merge/Review/Dismiss on worktree:ready', () => {
    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });

    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Worktree ready: agent/feat-1',
      'Merge',
      'Review',
      'Dismiss',
    );
  });

  it('should trigger merge when user selects Merge from notification', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([sampleWorktree]);
    await scmProvider.refresh();

    mockShowInformationMessage.mockResolvedValue('Merge');
    mockShowWarningMessage.mockResolvedValue('Merge');

    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });

    // Let async notification handling settle
    await vi.waitFor(() => {
      expect(worktreeService.mergeWorktree).toHaveBeenCalledWith('session-1');
    });
  });

  it('should open SCM view when user selects Review from notification', async () => {
    mockShowInformationMessage.mockResolvedValue('Review');

    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });

    await vi.waitFor(() => {
      expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.view.scm');
    });
  });

  it('should handle refresh failure gracefully', async () => {
    const appendLineSpy = vi.spyOn(outputChannel, 'appendLine');
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    await scmProvider.refresh();

    expect(appendLineSpy).toHaveBeenCalledWith(
      expect.stringContaining('Refresh failed'),
    );
  });
});
