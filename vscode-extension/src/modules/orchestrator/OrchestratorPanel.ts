import * as vscode from 'vscode';
import type {
  ModuleContext,
  OrchestratorExtensionToWebview,
  OrchestratorWebviewToExtension,
  OrchestratorStatus,
} from '../../core/types';
import { getNonce } from '../../utils/helpers';
import type { OrchestratorService } from './OrchestratorService';
import type { OrchestratorStatusBar } from './OrchestratorStatusBar';

export class OrchestratorPanel {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: ModuleContext,
    private readonly orchestratorService: OrchestratorService,
    private readonly statusBar: OrchestratorStatusBar,
  ) {
    context.eventBus.on('auth:login', () => {
      const user = context.authService.getUser();
      if (user && this.panel) {
        this.postMessage({ type: 'setAuthenticated', payload: { user } });
      }
    });
    context.eventBus.on('auth:logout', () => {
      this.postMessage({ type: 'setUnauthenticated' });
      this.orchestratorService.stopEventStream();
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'enterprise-ai.orchestrator',
      'Enterprise AI Orchestrator',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'out'),
        ],
      },
    );
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg: OrchestratorWebviewToExtension) => this.handleMessage(msg),
      undefined,
      this.context.extensionContext.subscriptions,
    );
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.orchestratorService.stopEventStream();
      this.statusBar.onPanelClosed();
    });
    this.statusBar.onPanelOpened();
  }

  private postMessage(message: OrchestratorExtensionToWebview): void {
    this.panel?.webview.postMessage(message);
  }

  private async handleMessage(message: OrchestratorWebviewToExtension): Promise<void> {
    try {
      switch (message.type) {
        case 'ready': {
          if (this.context.authService.isAuthenticated()) {
            const user = this.context.authService.getUser();
            if (user) {
              this.postMessage({ type: 'setAuthenticated', payload: { user } });
            }
          }
          const status = await this.orchestratorService.getStatus();
          this.postMessage({ type: 'setStatus', payload: status });
          this.orchestratorService.startEventStream(
            (updatedStatus: OrchestratorStatus) => {
              this.postMessage({ type: 'setStatus', payload: updatedStatus });
            },
            (error: Error) => {
              this.postMessage({
                type: 'sseStatus',
                payload: { connected: false, message: `Connection lost: ${error.message}` },
              });
            },
          );
          this.postMessage({ type: 'sseStatus', payload: { connected: true } });
          break;
        }
        case 'releaseSlot':
          await this.orchestratorService.releaseSlot(message.payload.slotId);
          break;
        case 'terminateSession':
          await this.orchestratorService.terminateSession(message.payload.sessionId);
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.context.outputChannel.appendLine(`[OrchestratorPanel] Error: ${msg}`);
    }
  }

  private getHtml(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'out', 'orchestratorWebview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'out', 'theme.css'),
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Enterprise AI Orchestrator</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
