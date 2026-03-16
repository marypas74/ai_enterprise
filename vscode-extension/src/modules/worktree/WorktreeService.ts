import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { WorktreeInfo, WorktreeMergeResult } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class WorktreeService {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async listWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const worktrees = await this.apiClient.get<WorktreeInfo[]>(
        API_PATHS.ORCHESTRATOR_WORKTREES,
      );
      this.outputChannel.appendLine(`[Worktree] Listed ${worktrees.length} worktrees`);
      return worktrees;
    } catch (error) {
      this.outputChannel.appendLine(`[Worktree] Failed to list worktrees: ${error}`);
      return [];
    }
  }

  async getWorktree(sessionId: string): Promise<WorktreeInfo | null> {
    try {
      const worktree = await this.apiClient.get<WorktreeInfo>(
        `${API_PATHS.AGENT_SESSIONS}/${sessionId}/worktree`,
      );
      return worktree;
    } catch (error) {
      this.outputChannel.appendLine(
        `[Worktree] Failed to get worktree for session ${sessionId}: ${error}`,
      );
      return null;
    }
  }

  async mergeWorktree(sessionId: string): Promise<WorktreeMergeResult> {
    try {
      const result = await this.apiClient.post<WorktreeMergeResult>(
        `${API_PATHS.AGENT_SESSIONS}/${sessionId}/worktree/merge`,
      );
      if (result.success) {
        this.outputChannel.appendLine(
          `[Worktree] Merged branch ${result.mergedBranch} for session ${sessionId}`,
        );
      } else {
        this.outputChannel.appendLine(
          `[Worktree] Merge failed for session ${sessionId}: ${result.error}`,
        );
      }
      return result;
    } catch (error) {
      this.outputChannel.appendLine(`[Worktree] Merge error: ${error}`);
      return {
        success: false,
        mergedBranch: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async discardWorktree(sessionId: string): Promise<void> {
    try {
      await this.apiClient.post(
        `${API_PATHS.AGENT_SESSIONS}/${sessionId}/worktree/discard`,
      );
      this.outputChannel.appendLine(`[Worktree] Discarded worktree for session ${sessionId}`);
    } catch (error) {
      this.outputChannel.appendLine(`[Worktree] Discard error: ${error}`);
      throw error;
    }
  }

  notifyWorktreeReady(sessionId: string, branch: string): void {
    this.eventBus.emit('worktree:ready', { sessionId, branch });
  }

  dispose(): void {
    // nothing to clean up
  }
}
