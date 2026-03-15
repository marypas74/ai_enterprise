import * as vscode from 'vscode';

export class EnterpriseAICodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    if (range.isEmpty) { return []; }

    const actions: vscode.CodeAction[] = [];
    const commands = [
      { title: 'Explain Code', command: 'enterprise-ai.explainCode' },
      { title: 'Fix Code', command: 'enterprise-ai.fixCode' },
      { title: 'Improve Code', command: 'enterprise-ai.improveCode' },
      { title: 'Generate Tests', command: 'enterprise-ai.generateTests' },
    ];

    for (const { title, command } of commands) {
      const action = new vscode.CodeAction(`Enterprise AI: ${title}`, vscode.CodeActionKind.QuickFix);
      action.command = { command, title };
      actions.push(action);
    }

    return actions;
  }
}
