import * as vscode from 'vscode';
import type { EventBus } from '../../core/EventBus';
import type { WorktreeInfo, WorktreeFile } from '../../core/types';
import type { WorktreeService } from './WorktreeService';
import { WORKTREE_SCM_ID, WORKTREE_SCM_LABEL } from '../../utils/constants';

interface WorktreeResourceGroup {
  group: vscode.SourceControlResourceGroup;
  worktree: WorktreeInfo;
}

export class WorktreeScmProvider {
  private readonly scm: vscode.SourceControl;
  private resourceGroups: WorktreeResourceGroup[] = [];
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly worktreeService: WorktreeService,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.scm = vscode.scm.createSourceControl(WORKTREE_SCM_ID, WORKTREE_SCM_LABEL);
    this.scm.inputBox.placeholder = 'Enterprise AI Worktrees';

    // Listen for worktree:ready events
    this.disposables.push(
      this.eventBus.on('worktree:ready', (data) => {
        this.handleWorktreeReady(data.sessionId, data.branch);
      }),
    );
  }

  async refresh(): Promise<void> {
    try {
      const worktrees = await this.worktreeService.listWorktrees();
      this.updateResourceGroups(worktrees);
      this.scm.count = worktrees.length;
    } catch (error) {
      this.outputChannel.appendLine(`[WorktreeSCM] Refresh failed: ${error}`);
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.pollingTimer = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private updateResourceGroups(worktrees: WorktreeInfo[]): void {
    // Dispose old resource groups
    for (const { group } of this.resourceGroups) {
      group.dispose();
    }
    this.resourceGroups = [];

    // Create new resource groups
    for (const worktree of worktrees) {
      const label = worktree.agentName
        ? `${worktree.branch} (${worktree.agentName})`
        : worktree.branch;
      const group = this.scm.createResourceGroup(worktree.id, label);
      group.hideWhenEmpty = false;

      const allFiles = [
        ...worktree.modifiedFiles,
        ...worktree.conflicts,
      ];

      group.resourceStates = allFiles.map((file) =>
        this.createResourceState(worktree, file),
      );

      this.resourceGroups.push({ group, worktree });
    }
  }

  private createResourceState(
    worktree: WorktreeInfo,
    file: WorktreeFile,
  ): vscode.SourceControlResourceState {
    const resourceUri = vscode.Uri.file(`${worktree.path}/${file.path}`);

    const decorations = this.getDecorations(file.status);

    // For the left side of the diff, use a custom URI scheme that our
    // TextDocumentContentProvider resolves via `git show <branch>:<path>`.
    const leftUri = vscode.Uri.from({
      scheme: 'enterprise-ai-worktree',
      path: file.path,
      query: JSON.stringify({
        worktreePath: worktree.path,
        branch: worktree.targetBranch,
      }),
    });

    const state: vscode.SourceControlResourceState = {
      resourceUri,
      decorations,
      command: {
        title: 'Open Diff',
        command: 'vscode.diff',
        arguments: [
          leftUri,
          resourceUri,
          `${file.path} (${worktree.targetBranch} vs ${worktree.branch})`,
        ],
      },
    };

    return state;
  }

  private getDecorations(
    status: WorktreeFile['status'],
  ): vscode.SourceControlResourceDecorations {
    switch (status) {
      case 'added':
        return {
          iconPath: new vscode.ThemeIcon('diff-added'),
          tooltip: 'Added',
          faded: false,
          strikeThrough: false,
        } as vscode.SourceControlResourceDecorations;
      case 'modified':
        return {
          iconPath: new vscode.ThemeIcon('diff-modified'),
          tooltip: 'Modified',
          faded: false,
          strikeThrough: false,
        } as vscode.SourceControlResourceDecorations;
      case 'deleted':
        return {
          iconPath: new vscode.ThemeIcon('diff-removed'),
          tooltip: 'Deleted',
          faded: false,
          strikeThrough: true,
        } as vscode.SourceControlResourceDecorations;
      case 'conflicted':
        return {
          iconPath: new vscode.ThemeIcon('warning'),
          tooltip: 'Conflict',
          faded: false,
          strikeThrough: false,
        } as vscode.SourceControlResourceDecorations;
      default:
        return {};
    }
  }

  private handleWorktreeReady(sessionId: string, branch: string): void {
    this.refresh();
    this.showWorktreeReadyNotification(sessionId, branch);
  }

  private async showWorktreeReadyNotification(
    sessionId: string,
    branch: string,
  ): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `Worktree ready: ${branch}`,
      'Merge',
      'Review',
      'Dismiss',
    );

    switch (action) {
      case 'Merge':
        await this.mergeWorktree(sessionId);
        break;
      case 'Review':
        // Focus on SCM view to review changes
        await vscode.commands.executeCommand('workbench.view.scm');
        break;
      case 'Dismiss':
      default:
        break;
    }
  }

  async mergeWorktree(sessionId: string): Promise<void> {
    const worktree = this.resourceGroups.find(
      (rg) => rg.worktree.sessionId === sessionId,
    )?.worktree;

    if (!worktree) {
      vscode.window.showWarningMessage(`Worktree for session ${sessionId} not found`);
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Merge branch "${worktree.branch}" into "${worktree.targetBranch}"?`,
      { modal: true },
      'Merge',
    );

    if (confirm !== 'Merge') { return; }

    const result = await this.worktreeService.mergeWorktree(sessionId);

    if (result.success) {
      vscode.window.showInformationMessage(
        `Successfully merged ${worktree.branch} into ${worktree.targetBranch}`,
      );
      await this.refresh();
    } else if (result.conflicts && result.conflicts.length > 0) {
      const openConflicts = await vscode.window.showWarningMessage(
        `Merge conflicts in ${result.conflicts.length} file(s). Resolve manually.`,
        'Open Conflicts',
      );
      if (openConflicts === 'Open Conflicts') {
        for (const conflictPath of result.conflicts) {
          const uri = vscode.Uri.file(`${worktree.path}/${conflictPath}`);
          await vscode.commands.executeCommand('merge-conflict.accept.both', uri);
        }
      }
    } else {
      vscode.window.showErrorMessage(
        `Merge failed: ${result.error ?? 'Unknown error'}`,
      );
    }
  }

  async discardWorktree(sessionId: string): Promise<void> {
    const worktree = this.resourceGroups.find(
      (rg) => rg.worktree.sessionId === sessionId,
    )?.worktree;

    if (!worktree) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Discard worktree "${worktree.branch}"? This cannot be undone.`,
      { modal: true },
      'Discard',
    );

    if (confirm !== 'Discard') { return; }

    try {
      await this.worktreeService.discardWorktree(sessionId);
      vscode.window.showInformationMessage(`Worktree ${worktree.branch} discarded`);
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to discard worktree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getWorktrees(): WorktreeInfo[] {
    return this.resourceGroups.map((rg) => rg.worktree);
  }

  dispose(): void {
    this.stopPolling();
    for (const { group } of this.resourceGroups) {
      group.dispose();
    }
    this.resourceGroups = [];
    this.scm.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * TextDocumentContentProvider for the 'enterprise-ai-worktree' scheme.
 * Resolves file content from a target branch using `git show`.
 * Register in extension.ts:
 *   vscode.workspace.registerTextDocumentContentProvider(
 *     'enterprise-ai-worktree',
 *     new WorktreeContentProvider(),
 *   )
 */
export class WorktreeContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { worktreePath, branch } = JSON.parse(uri.query) as {
      worktreePath: string;
      branch: string;
    };
    const filePath = uri.path;

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(
        `git show ${branch}:${filePath}`,
        { cwd: worktreePath },
      );
      return stdout;
    } catch {
      return '';
    }
  }
}
