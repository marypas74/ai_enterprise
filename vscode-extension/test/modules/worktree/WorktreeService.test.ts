import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeService } from '../../../src/modules/worktree/WorktreeService';
import type { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}));

describe('WorktreeService', () => {
  let worktreeService: WorktreeService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    worktreeService = new WorktreeService(apiClient, eventBus, outputChannel);
  });

  it('should fetch all active worktrees', async () => {
    const worktrees = [
      {
        id: 'wt-1',
        sessionId: 'session-1',
        path: '/tmp/worktree-1',
        branch: 'agent/feature-1',
        targetBranch: 'main',
        modifiedFiles: [{ path: 'src/index.ts', status: 'modified' }],
        conflicts: [],
        status: 'ready',
        agentName: 'Code Agent',
        createdAt: '2026-03-15T10:00:00Z',
      },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(worktrees);

    const result = await worktreeService.listWorktrees();
    expect(result).toEqual(worktrees);
    expect(apiClient.get).toHaveBeenCalledWith('/api/orchestrator/worktrees');
  });

  it('should fetch worktree for specific session', async () => {
    const worktree = {
      id: 'wt-1',
      sessionId: 'session-1',
      path: '/tmp/worktree-1',
      branch: 'agent/feature-1',
      targetBranch: 'main',
      modifiedFiles: [],
      conflicts: [],
      status: 'active',
      createdAt: '2026-03-15T10:00:00Z',
    };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(worktree);

    const result = await worktreeService.getWorktree('session-1');
    expect(result).toEqual(worktree);
    expect(apiClient.get).toHaveBeenCalledWith('/api/agents/sessions/session-1/worktree');
  });

  it('should merge worktree', async () => {
    const mergeResult = { success: true, mergedBranch: 'agent/feature-1' };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mergeResult);

    const result = await worktreeService.mergeWorktree('session-1');
    expect(result).toEqual(mergeResult);
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/session-1/worktree/merge');
  });

  it('should discard worktree', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await worktreeService.discardWorktree('session-1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/session-1/worktree/discard');
  });

  it('should emit worktree:ready event on EventBus when worktree becomes ready', async () => {
    const listener = vi.fn();
    eventBus.on('worktree:ready', listener);

    worktreeService.notifyWorktreeReady('session-1', 'agent/feature-1');
    expect(listener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      branch: 'agent/feature-1',
    });
  });

  it('should handle merge failure gracefully', async () => {
    const mergeResult = {
      success: false,
      mergedBranch: 'agent/feature-1',
      conflicts: ['src/index.ts', 'src/utils.ts'],
      error: 'Merge conflicts detected',
    };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mergeResult);

    const result = await worktreeService.mergeWorktree('session-1');
    expect(result.success).toBe(false);
    expect(result.conflicts).toHaveLength(2);
  });

  it('should handle API errors on list', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await worktreeService.listWorktrees();
    expect(result).toEqual([]);
  });

  it('should return null when getWorktree encounters a network error', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await worktreeService.getWorktree('session-1');
    expect(result).toBeNull();
  });

  it('should return fallback merge result on network error during merge', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));

    const result = await worktreeService.mergeWorktree('session-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
    expect(result.mergedBranch).toBe('');
  });

  it('should throw error when discardWorktree fails', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not found'));

    await expect(worktreeService.discardWorktree('session-1')).rejects.toThrow('Not found');
  });
});
