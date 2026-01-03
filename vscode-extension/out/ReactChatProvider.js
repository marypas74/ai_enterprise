"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReactChatProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * React-based Chat View Provider
 * Provides Claude Code-like UI with streaming responses
 */
class ReactChatProvider {
    _extensionUri;
    _context;
    _onMessage;
    static viewType = 'enterprise-ai-chat.chatView';
    _view;
    _isLoading = false;
    constructor(_extensionUri, _context, _onMessage) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this._onMessage = _onMessage;
    }
    resolveWebviewView(webviewView, _context, _token) {
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
    postMessage(message) {
        this._view?.webview.postMessage(message);
    }
    /**
     * Start streaming a response
     */
    streamStart() {
        this.postMessage({ type: 'streamStart' });
    }
    /**
     * Send a chunk of streamed content
     */
    streamChunk(content) {
        this.postMessage({ type: 'streamChunk', payload: { content } });
    }
    /**
     * End streaming
     */
    streamEnd() {
        this.postMessage({ type: 'streamEnd' });
    }
    /**
     * Add a complete message (non-streaming)
     */
    addMessage(role, content) {
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
    setLoading(loading) {
        this._isLoading = loading;
        this.postMessage({ type: 'setLoading', payload: { loading } });
    }
    /**
     * Clear all messages
     */
    clearMessages() {
        this.postMessage({ type: 'clearMessages' });
    }
    /**
     * Update available models
     */
    updateModels(models, selected) {
        this.postMessage({
            type: 'updateModels',
            payload: { models, selected }
        });
    }
    /**
     * Set authentication state
     */
    setAuthenticated(authenticated, user, models) {
        this.postMessage({
            type: 'setAuthenticated',
            payload: { authenticated, user, models }
        });
    }
    /**
     * Insert code into the input
     */
    insertCode(fileName, language, code) {
        this.postMessage({
            type: 'insertCode',
            payload: { fileName, language, code }
        });
    }
    /**
     * Generate HTML for the React webview
     */
    _getHtmlForWebview(webview) {
        // Get the React bundle URI
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));
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
    _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.ReactChatProvider = ReactChatProvider;
//# sourceMappingURL=ReactChatProvider.js.map