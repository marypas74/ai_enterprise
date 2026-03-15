import * as vscode from 'vscode';
import type { ModuleContext, ExtensionToWebview, WebviewToExtension } from '../../core/types';
import { ChatService } from './ChatService';

export class ChatPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly chatService: ChatService;

  constructor(private readonly context: ModuleContext) {
    this.chatService = new ChatService(
      context.apiClient,
      context.eventBus,
      context.outputChannel,
    );

    context.eventBus.on('auth:login', async () => {
      const models = await this.chatService.loadModels();
      const user = context.authService.getUser();
      if (user && this.panel) {
        this.postMessage({ type: 'setAuthenticated', payload: { user, models } });
      }
    });

    context.eventBus.on('auth:logout', () => {
      this.postMessage({ type: 'setUnauthenticated' });
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'enterprise-ai.chat',
      'Enterprise AI Chat',
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
      (msg: WebviewToExtension) => this.handleMessage(msg),
      undefined,
      this.context.extensionContext.subscriptions,
    );
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
  }

  postMessage(message: ExtensionToWebview | Record<string, unknown>): void {
    this.panel?.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewToExtension): Promise<void> {
    try {
      switch (message.type) {
        case 'ready': {
          if (this.context.authService.isAuthenticated()) {
            const models = await this.chatService.loadModels();
            const user = this.context.authService.getUser();
            if (user) {
              this.postMessage({ type: 'setAuthenticated', payload: { user, models } });
            }
          }
          break;
        }
        case 'sendMessage': {
          const { message: text, modelId, conversationId } = message.payload;
          this.chatService.sendMessage(
            text,
            modelId,
            (chunk) => {
              this.postMessage({ type: 'streamChunk', payload: chunk });
              if (chunk.done) {
                this.postMessage({ type: 'streamEnd' });
              }
            },
            (error) => this.postMessage({ type: 'streamError', payload: { message: error.message } }),
            conversationId,
          );
          break;
        }
        case 'abortRequest':
          this.chatService.abortCurrentRequest();
          break;
        case 'newChat':
          break;
        case 'loadConversations': {
          const conversations = await this.chatService.loadConversations();
          this.postMessage({ type: 'setConversations', payload: { conversations } });
          break;
        }
        case 'deleteConversation':
          await this.chatService.deleteConversation(message.payload.id);
          break;
        case 'login': {
          const { email, password, totp } = message.payload;
          await this.context.authService.login(email, password, totp);
          break;
        }
        case 'logout':
          this.context.authService.logout();
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.context.outputChannel.appendLine(`[ChatPanel] Error handling ${message.type}: ${msg}`);
      this.postMessage({ type: 'streamError', payload: { message: msg } });
    }
  }

  private getHtml(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'out', 'chatWebview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'out', 'theme.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Enterprise AI Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}
