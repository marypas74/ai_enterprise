import * as vscode from 'vscode';
import type { ModuleContext, AgentExtensionToWebview, AgentWebviewToExtension, AgentLogEntry } from '../../core/types';
import { getNonce } from '../../utils/helpers';
import { AgentService } from './AgentService';

export class AgentPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly agentService: AgentService;
  private activeSessionId: string | null = null;

  constructor(private readonly context: ModuleContext, agentService: AgentService) {
    this.agentService = agentService;
    context.eventBus.on('auth:login', () => {
      const user = context.authService.getUser();
      if (user && this.panel) {
        this.postMessage({ type: 'setAuthenticated', payload: { user } });
      }
    });
    context.eventBus.on('auth:logout', () => {
      this.postMessage({ type: 'setUnauthenticated' });
      this.agentService.stopLogStream();
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'enterprise-ai.agents',
      'Enterprise AI Agents',
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
      (msg: AgentWebviewToExtension) => this.handleMessage(msg),
      undefined,
      this.context.extensionContext.subscriptions,
    );
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.activeSessionId = null;
      this.agentService.stopLogStream();
    });
  }

  selectSession(sessionId: string): void {
    this.handleMessage({ type: 'selectSession', payload: { sessionId } });
  }

  postMessage(message: AgentExtensionToWebview): void {
    this.panel?.webview.postMessage(message);
  }

  private async handleMessage(message: AgentWebviewToExtension): Promise<void> {
    try {
      switch (message.type) {
        case 'ready': {
          if (this.context.authService.isAuthenticated()) {
            const user = this.context.authService.getUser();
            if (user) {
              this.postMessage({ type: 'setAuthenticated', payload: { user } });
            }
          }
          await this.refreshSessions();
          break;
        }
        case 'loadSessions':
          await this.refreshSessions();
          break;
        case 'selectSession': {
          const { sessionId } = message.payload;
          this.activeSessionId = sessionId;
          this.agentService.stopLogStream();
          this.agentService.streamSessionLogs(
            sessionId,
            (entry: AgentLogEntry) => {
              this.postMessage({ type: 'logEntry', payload: entry });
            },
            (error: Error) => {
              this.postMessage({
                type: 'sseStatus',
                payload: { connected: false, message: `Connection lost — reconnecting... (${error.message})` },
              });
            },
          );
          this.postMessage({ type: 'sseStatus', payload: { connected: true } });
          break;
        }
        case 'pauseSession':
          await this.agentService.pauseSession(message.payload.sessionId);
          await this.refreshSessions();
          break;
        case 'resumeSession':
          await this.agentService.resumeSession(message.payload.sessionId);
          await this.refreshSessions();
          break;
        case 'cancelSession':
          await this.agentService.cancelSession(message.payload.sessionId);
          await this.refreshSessions();
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.context.outputChannel.appendLine(`[AgentPanel] Error: ${msg}`);
    }
  }

  private async refreshSessions(): Promise<void> {
    try {
      const sessions = await this.agentService.getSessions();
      this.postMessage({ type: 'setSessions', payload: { sessions } });
    } catch (error) {
      this.context.outputChannel.appendLine(`[AgentPanel] Failed to refresh sessions: ${error}`);
    }
  }

  private getHtml(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'out', 'agentsWebview.js'),
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
  <title>Enterprise AI Agents</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
