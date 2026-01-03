import * as vscode from 'vscode';
import * as path from 'path';

/**
 * React-based Chat View Provider
 * Provides Claude Code-like UI with streaming responses
 */
export class ReactChatProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'enterprise-ai-chat.chatView';

    private _view?: vscode.WebviewView;
    private _isLoading: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _onMessage: (message: any) => Promise<void>
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out'),
                vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist'),
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the React webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this._onMessage(message);
        });
    }

    /**
     * Send a message to the React webview
     */
    public postMessage(message: any) {
        this._view?.webview.postMessage(message);
    }

    /**
     * Start streaming a response
     */
    public streamStart() {
        this.postMessage({ type: 'streamStart' });
    }

    /**
     * Send a chunk of streamed content
     */
    public streamChunk(content: string) {
        this.postMessage({ type: 'streamChunk', payload: { content } });
    }

    /**
     * End streaming
     */
    public streamEnd() {
        this.postMessage({ type: 'streamEnd' });
    }

    /**
     * Add a complete message (non-streaming)
     */
    public addMessage(role: 'user' | 'assistant' | 'system', content: string) {
        this.postMessage({
            type: 'addMessage',
            payload: {
                role,
                content,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Set loading state
     */
    public setLoading(loading: boolean) {
        this._isLoading = loading;
        this.postMessage({ type: 'setLoading', payload: { loading } });
    }

    /**
     * Clear all messages
     */
    public clearMessages() {
        this.postMessage({ type: 'clearMessages' });
    }

    /**
     * Update available models
     */
    public updateModels(models: Array<{ id: string; name: string; provider: string }>, selected?: string) {
        this.postMessage({
            type: 'updateModels',
            payload: { models, selected }
        });
    }

    /**
     * Set authentication state
     */
    public setAuthenticated(
        authenticated: boolean,
        user?: { name: string; email: string },
        models?: Array<{ id: string; name: string; provider: string }>
    ) {
        this.postMessage({
            type: 'setAuthenticated',
            payload: { authenticated, user, models }
        });
    }

    /**
     * Insert code into the input
     */
    public insertCode(fileName: string, language: string, code: string) {
        this.postMessage({
            type: 'insertCode',
            payload: { fileName, language, code }
        });
    }

    /**
     * Generate HTML for the React webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get the React bundle URI
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js')
        );

        // Generate nonce for security
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        font-src ${webview.cspSource};
        img-src ${webview.cspSource} https: data:;
    ">
    <title>Enterprise AI Chat</title>
    <style>
        /* Base styles while React loads */
        html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        /* Loading state */
        .loading-app {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            color: var(--vscode-descriptionForeground);
        }
        .loading-app::after {
            content: '';
            width: 24px;
            height: 24px;
            margin-left: 12px;
            border: 2px solid var(--vscode-textLink-foreground);
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="loading-app">Loading chat interface</div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
