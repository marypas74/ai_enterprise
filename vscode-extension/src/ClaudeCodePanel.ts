import * as vscode from 'vscode';

/**
 * Enterprise AI Panel - Opens as an Editor Tab (WebviewPanel)
 *
 * This creates an immersive terminal-like experience in the main editor area.
 */
export class ClaudeCodePanel {
    public static currentPanel: ClaudeCodePanel | undefined;
    public static readonly viewType = 'claudeCode.panel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    // State
    private _isAuthenticated: boolean = false;
    private _user?: { name: string; email: string };
    private _models: Array<{ id: string; name: string; provider: string }> = [];
    private _selectedModel?: string;

    /**
     * Create or show the Claude Code panel
     */
    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (ClaudeCodePanel.currentPanel) {
            ClaudeCodePanel.currentPanel._panel.reveal(column);
            return ClaudeCodePanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            ClaudeCodePanel.viewType,
            'Enterprise AI',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true, // Important: keeps state when tab is hidden
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out'),
                    vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'),
                ],
            }
        );

        ClaudeCodePanel.currentPanel = new ClaudeCodePanel(panel, extensionUri);
        return ClaudeCodePanel.currentPanel;
    }

    /**
     * Revive panel when VS Code restarts
     */
    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        ClaudeCodePanel.currentPanel = new ClaudeCodePanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    /**
     * Send message to webview
     */
    public postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }

    /**
     * Set authentication state
     */
    public setAuthenticated(
        authenticated: boolean,
        user?: { name: string; email: string },
        models?: Array<{ id: string; name: string; provider: string }>
    ) {
        this._isAuthenticated = authenticated;
        this._user = user;
        if (models) {
            this._models = models;
        }
        this.postMessage({
            type: 'setAuthenticated',
            payload: { authenticated, user, models },
        });
    }

    /**
     * Update available models
     */
    public updateModels(
        models: Array<{ id: string; name: string; provider: string }>,
        selected?: string
    ) {
        this._models = models;
        if (selected) {
            this._selectedModel = selected;
        }
        this.postMessage({
            type: 'updateModels',
            payload: { models, selected },
        });
    }

    /**
     * Start streaming response
     */
    public streamStart() {
        this.postMessage({ type: 'streamStart' });
    }

    /**
     * Send stream chunk
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
     * Send stream error
     */
    public streamError(error: string) {
        this.postMessage({ type: 'streamError', payload: { error } });
    }

    /**
     * Add complete message
     */
    public addMessage(role: 'user' | 'assistant' | 'system', content: string) {
        this.postMessage({
            type: 'addMessage',
            payload: { role, content, timestamp: new Date().toISOString() },
        });
    }

    /**
     * Handle messages from webview
     */
    private async _handleMessage(message: any) {
        switch (message.type) {
            case 'send':
                // Handle send message - emit event for extension to handle
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.sendMessage',
                    message.message
                );
                break;

            case 'login':
                vscode.commands.executeCommand('enterprise-ai-chat.login');
                break;

            case 'logout':
                vscode.commands.executeCommand('enterprise-ai-chat.logout');
                break;

            case 'selectModel':
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.selectModel',
                    message.modelId
                );
                break;

            case 'runCommand':
                const terminal = vscode.window.createTerminal('Enterprise AI');
                terminal.show();
                terminal.sendText(message.command);
                break;

            case 'applyCode':
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.edit((editBuilder) => {
                        if (editor.selection.isEmpty) {
                            editBuilder.insert(editor.selection.active, message.code);
                        } else {
                            editBuilder.replace(editor.selection, message.code);
                        }
                    });
                }
                break;

            case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;

            case 'copy':
                vscode.env.clipboard.writeText(message.text);
                vscode.window.showInformationMessage('Copied to clipboard');
                break;

            case 'newChat':
                this.postMessage({ type: 'clearMessages' });
                break;

            // Kanban operations
            case 'loadProjects':
                vscode.commands.executeCommand('enterprise-ai-chat.loadProjects');
                break;

            case 'selectProject':
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.selectKanbanProject',
                    message.projectId
                );
                break;

            case 'moveCard':
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.moveKanbanCard',
                    message.cardId,
                    message.columnId,
                    message.projectId // Pass projectId for proper API call
                );
                break;

            case 'addCardComment':
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.addKanbanComment',
                    message.projectId,
                    message.cardId,
                    message.content
                );
                break;

            case 'getVersionInfo':
                vscode.commands.executeCommand('enterprise-ai-chat.getVersionInfo');
                break;

            // History operations
            case 'loadHistory':
                vscode.commands.executeCommand('enterprise-ai-chat.loadHistory');
                break;

            case 'loadConversation':
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.loadConversation',
                    message.conversationId
                );
                break;

            case 'deleteConversation':
                vscode.commands.executeCommand(
                    'enterprise-ai-chat.deleteConversation',
                    message.conversationId
                );
                break;

            case 'sendAgentic':
                // Handle agentic task execution from Kanban
                console.log('[ClaudeCodePanel] sendAgentic received:', message.message?.substring(0, 50), 'projectId:', message.projectId);
                if (message.message && message.projectId !== undefined) {
                    vscode.commands.executeCommand(
                        'enterprise-ai-chat.sendAgenticMessage',
                        message.message,
                        message.projectId
                    );
                } else {
                    console.error('[ClaudeCodePanel] sendAgentic missing data:', { hasMessage: !!message.message, projectId: message.projectId });
                }
                break;

            case 'abortRequest':
                // Handle abort request
                console.log('[ClaudeCodePanel] abortRequest received');
                vscode.commands.executeCommand('enterprise-ai-chat.abortRequest');
                break;
        }
    }

    /**
     * Update webview content
     */
    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Enterprise AI';
        this._panel.iconPath = vscode.Uri.joinPath(
            this._extensionUri,
            'resources',
            'icon.png'
        );
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    /**
     * Generate HTML for the Claude Code webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        // Get the React bundle URI
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'claudeCodeWebview.js')
        );

        // Get the CSS URI
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'claudeCode.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        font-src ${webview.cspSource} https://fonts.gstatic.com;
        img-src ${webview.cspSource} https: data:;
    ">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="${styleUri}" rel="stylesheet">
    <title>Enterprise AI</title>
    <style>
        /* Critical CSS - loaded immediately */
        :root {
            --claude-bg: #151515;
            --claude-orange: #D97757;
        }
        html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--claude-bg);
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        /* Loading screen */
        .claude-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: var(--claude-bg);
            color: #666;
            gap: 20px;
        }
        .claude-loading-logo {
            width: 48px;
            height: 48px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="claude-loading">
            <svg class="claude-loading-logo" viewBox="0 0 64 48">
                <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1 0-2 .1-3 .4C47 4 42.5 0 37 0c-6.5 0-12 5-12.5 11.5C20 12 16 16.5 16 22c0 6 5 11 11 11h25z" fill="#2196F3"/>
                <path d="M48 32c4 0 7.5-3 8-7H10c.5 4 4 7 8 7h30z" fill="#1976D2"/>
                <circle cx="32" cy="24" r="10" fill="#7C4DFF"/>
                <circle cx="32" cy="24" r="2" fill="white"/>
                <circle cx="26" cy="20" r="1.5" fill="white"/>
                <circle cx="38" cy="20" r="1.5" fill="white"/>
                <circle cx="26" cy="28" r="1.5" fill="white"/>
                <circle cx="38" cy="28" r="1.5" fill="white"/>
                <line x1="32" y1="24" x2="26" y2="20" stroke="white" stroke-width="1.5"/>
                <line x1="32" y1="24" x2="38" y2="20" stroke="white" stroke-width="1.5"/>
                <line x1="32" y1="24" x2="26" y2="28" stroke="white" stroke-width="1.5"/>
                <line x1="32" y1="24" x2="38" y2="28" stroke="white" stroke-width="1.5"/>
            </svg>
            <span>Loading Enterprise AI...</span>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Dispose panel
     */
    public dispose() {
        ClaudeCodePanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

/**
 * Generate nonce for Content Security Policy
 */
function getNonce(): string {
    let text = '';
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
