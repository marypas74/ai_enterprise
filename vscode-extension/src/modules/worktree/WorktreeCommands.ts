import * as vscode from 'vscode';
import type { WorktreeScmProvider } from './WorktreeScmProvider';
import type { WorktreeInfo } from '../../core/types';

interface WorktreeQuickPickItem extends vscode.QuickPickItem {
  worktree: WorktreeInfo;
}

export function registerWorktreeCommands(
  getScmProvider: () => WorktreeScmProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.manageWorktrees', async () => {
      const provider = getScmProvider();
      await provider.refresh();
      const worktrees = provider.getWorktrees();

      if (worktrees.length === 0) {
        vscode.window.showInformationMessage('No active worktrees');
        return;
      }

      const items: WorktreeQuickPickItem[] = worktrees.map((wt) => ({
        label: wt.branch,
        description: `${wt.status} — ${wt.modifiedFiles.length} file(s)`,
        detail: wt.agentName
          ? `Agent: ${wt.agentName} | Target: ${wt.targetBranch}`
          : `Target: ${wt.targetBranch}`,
        worktree: wt,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a worktree to manage',
        title: 'Enterprise AI Worktrees',
      });

      if (!selected) { return; }

      const action = await vscode.window.showQuickPick(
        [
          { label: 'Merge', description: `Merge into ${selected.worktree.targetBranch}` },
          { label: 'Review', description: 'Open in Source Control view' },
          { label: 'Discard', description: 'Delete worktree (cannot be undone)' },
        ],
        {
          placeHolder: `Action for ${selected.worktree.branch}`,
        },
      );

      if (!action) { return; }

      switch (action.label) {
        case 'Merge':
          await provider.mergeWorktree(selected.worktree.sessionId);
          break;
        case 'Review':
          await vscode.commands.executeCommand('workbench.view.scm');
          break;
        case 'Discard':
          await provider.discardWorktree(selected.worktree.sessionId);
          break;
      }
    }),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.merge',
      async (sessionId: string) => {
        await getScmProvider().mergeWorktree(sessionId);
      },
    ),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.discard',
      async (sessionId: string) => {
        await getScmProvider().discardWorktree(sessionId);
      },
    ),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.openDiff',
      async (leftUri: vscode.Uri, rightUri: vscode.Uri, title: string) => {
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
      },
    ),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.resolveConflict',
      async (fileUri: vscode.Uri) => {
        await vscode.commands.executeCommand('merge-conflict.accept.both', fileUri);
      },
    ),
  ];
}
