import * as vscode from 'vscode';
import type { ModuleContext } from '../../core/types';
import { AgentService } from './AgentService';
import type { AgentPanel } from './AgentPanel';

export function registerAgentCommands(
  context: ModuleContext,
  agentService: AgentService,
  getPanel: () => AgentPanel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.newAgentSession', async () => {
      if (!context.authService.isAuthenticated()) {
        vscode.window.showWarningMessage('Login required to create agent sessions.');
        return;
      }
      try {
        const templates = await agentService.getTemplates();
        if (templates.length === 0) {
          vscode.window.showInformationMessage('No agent templates available.');
          return;
        }
        const items = templates.map((t) => ({
          label: t.name,
          description: t.category,
          detail: t.description,
          templateId: t.id,
        }));
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select an agent template',
          matchOnDescription: true,
          matchOnDetail: true,
        });
        if (!selected) {
          return;
        }
        const prompt = await vscode.window.showInputBox({
          prompt: 'Enter the task prompt for the agent',
          placeHolder: 'e.g., Review the authentication module for security issues',
        });
        if (!prompt) {
          return;
        }
        const session = await agentService.createSession(selected.templateId, prompt);
        vscode.window.showInformationMessage(`Agent session started: ${session.id}`);
        const panel = getPanel();
        panel.show();
        panel.selectSession(session.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to create agent session: ${message}`);
      }
    }),
    vscode.commands.registerCommand('enterprise-ai.viewAgentSessions', () => {
      if (!context.authService.isAuthenticated()) {
        vscode.window.showWarningMessage('Login required to view agent sessions.');
        return;
      }
      getPanel().show();
    }),
  ];
}
