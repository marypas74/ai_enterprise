import * as vscode from 'vscode';
import type { ChatPanel } from '../chat/ChatPanel';

export function registerCodeActionCommands(
  getPanel: () => ChatPanel,
): vscode.Disposable[] {
  const codeActionCommands = [
    { id: 'enterprise-ai.explainCode', prompt: 'Explain the following code:\n\n' },
    { id: 'enterprise-ai.fixCode', prompt: 'Fix any issues in the following code:\n\n' },
    { id: 'enterprise-ai.improveCode', prompt: 'Improve the following code:\n\n' },
    { id: 'enterprise-ai.generateTests', prompt: 'Generate tests for the following code:\n\n' },
  ];

  return codeActionCommands.map(({ id, prompt }) =>
    vscode.commands.registerCommand(id, () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('Select code first');
        return;
      }
      const lang = editor.document.languageId;
      const fileName = editor.document.fileName;
      const panel = getPanel();
      panel.show();
      panel.postMessage({
        type: 'prefillMessage',
        payload: { text: `${prompt}\`\`\`${lang}\n${selection}\n\`\`\`\n\nFile: ${fileName}` },
      } as never);
    }),
  );
}
