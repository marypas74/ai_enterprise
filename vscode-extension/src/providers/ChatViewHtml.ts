/**
 * ChatViewHtml - HTML generation for the ChatViewProvider webview
 *
 * Extracted from extension.ts to keep each module under 800 LOC.
 * Contains _getHtml, _getReactHtml, _formatMarkdown, _escapeHtml.
 */

import * as vscode from 'vscode';

// ============================================
// TYPES
// ============================================

export interface ChatViewState {
    isAuthenticated: boolean;
    isClaudeProAuthenticated: boolean;
    user?: { email: string; name: string };
    isLoading: boolean;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: Date }>;
    fileContexts: Array<{ name: string; language: string; content: string }>;
    availableModels: Array<{ id: string; name: string; provider: string }>;
    selectedModel?: string;
    projects: Array<{ id: number; name: string; description: string; color: string; board_count: number; card_count: number }>;
    selectedProject?: number;
    notifications: Array<{
        id: number;
        type: 'card_assigned' | 'card_moved' | 'card_due' | 'mention';
        message: string;
        card_id?: number;
        card_title?: string;
        project_name?: string;
        created_at: string;
        read: boolean;
    }>;
}

export interface ReactHtmlContext {
    view: vscode.WebviewView;
    extensionUri: vscode.Uri;
    state: ChatViewState;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function getNotificationIcon(type: string): string {
    switch (type) {
        case 'card_assigned': return '\u{1F4CB}';
        case 'card_moved': return '\u{27A1}\u{FE0F}';
        case 'card_due': return '\u{23F0}';
        case 'mention': return '\u{1F4AC}';
        default: return '\u{1F514}';
    }
}

// ============================================
// MARKDOWN FORMATTER
// ============================================

export function formatMarkdown(text: string): string {
    // Code blocks with action buttons
    let codeBlockId = 0;
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
        codeBlockId++;
        const escapedCode = code.replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const language = lang || 'text';

        const isBashCommand = ['bash', 'sh', 'shell', 'zsh', 'terminal'].includes(language.toLowerCase());
        const isCode = !isBashCommand && language !== 'text' && language !== '';

        let buttons = `<button class="code-action" onclick="copyCode('${escapedCode}')">📋 Copia</button>`;

        if (isBashCommand) {
            buttons += `<button class="code-action run" onclick="runCommand('${escapedCode}')">▶️ Esegui</button>`;
        }
        if (isCode) {
            buttons += `<button class="code-action apply" onclick="applyCode('${escapedCode}', '${language}')">📝 Applica</button>`;
        }

        return `<div class="code-block">
            <div class="code-header">
                <span class="code-lang">${language}</span>
                <div class="code-actions">${buttons}</div>
            </div>
            <pre><code>${code}</code></pre>
        </div>`;
    });
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Newlines
    text = text.replace(/\n/g, '<br>');
    return text;
}

// ============================================
// REACT HTML GENERATION
// ============================================

export function getReactHtml(ctx: ReactHtmlContext): string {
    const webview = ctx.view.webview;
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(ctx.extensionUri, 'out', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(ctx.extensionUri, 'out', 'webview.css')
    );

    // Send initial state to React app after render
    setTimeout(() => {
        ctx.view.webview.postMessage({
            type: 'setAuthenticated',
            payload: {
                authenticated: ctx.state.isAuthenticated,
                user: ctx.state.user,
                models: ctx.state.availableModels,
            },
        });
        if (ctx.state.selectedModel) {
            ctx.view.webview.postMessage({
                type: 'updateModels',
                payload: {
                    models: ctx.state.availableModels,
                    selected: ctx.state.selectedModel,
                },
            });
        }
    }, 100);

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
    <link rel="stylesheet" href="${styleUri}">
    <title>Enterprise AI Chat</title>
    <style>
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
        .loading-app {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            color: var(--vscode-descriptionForeground);
            gap: 16px;
        }
        .loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid var(--vscode-textLink-foreground);
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
        <div class="loading-app">
            <div class="loading-spinner"></div>
            <span>Loading chat interface...</span>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

// ============================================
// CLASSIC HTML GENERATION
// ============================================

export function getClassicHtml(
    state: ChatViewState,
    outputChannel: vscode.OutputChannel
): string {
    outputChannel.appendLine('_getHtml called');
    outputChannel.appendLine('  isAuthenticated: ' + state.isAuthenticated);
    outputChannel.appendLine('  isClaudeProAuthenticated: ' + state.isClaudeProAuthenticated);

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const useDirectClaude = config.get<boolean>('useDirectClaude') ?? false;
    const claudeAuthMode = config.get<string>('claudeAuthMode') || 'pro';

    outputChannel.appendLine('  useDirectClaude: ' + useDirectClaude);
    outputChannel.appendLine('  claudeAuthMode: ' + claudeAuthMode);

    // Claude Pro login screen
    if (useDirectClaude && claudeAuthMode === 'pro' && !state.isClaudeProAuthenticated) {
        return getClaudeProLoginHtml();
    }

    // Backend login screen
    if (!useDirectClaude && !state.isAuthenticated) {
        outputChannel.appendLine('Showing login screen (backend mode, not authenticated)');
        return getBackendLoginHtml();
    }

    try {
        return getChatInterfaceHtml(state);
    } catch (error: any) {
        outputChannel.appendLine('ERROR in _getHtml: ' + error.message);
        return `<!DOCTYPE html><html><body style="padding:20px;color:#fff;background:#1e1e1e;">
            <h2>Error</h2><p>${error.message}</p>
        </body></html>`;
    }
}

// ============================================
// SUB-TEMPLATES
// ============================================

function getClaudeProLoginHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; text-align: center; color: var(--vscode-foreground); }
        h2 { margin-bottom: 10px; }
        p { color: var(--vscode-descriptionForeground); margin-bottom: 15px; }
        button { padding: 10px 24px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 5px; display: block; width: 100%; max-width: 250px; margin: 8px auto; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .subtitle { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 20px; line-height: 1.6; }
        .warning { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 10px; border-radius: 4px; margin: 15px 0; font-size: 12px; }
    </style>
</head>
<body>
    <h2>Claude AI</h2>
    <div class="warning">
        ⚠️ Claude Pro/Max OAuth è limitato a Claude Code ufficiale.<br>
        Per usare Claude qui, serve una API Key.
    </div>
    <button onclick="configureApiKey()">Configura API Key</button>
    <button onclick="openSettings()">Impostazioni</button>
    <p class="subtitle">
        Ottieni la tua API Key da:<br>
        <a href="#" onclick="openConsole()">console.anthropic.com</a>
    </p>
    <script>
        const vscode = acquireVsCodeApi();
        function configureApiKey() { vscode.postMessage({ type: 'configureApiKey' }); }
        function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
        function openConsole() { vscode.postMessage({ type: 'openExternal', url: 'https://console.anthropic.com/settings/keys' }); }
    </script>
</body>
</html>`;
}

function getBackendLoginHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
</head>
<body style="font-family: system-ui, sans-serif; padding: 30px; text-align: center; background: #1e1e1e; color: #ccc; margin: 0;">
    <h2 style="color: #fff; margin-bottom: 15px;">Enterprise AI Chat</h2>
    <p style="color: #888; margin-bottom: 25px;">Effettua il login al server per iniziare</p>
    <button id="loginBtn" style="padding: 12px 28px; background: #0e639c; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
        Login
    </button>
    <p style="margin-top: 20px; font-size: 11px; color: #666;">Server: https://192.168.1.123</p>
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            document.getElementById('loginBtn').addEventListener('click', function() {
                vscode.postMessage({ type: 'login' });
            });
        })();
    </script>
</body>
</html>`;
}

function getChatInterfaceHtml(state: ChatViewState): string {
    const messagesHtml = state.messages.map(msg => {
        const isUser = msg.role === 'user';
        const escaped = escapeHtml(msg.content);
        const formatted = isUser ? escaped : formatMarkdown(escaped);

        return `
            <div class="msg ${isUser ? 'user' : 'assistant'}">
                <div class="role">${isUser ? 'Tu' : 'Claude'}</div>
                <div class="content">${formatted}</div>
            </div>
        `;
    }).join('');

    const loadingHtml = state.isLoading ? `
        <div class="msg assistant">
            <div class="role">Claude</div>
            <div class="content loading">Sto pensando...</div>
        </div>
    ` : '';

    const contextHtml = state.fileContexts.length > 0 ? `
        <div class="context">
            ${state.fileContexts.map(f => `<span class="tag">${f.name}</span>`).join('')}
        </div>
    ` : '';

    const unreadCount = state.notifications.filter(n => !n.read).length;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        ${CHAT_CSS}
    </style>
</head>
<body>
    <div class="header">
        <div>
            <span class="header-title">AI Chat</span>
            <span class="header-user"> - ${state.user?.name || 'Utente'}</span>
        </div>
        <div class="header-actions">
            <button onclick="toggleNotifications()" class="notif-btn" title="Notifiche Kanban">
                🔔 ${unreadCount > 0 ? `<span class="notif-badge">${unreadCount}</span>` : ''}
            </button>
            ${state.availableModels.length > 0 ? `
            <select id="modelSelectHeader" onchange="selectModel(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); font-size: 11px; margin-right: 6px;">
                ${state.availableModels.map(m => `
                    <option value="${m.id}" ${m.id === state.selectedModel ? 'selected' : ''}>
                        ${m.name}
                    </option>
                `).join('')}
            </select>
            ` : `<span style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-right: 6px;">${state.selectedModel || 'Nessun modello'}</span>`}
            <button onclick="clearChat()">Nuova</button>
            <button onclick="logout()">Esci</button>
        </div>
    </div>

    <!-- Notifications Panel -->
    <div id="notificationsPanel" class="notifications-panel" style="display: none;">
        <div class="notif-header">
            <span>Notifiche</span>
            <button onclick="toggleNotifications()" style="background: none; border: none; color: var(--vscode-foreground); cursor: pointer;">&#10005;</button>
        </div>
        ${state.notifications.length === 0 ? `
            <div class="notif-empty">Nessuna notifica</div>
        ` : state.notifications.slice(0, 10).map(n => `
            <div class="notif-item ${n.read ? 'read' : 'unread'}" onclick="markNotifRead(${n.id})">
                <span class="notif-icon">${getNotificationIcon(n.type)}</span>
                <div class="notif-content">
                    <div class="notif-message">${n.message}</div>
                    ${n.project_name ? `<div class="notif-project">${n.project_name}</div>` : ''}
                </div>
            </div>
        `).join('')}
    </div>

    ${state.projects.length > 0 ? `
    <div class="model-selector">
        <label>Progetto:</label>
        <select id="projectSelect" onchange="selectProject(this.value)">
            <option value="">-- Nessun progetto --</option>
            ${state.projects.map(p => `
                <option value="${p.id}" ${p.id === state.selectedProject ? 'selected' : ''}>
                    ${p.name} (${p.card_count} card)
                </option>
            `).join('')}
        </select>
        ${state.selectedProject ? `<button class="btn-add-card" onclick="createCard()">+ Card</button>` : ''}
    </div>
    ` : ''}

    ${contextHtml}

    <div class="messages" id="messages">
        ${state.messages.length === 0 ? `
            <div class="empty">
                <h3>Ciao!</h3>
                <p>Chiedimi qualsiasi cosa sul codice</p>
            </div>
        ` : messagesHtml + loadingHtml}
    </div>

    <div class="input-area">
        <div class="input-container">
            <textarea id="input" placeholder="Scrivi un messaggio..." ${state.isLoading ? 'disabled' : ''}></textarea>
            <button class="send-btn" onclick="send()" ${state.isLoading ? 'disabled' : ''}>Invia</button>
        </div>
    </div>

    <script>
        ${CHAT_SCRIPT}
    </script>
</body>
</html>`;
}

// ============================================
// CSS & SCRIPT CONSTANTS
// ============================================

const CHAT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
}
.header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.header-title { font-weight: 600; }
.header-user { font-size: 11px; color: var(--vscode-descriptionForeground); }
.header-actions button {
    background: transparent;
    border: 1px solid var(--vscode-panel-border);
    color: var(--vscode-foreground);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    margin-left: 6px;
}
.messages { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin-bottom: 16px; }
.msg .role { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.msg.user .role { color: var(--vscode-textLink-foreground); }
.msg.assistant .role { color: #4ec9b0; }
.msg .content { padding: 10px 12px; border-radius: 8px; line-height: 1.5; word-wrap: break-word; }
.msg.user .content { background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); }
.msg.assistant .content { background: var(--vscode-sideBar-background); }
.loading { color: var(--vscode-descriptionForeground); font-style: italic; }
pre { background: #1e1e1e; padding: 10px; border-radius: 6px; overflow-x: auto; margin: 0; font-family: monospace; font-size: 12px; }
code { font-family: monospace; background: #2d2d2d; padding: 2px 5px; border-radius: 3px; }
pre code { background: transparent; padding: 0; }
.code-block { margin: 8px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--vscode-panel-border); }
.code-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #2d2d2d; border-bottom: 1px solid var(--vscode-panel-border); }
.code-lang { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
.code-actions { display: flex; gap: 4px; }
.code-action { font-size: 11px; padding: 3px 8px; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 3px; cursor: pointer; opacity: 0.8; }
.code-action:hover { opacity: 1; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.code-action.run { border-color: #4ec9b0; }
.code-action.run:hover { background: #4ec9b0; color: #1e1e1e; }
.code-action.apply { border-color: #569cd6; }
.code-action.apply:hover { background: #569cd6; color: #1e1e1e; }
.context { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 3px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; }
.input-area { padding: 12px; border-top: 1px solid var(--vscode-panel-border); }
.input-container { display: flex; gap: 8px; }
textarea { flex: 1; min-height: 60px; max-height: 150px; padding: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 6px; resize: none; font-family: inherit; font-size: 13px; }
textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
.send-btn { padding: 10px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
.send-btn:hover { background: var(--vscode-button-hoverBackground); }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.empty { text-align: center; padding: 40px 20px; color: var(--vscode-descriptionForeground); }
.empty h3 { color: var(--vscode-foreground); margin-bottom: 8px; }
.model-selector { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 8px; }
.model-selector label { font-size: 11px; color: var(--vscode-descriptionForeground); }
.model-selector select { flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-size: 12px; cursor: pointer; }
.model-selector select:focus { outline: none; border-color: var(--vscode-focusBorder); }
.btn-add-card { padding: 4px 10px; background: #10B981; color: white; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: 6px; }
.btn-add-card:hover { background: #059669; }
.notif-btn { position: relative; background: transparent; border: 1px solid #f59e0b; color: var(--vscode-foreground); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 6px; }
.notif-badge { background: #ef4444; color: white; font-size: 10px; padding: 1px 5px; border-radius: 10px; margin-left: 4px; }
.notifications-panel { position: absolute; top: 40px; right: 10px; width: 300px; max-height: 400px; background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 100; overflow: hidden; }
.notif-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; }
.notif-empty { padding: 20px; text-align: center; color: var(--vscode-descriptionForeground); }
.notif-item { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
.notif-item:hover { background: var(--vscode-list-hoverBackground); }
.notif-item.unread { background: rgba(59, 130, 246, 0.1); }
.notif-icon { font-size: 16px; }
.notif-content { flex: 1; }
.notif-message { font-size: 12px; line-height: 1.4; }
.notif-project { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
`;

const CHAT_SCRIPT = `
const vscode = acquireVsCodeApi();

function send() {
    const input = document.getElementById('input');
    const message = input.value.trim();
    if (message) {
        vscode.postMessage({ type: 'send', message });
        input.value = '';
    }
}

function clearChat() { vscode.postMessage({ type: 'clear' }); }
function logout() { vscode.postMessage({ type: 'logout' }); }
function selectModel(modelId) { vscode.postMessage({ type: 'selectModel', modelId }); }
function selectProject(projectId) {
    if (projectId) {
        vscode.postMessage({ type: 'selectProject', projectId: parseInt(projectId) });
    }
}

function createCard() { vscode.postMessage({ type: 'createCardUI' }); }

function toggleNotifications() {
    const panel = document.getElementById('notificationsPanel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
}

function markNotifRead(notifId) {
    vscode.postMessage({ type: 'markNotificationRead', notificationId: notifId });
}

function copyCode(code) {
    const decoded = code.replace(/\\\\n/g, '\\n').replace(/\\\\'/g, "'");
    vscode.postMessage({ type: 'copy', text: decoded });
}

function runCommand(command) {
    const decoded = command.replace(/\\\\n/g, '\\n').replace(/\\\\'/g, "'");
    vscode.postMessage({ type: 'runCommand', command: decoded });
}

function applyCode(code, language) {
    const decoded = code.replace(/\\\\n/g, '\\n').replace(/\\\\'/g, "'");
    vscode.postMessage({ type: 'applyCode', code: decoded, language: language });
}

document.getElementById('input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
    }
});

window.addEventListener('message', event => {
    const data = event.data;
    if (data.type === 'insertCode') {
        const input = document.getElementById('input');
        if (input) {
            input.value += '\\n\\n\\\`\\\`\\\`' + data.language + '\\n' + data.code + '\\n\\\`\\\`\\\`';
            input.focus();
        }
    }
});

const messages = document.getElementById('messages');
if (messages) messages.scrollTop = messages.scrollHeight;

document.getElementById('input')?.focus();
`;
