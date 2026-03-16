import * as vscode from 'vscode';
import type { DocumentService } from './DocumentService';
import type { DocumentGenerateRequest } from '../../core/types';

interface FormatOption {
  label: string;
  description: string;
  format: DocumentGenerateRequest['format'];
  extension: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { label: 'DOCX', description: 'Microsoft Word document', format: 'docx', extension: 'docx' },
  { label: 'Excel', description: 'Microsoft Excel spreadsheet', format: 'excel', extension: 'xlsx' },
  { label: 'PowerPoint', description: 'Microsoft PowerPoint presentation', format: 'pptx', extension: 'pptx' },
  { label: 'PDF', description: 'PDF document', format: 'pdf', extension: 'pdf' },
];

const FILTER_MAP: Record<string, Record<string, string[]>> = {
  docx: { 'Word Documents': ['docx'] },
  xlsx: { 'Excel Spreadsheets': ['xlsx'] },
  pptx: { 'PowerPoint Presentations': ['pptx'] },
  pdf: { 'PDF Documents': ['pdf'] },
};

export function registerDocumentCommands(
  documentService: DocumentService,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.generateDocument', async () => {
      // Step 1: Pick format
      const formatChoice = await vscode.window.showQuickPick(FORMAT_OPTIONS, {
        placeHolder: 'Select document format to generate',
        title: 'Enterprise AI: Generate Document',
      });
      if (!formatChoice) { return; }

      // Step 2: Input content/prompt
      const content = await vscode.window.showInputBox({
        prompt: `Describe the ${formatChoice.label} document to generate`,
        placeHolder: 'e.g., Monthly sales report for March 2026 with charts',
        ignoreFocusOut: true,
      });
      if (!content) { return; }

      // Step 3: Choose save location
      const saveUri = await vscode.window.showSaveDialog({
        filters: FILTER_MAP[formatChoice.extension],
        defaultUri: vscode.Uri.file(`document.${formatChoice.extension}`),
        title: `Save ${formatChoice.label} Document`,
      });
      if (!saveUri) { return; }

      // Step 4: Generate and save
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Generating ${formatChoice.label} document...`,
            cancellable: false,
          },
          async () => {
            const data = await documentService.generateDocument({
              format: formatChoice.format,
              content,
              fileName: saveUri.fsPath.split('/').pop()?.replace(`.${formatChoice.extension}`, ''),
            });

            await vscode.workspace.fs.writeFile(saveUri, data);
          },
        );

        const openAction = await vscode.window.showInformationMessage(
          `Document saved: ${saveUri.fsPath}`,
          'Open File',
        );
        if (openAction === 'Open File') {
          await vscode.commands.executeCommand('vscode.open', saveUri);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to generate document: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  ];
}
