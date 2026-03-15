import * as vscode from 'vscode';
import type { ModuleContext } from '../../core/types';
import type { ChatPanel } from './ChatPanel';

export function registerChatCommands(
  context: ModuleContext,
  getPanel: () => ChatPanel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.openChat', () => {
      getPanel().show();
    }),

    vscode.commands.registerCommand('enterprise-ai.newChat', () => {
      getPanel().postMessage({ type: 'newChat' } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.abortRequest', () => {
      getPanel().postMessage({ type: 'abortRequest' } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.addToChat', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      if (!selection) { return; }
      const fileName = editor.document.fileName;
      const panel = getPanel();
      panel.show();
      panel.postMessage({
        type: 'addContext',
        payload: { text: selection, fileName },
      } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.addFileToContext', (uri: vscode.Uri) => {
      if (!uri) { return; }
      const panel = getPanel();
      panel.show();
      panel.postMessage({
        type: 'addFileContext',
        payload: { filePath: uri.fsPath },
      } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.chatWithContext', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      const fileName = editor.document.fileName;
      const panel = getPanel();
      panel.show();
      panel.postMessage({
        type: 'addContext',
        payload: { text: selection || editor.document.getText(), fileName },
      } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.login', async () => {
      const email = await vscode.window.showInputBox({ prompt: 'Email', placeHolder: 'admin@enterprise.local' });
      if (!email) { return; }
      const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
      if (!password) { return; }
      const totp = await vscode.window.showInputBox({ prompt: 'TOTP code (leave empty if not enabled)', placeHolder: '000000' });
      await context.authService.login(email, password, totp || undefined);
    }),

    vscode.commands.registerCommand('enterprise-ai.logout', () => {
      context.authService.logout();
      vscode.window.showInformationMessage('Logged out from Enterprise AI');
    }),

    vscode.commands.registerCommand('enterprise-ai.configure', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai');
    }),

    vscode.commands.registerCommand('enterprise-ai.showLogs', () => {
      context.outputChannel.show();
    }),
  ];
}
