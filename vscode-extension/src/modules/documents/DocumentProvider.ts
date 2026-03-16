import * as vscode from 'vscode';
import type { ModuleContext, Document } from '../../core/types';
import type { DocumentService } from './DocumentService';
import type { ChatPanel } from '../chat/ChatPanel';

export class DocumentProvider {
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly context: ModuleContext,
    private readonly documentService: DocumentService,
    private readonly getPanel: () => ChatPanel,
  ) {
    // Invalidate cache on auth login (documents may differ per user)
    this.disposables.push(
      this.context.eventBus.on('auth:login', () => {
        this.documentService.invalidateCache();
      }),
    );

    // Invalidate on logout
    this.disposables.push(
      this.context.eventBus.on('auth:logout', () => {
        this.documentService.invalidateCache();
      }),
    );
  }

  async handleLoadDocuments(): Promise<void> {
    const documents = await this.documentService.loadDocuments();
    this.getPanel().postMessage({
      type: 'setDocuments',
      payload: { documents },
    });
  }

  handleSearchDocuments(query: string): void {
    const results = this.documentService.searchDocuments(query);
    this.getPanel().postMessage({
      type: 'setDocuments',
      payload: { documents: results },
    });
  }

  async handleGenerateFromChat(
    format: Document['type'],
    content: string,
    fileName?: string,
  ): Promise<void> {
    try {
      const validFormat = format as 'docx' | 'excel' | 'pptx' | 'pdf';
      const data = await this.documentService.generateDocument({
        format: validFormat,
        content,
        fileName,
      });

      const extensionMap: Record<string, string> = {
        docx: 'docx',
        excel: 'xlsx',
        pptx: 'pptx',
        pdf: 'pdf',
      };
      const ext = extensionMap[validFormat] ?? validFormat;
      const finalName = fileName ? `${fileName}.${ext}` : `document.${ext}`;

      // Use VS Code save dialog
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(finalName),
        title: 'Save Generated Document',
      });

      if (saveUri) {
        await vscode.workspace.fs.writeFile(saveUri, data);
        this.getPanel().postMessage({
          type: 'documentGenerated',
          payload: { fileName: finalName, filePath: saveUri.fsPath },
        });
      }
    } catch (error) {
      this.context.outputChannel.appendLine(
        `[DocumentProvider] Generation failed: ${error}`,
      );
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
