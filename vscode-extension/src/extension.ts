/**
 * Enterprise AI Chat - VS Code Extension Entry Point
 *
 * This file is the slim entry point for the extension.
 * All heavy logic has been extracted into modules:
 *   - src/messaging/MessageHandler.ts   - message sending (direct Claude, backend SSE, agentic)
 *   - src/commands/CodeActions.ts        - code actions (explain, fix, improve, tests)
 *   - src/commands/RegisterCommands.ts   - command registration block
 *   - src/providers/ChatViewHtml.ts      - HTML generation for ChatViewProvider
 *   - src/providers/ChatViewKanban.ts    - Kanban board methods
 *   - src/providers/ChatViewMessaging.ts - ChatViewProvider messaging
 */

import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { ClaudeCodePanel } from './ClaudeCodePanel';
import {
    AgentSessionsProvider,
    TerminalSlotsProvider,
    AgentDashboardProvider,
    AgentApiService,
    registerAgentCommands,
} from './AgentPanel';
import { registerAllCommands } from './commands/RegisterCommands';

// Self-signed certificate support
const selfSignedHttpsAgent = new https.Agent({ rejectUnauthorized: false });

// Claude OAuth Configuration
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';

// ============================================
// TYPES
// ============================================

interface AvailableModel {
    id: string;
    name: string;
    provider: string;
}

// ============================================
// GLOBAL STATE
// ============================================

let api: AxiosInstance;
let accessToken: string | undefined;
let currentUser: { email: string; name: string } | undefined;
let outputChannel: vscode.OutputChannel;
let claudeOAuthToken: string | undefined;
let claudeRefreshToken: string | undefined;
let availableModels: AvailableModel[] = [];
let selectedModel: string | undefined;

// Agent providers
let _agentSessionsProvider: AgentSessionsProvider | undefined;
let _terminalSlotsProvider: TerminalSlotsProvider | undefined;
let _agentDashboardProvider: AgentDashboardProvider | undefined;
let _agentApiService: AgentApiService | undefined;

// ============================================
// CUSTOM INSTRUCTIONS
// ============================================

let cachedCustomInstructions: string | null = null;
let customInstructionsLoaded = false;

async function loadCustomInstructions(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return null; }

    const instructionPaths = [
        '.github/copilot-instructions.md',
        '.enterprise-ai/instructions.md',
        'STYLE.md',
        '.cursorrules',
        '.ai-instructions.md',
    ];

    for (const folder of workspaceFolders) {
        for (const instructionPath of instructionPaths) {
            const fullPath = vscode.Uri.joinPath(folder.uri, instructionPath);
            try {
                const content = await vscode.workspace.fs.readFile(fullPath);
                const text = new TextDecoder().decode(content);
                outputChannel.appendLine(`Loaded custom instructions from: ${instructionPath}`);
                return text;
            } catch {
                continue;
            }
        }
    }
    return null;
}

async function getCustomInstructions(): Promise<string | null> {
    if (!customInstructionsLoaded) {
        cachedCustomInstructions = await loadCustomInstructions();
        customInstructionsLoaded = true;
    }
    return cachedCustomInstructions;
}

vscode.workspace.onDidSaveTextDocument((document) => {
    const fileName = document.fileName;
    if (fileName.includes('instructions') || fileName.includes('STYLE.md') || fileName.includes('.cursorrules')) {
        customInstructionsLoaded = false;
        outputChannel?.appendLine('Custom instructions file changed, will reload on next request');
    }
});

// ============================================
// API INITIALIZATION
// ============================================

function initializeApi(): void {
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
    const allowSelfSigned = config.get<boolean>('allowSelfSignedCerts', true);

    if (allowSelfSigned) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: !allowSelfSigned });

    api = axios.create({
        baseURL: serverUrl,
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: httpsAgent,
        timeout: 300000,
    });

    if (accessToken) {
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
    }
}

// ============================================
// PANEL-BASED AUTH FUNCTIONS
// ============================================

async function loginToBackend(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');

    const email = await vscode.window.showInputBox({ prompt: 'Email', placeHolder: 'admin@enterprise.local', value: 'admin@enterprise.local' });
    if (!email) { return; }

    const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
    if (!password) { return; }

    try {
        let response = await api.post('/api/auth/login', { email, password });

        if (response.data.mfa_required) {
            const totpCode = await vscode.window.showInputBox({
                prompt: 'Enter TOTP code from your authenticator app',
                placeHolder: '000000',
                validateInput: (v) => /^\d{6}$/.test(v) ? null : 'Enter a 6-digit code',
            });
            if (!totpCode) { return; }
            response = await api.post('/api/auth/login', { email, password, totp_code: totpCode });
        }

        if (response.data.mfa_setup_required) {
            accessToken = response.data.accessToken;
            api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
            vscode.window.showWarningMessage('MFA setup is mandatory. Please complete MFA setup in the web interface first.');
            return;
        }

        accessToken = response.data.accessToken;
        currentUser = response.data.user;

        if (!accessToken) {
            vscode.window.showErrorMessage('Login failed: No access token received');
            return;
        }

        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        await context.globalState.update('accessToken', accessToken);
        await context.globalState.update('currentUser', currentUser);

        await fetchModelsForPanel(context);

        const panel = ClaudeCodePanel.currentPanel;
        if (panel) {
            panel.setAuthenticated(true, currentUser, availableModels);
            if (selectedModel) { panel.updateModels(availableModels, selectedModel); }
        }

        // Update agent providers with new credentials
        const agentServerUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
        if (_agentSessionsProvider) { _agentSessionsProvider.updateCredentials(agentServerUrl, accessToken || null); }
        if (_terminalSlotsProvider) { _terminalSlotsProvider.updateCredentials(agentServerUrl, accessToken || null); }
        if (_agentDashboardProvider) { _agentDashboardProvider.updateCredentials(agentServerUrl, accessToken || null); }
        if (_agentApiService) { _agentApiService.updateCredentials(agentServerUrl, accessToken || null); }

        vscode.window.showInformationMessage(`Connected as ${currentUser?.name}`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Login failed: ${error.response?.data?.error || error.message}`);
    }
}

async function fetchModelsForPanel(context: vscode.ExtensionContext): Promise<void> {
    try {
        const response = await api.get('/api/chat/models');
        const rawModels = response.data || [];

        availableModels = rawModels.map((m: any) => ({
            id: m.id || m.model_id || 'unknown',
            name: m.name || m.display_name || m.id || 'Unknown Model',
            provider: m.provider || m.provider_type || 'unknown',
        }));

        const savedModel = context.globalState.get<string>('selectedModel');
        if (savedModel && availableModels.some(m => m.id === savedModel)) {
            selectedModel = savedModel;
        } else if (availableModels.length > 0) {
            selectedModel = availableModels[0].id;
            await context.globalState.update('selectedModel', selectedModel);
        }

        const panel = ClaudeCodePanel.currentPanel;
        if (panel) { panel.updateModels(availableModels, selectedModel); }
    } catch (error: any) {
        outputChannel.appendLine(`Failed to fetch models: ${error.message}`);
        availableModels = [];
    }
}

async function logoutFromBackend(context: vscode.ExtensionContext): Promise<void> {
    accessToken = undefined;
    currentUser = undefined;
    availableModels = [];
    selectedModel = undefined;
    api.defaults.headers.common['Authorization'] = '';
    await context.globalState.update('accessToken', undefined);
    await context.globalState.update('currentUser', undefined);
    vscode.window.showInformationMessage('Logged out');
}

async function loginClaudeProPanel(_context: vscode.ExtensionContext): Promise<void> {
    vscode.window.showInformationMessage(
        'Claude Pro OAuth is not fully supported for programmatic access. Please use API key authentication instead.',
        'Open Settings'
    ).then(selection => {
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
        }
    });
}

// ============================================
// COLUMN COLORS
// ============================================

function getColumnColor(columnName: string): string {
    const colors: Record<string, string> = {
        'Backlog': '#6B7280', 'To Do': '#6B7280',
        'In Progress': '#F59E0B', 'Review': '#8B5CF6',
        'Done': '#10B981', 'Completato': '#10B981',
    };
    return colors[columnName] || '#6B7280';
}

// ============================================
// ACTIVATION
// ============================================

export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Enterprise AI Chat');
    outputChannel.appendLine('='.repeat(50));
    outputChannel.appendLine('Extension activating at ' + new Date().toISOString());
    outputChannel.appendLine('='.repeat(50));

    // Copilot Coexistence Detection
    const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
    const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
    if (copilotExtension || copilotChatExtension) {
        outputChannel.appendLine('GitHub Copilot detected - running in coexistence mode');
    }

    try {
        initializeApi();
        outputChannel.appendLine('API initialized successfully');
    } catch (e: any) {
        outputChannel.appendLine('ERROR: API init failed: ' + e.message);
        vscode.window.showErrorMessage('Enterprise AI Chat: API init error - ' + e.message);
    }

    // Session validation
    const clearSessionOnUnauthorized = () => {
        context.globalState.update('accessToken', undefined);
        context.globalState.update('currentUser', undefined);
        accessToken = undefined;
        currentUser = undefined;
        delete api.defaults.headers.common['Authorization'];
        const panel = ClaudeCodePanel.currentPanel;
        if (panel) { panel.setAuthenticated(false); }
    };

    api.interceptors.response.use(
        response => response,
        error => {
            if (error.response?.status === 401) { clearSessionOnUnauthorized(); }
            return Promise.reject(error);
        }
    );

    // Restore session
    const savedToken = context.globalState.get<string>('accessToken');
    const savedUser = context.globalState.get<{ email: string; name: string }>('currentUser');

    if (savedToken && savedUser) {
        outputChannel.appendLine('Validating saved session...');
        api.get('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${savedToken}` },
        }).then(testResponse => {
            if (testResponse.data && testResponse.data.user) {
                accessToken = savedToken;
                currentUser = testResponse.data.user;
                api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
                outputChannel.appendLine(`Session validated and restored for: ${currentUser?.email}`);
                const panel = ClaudeCodePanel.currentPanel;
                if (panel) { panel.setAuthenticated(true, currentUser, availableModels); }
            } else {
                clearSessionOnUnauthorized();
            }
        }).catch(() => {
            clearSessionOnUnauthorized();
        });
    }

    // Restore Claude Pro OAuth token
    claudeOAuthToken = context.globalState.get<string>('claudeOAuthToken');
    claudeRefreshToken = context.globalState.get<string>('claudeRefreshToken');

    // Agent Panel Setup
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const agentServerUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';

    const agentSessionsProvider = new AgentSessionsProvider(agentServerUrl, savedToken || null);
    const terminalSlotsProvider = new TerminalSlotsProvider(agentServerUrl, savedToken || null);
    const agentDashboardProvider = new AgentDashboardProvider(context.extensionUri, agentServerUrl, savedToken || null);
    const agentApiService = new AgentApiService(agentServerUrl, savedToken || null);

    _agentSessionsProvider = agentSessionsProvider;
    _terminalSlotsProvider = terminalSlotsProvider;
    _agentDashboardProvider = agentDashboardProvider;
    _agentApiService = agentApiService;

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('enterprise-ai-chat.agentSessions', agentSessionsProvider),
        vscode.window.registerTreeDataProvider('enterprise-ai-chat.terminalSlots', terminalSlotsProvider),
        vscode.window.registerWebviewViewProvider('enterprise-ai-chat.agentDashboard', agentDashboardProvider),
    );

    registerAgentCommands(context, agentSessionsProvider, terminalSlotsProvider, agentDashboardProvider, agentApiService);

    const agentRefreshInterval = setInterval(() => {
        agentSessionsProvider.refresh();
        terminalSlotsProvider.refresh();
        agentDashboardProvider.refresh();
    }, 30000);

    context.subscriptions.push({ dispose: () => clearInterval(agentRefreshInterval) });

    agentSessionsProvider.refresh();
    terminalSlotsProvider.refresh();
    outputChannel.appendLine('Auto-Claude Agent Panel initialized');

    // Panel factory
    const getPanel = () => {
        const panel = ClaudeCodePanel.createOrShow(context.extensionUri);
        if (accessToken && currentUser) {
            api.get('/api/auth/me', { headers: { 'Authorization': `Bearer ${accessToken}` } })
                .then(() => {
                    panel.setAuthenticated(true, currentUser!, availableModels);
                    if (selectedModel) { panel.updateModels(availableModels, selectedModel); }
                })
                .catch(() => {
                    accessToken = undefined;
                    currentUser = undefined;
                    context.globalState.update('accessToken', undefined);
                    context.globalState.update('currentUser', undefined);
                    panel.setAuthenticated(false);
                });
        } else {
            panel.setAuthenticated(false);
        }
        return panel;
    };

    // Register all commands via extracted module
    const commandDisposables = registerAllCommands({
        context,
        api,
        outputChannel,
        getAccessToken: () => accessToken,
        setAccessToken: (token) => { accessToken = token; },
        getCurrentUser: () => currentUser,
        getSelectedModel: () => selectedModel,
        setSelectedModel: (model) => { selectedModel = model; },
        getAvailableModels: () => availableModels,
        getPanel,
        loginToBackend,
        logoutFromBackend,
        loginClaudeProPanel,
        getCustomInstructions,
        getColumnColor,
    });

    context.subscriptions.push(...commandDisposables);

    // OAuth URI handler
    const uriHandler = new ClaudeOAuthUriHandler();
    context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

    // Status bar
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'enterprise-ai-chat.openChat';
    statusBarItem.tooltip = 'Apri Enterprise AI Chat (Ctrl+Shift+L)';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    context.subscriptions.push(statusBarItem);

    const updateStatusBar = () => {
        if (accessToken && currentUser) {
            statusBarItem.text = `$(cloud) ${currentUser.name}: Chat`;
        } else {
            statusBarItem.text = '$(cloud) Enterprise AI: Login';
        }
        statusBarItem.show();
    };
    updateStatusBar();

    outputChannel.appendLine('Extension activated successfully');

    if (!accessToken) {
        vscode.window.showInformationMessage('Enterprise AI Chat: Effettua il login per iniziare', 'Login')
            .then(action => {
                if (action === 'Login') { vscode.commands.executeCommand('enterprise-ai-chat.login'); }
            });
    } else {
        selectedModel = context.globalState.get<string>('selectedModel');
        fetchModelsForPanel(context);
    }
}

// ============================================
// CLAUDE OAUTH URI HANDLER
// ============================================

let pendingOAuthContext: vscode.ExtensionContext | undefined;

class ClaudeOAuthUriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri): Promise<void> {
        outputChannel.appendLine('OAuth callback received: ' + uri.toString());

        if (uri.path !== '/oauth-callback') { return; }

        const params = new URLSearchParams(uri.query);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');

        if (error) {
            vscode.window.showErrorMessage(`OAuth error: ${error}`);
            return;
        }

        if (!code || !state || !pendingOAuthContext) {
            vscode.window.showErrorMessage('OAuth callback missing required data');
            return;
        }

        const savedState = pendingOAuthContext.globalState.get<string>('claudeOAuthState');
        if (state !== savedState) {
            vscode.window.showErrorMessage('OAuth state mismatch');
            return;
        }

        try {
            const codeVerifier = pendingOAuthContext.globalState.get<string>('claudeCodeVerifier');
            const redirectUri = 'vscode://enterprise-ai.enterprise-ai-chat/oauth-callback';

            const response = await axios.post(CLAUDE_OAUTH_TOKEN_URL, {
                grant_type: 'authorization_code',
                client_id: CLAUDE_OAUTH_CLIENT_ID,
                code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
            }, { headers: { 'Content-Type': 'application/json' } });

            if (response.data.access_token) {
                claudeOAuthToken = response.data.access_token;
                claudeRefreshToken = response.data.refresh_token;
                await pendingOAuthContext.globalState.update('claudeOAuthToken', claudeOAuthToken);
                await pendingOAuthContext.globalState.update('claudeRefreshToken', claudeRefreshToken);
                vscode.window.showInformationMessage('Login Claude Pro completato!');
            } else {
                throw new Error('No access token in response');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Token exchange failed: ${error.response?.data?.error || error.message}`);
        }
    }
}

// ============================================
// DEACTIVATION
// ============================================

export function deactivate(): void {
    outputChannel?.appendLine('Extension deactivating');
}
