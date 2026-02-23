import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';

const selfSignedAgent = new https.Agent({ rejectUnauthorized: false });

// ============================================
// TYPES
// ============================================

interface AgentSession {
    id: number;
    name: string;
    status: 'pending' | 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    terminalSlot: number;
    iterationCount: number;
    maxIterations: number;
    taskSpecification: string;
    createdAt: string;
}

interface TerminalSlot {
    slot: number;
    status: 'available' | 'occupied' | 'reserved';
    sessionId: number | null;
    sessionName: string | null;
}

interface OrchestratorMetrics {
    terminals: {
        total: number;
        available: number;
        occupied: number;
    };
    sessions: {
        running: number;
        completed: number;
        failed: number;
        successRate: number;
    };
}

// ============================================
// AGENT SESSIONS TREE PROVIDER
// ============================================

export class AgentSessionsProvider implements vscode.TreeDataProvider<AgentSessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentSessionItem | undefined | void> = new vscode.EventEmitter<AgentSessionItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentSessionItem | undefined | void> = this._onDidChangeTreeData.event;

    private sessions: AgentSession[] = [];
    private api: AxiosInstance;

    constructor(private serverUrl: string, private accessToken: string | null) {
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
    }

    updateCredentials(serverUrl: string, accessToken: string | null) {
        this.serverUrl = serverUrl;
        this.accessToken = accessToken;
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
        this.refresh();
    }

    async refresh(): Promise<void> {
        try {
            const response = await this.api.get('/api/agents/sessions', {
                params: { limit: 50 }
            });
            this.sessions = response.data.sessions || [];
        } catch (err) {
            console.error('Failed to fetch agent sessions:', err);
            this.sessions = [];
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AgentSessionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AgentSessionItem): Thenable<AgentSessionItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        return Promise.resolve(
            this.sessions.map(session => new AgentSessionItem(session))
        );
    }

    getSession(id: number): AgentSession | undefined {
        return this.sessions.find(s => s.id === id);
    }
}

class AgentSessionItem extends vscode.TreeItem {
    constructor(public readonly session: AgentSession) {
        super(session.name, vscode.TreeItemCollapsibleState.None);

        this.tooltip = `${session.taskSpecification.slice(0, 100)}...`;
        this.description = `Slot ${session.terminalSlot} - ${session.iterationCount}/${session.maxIterations}`;

        // Set icon based on status
        switch (session.status) {
            case 'running':
                this.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
                break;
            case 'paused':
                this.iconPath = new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow'));
                break;
            case 'completed':
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                break;
            case 'failed':
            case 'cancelled':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                break;
            case 'initializing':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('circle-outline');
        }

        this.contextValue = `agentSession-${session.status}`;
        this.command = {
            command: 'enterprise-ai-chat.showSessionDetail',
            title: 'Show Session Details',
            arguments: [session]
        };
    }
}

// ============================================
// TERMINAL SLOTS TREE PROVIDER
// ============================================

export class TerminalSlotsProvider implements vscode.TreeDataProvider<TerminalSlotItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TerminalSlotItem | undefined | void> = new vscode.EventEmitter<TerminalSlotItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TerminalSlotItem | undefined | void> = this._onDidChangeTreeData.event;

    private slots: TerminalSlot[] = [];
    private api: AxiosInstance;

    constructor(private serverUrl: string, private accessToken: string | null) {
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
    }

    updateCredentials(serverUrl: string, accessToken: string | null) {
        this.serverUrl = serverUrl;
        this.accessToken = accessToken;
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
        this.refresh();
    }

    async refresh(): Promise<void> {
        try {
            const response = await this.api.get('/api/orchestrator/terminals');
            this.slots = response.data.slots || [];
        } catch (err) {
            console.error('Failed to fetch terminal slots:', err);
            // Initialize with empty slots
            this.slots = Array.from({ length: 12 }, (_, i) => ({
                slot: i,
                status: 'available' as const,
                sessionId: null,
                sessionName: null
            }));
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TerminalSlotItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TerminalSlotItem): Thenable<TerminalSlotItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        // Ensure we have 12 slots
        const allSlots: TerminalSlot[] = Array.from({ length: 12 }, (_, i) => {
            const existingSlot = this.slots.find(s => s.slot === i);
            return existingSlot || {
                slot: i,
                status: 'available' as const,
                sessionId: null,
                sessionName: null
            };
        });

        return Promise.resolve(
            allSlots.map(slot => new TerminalSlotItem(slot))
        );
    }
}

class TerminalSlotItem extends vscode.TreeItem {
    constructor(public readonly slot: TerminalSlot) {
        super(`Slot ${slot.slot}`, vscode.TreeItemCollapsibleState.None);

        this.description = slot.sessionName || slot.status;

        switch (slot.status) {
            case 'occupied':
                this.iconPath = new vscode.ThemeIcon('vm-running', new vscode.ThemeColor('charts.green'));
                break;
            case 'reserved':
                this.iconPath = new vscode.ThemeIcon('vm', new vscode.ThemeColor('charts.yellow'));
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('vm-outline');
        }

        this.contextValue = `terminalSlot-${slot.status}`;
    }
}

// ============================================
// AGENT DASHBOARD WEBVIEW PROVIDER
// ============================================

export class AgentDashboardProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private api: AxiosInstance;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private serverUrl: string,
        private accessToken: string | null
    ) {
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
    }

    updateCredentials(serverUrl: string, accessToken: string | null) {
        this.serverUrl = serverUrl;
        this.accessToken = accessToken;
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
        this.refresh();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.refresh();
    }

    public async refresh() {
        if (!this._view) return;

        let metrics: OrchestratorMetrics | null = null;
        try {
            const response = await this.api.get('/api/orchestrator/status');
            metrics = response.data;
        } catch (err) {
            console.error('Failed to fetch orchestrator metrics:', err);
        }

        this._view.webview.html = this._getHtmlForWebview(this._view.webview, metrics);
    }

    private _getHtmlForWebview(webview: vscode.Webview, metrics: OrchestratorMetrics | null): string {
        const slotsOccupied = metrics?.terminals.occupied || 0;
        const slotsTotal = metrics?.terminals.total || 12;
        const sessionsRunning = metrics?.sessions.running || 0;
        const successRate = metrics?.sessions.successRate || 0;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 10px;
            margin: 0;
        }
        .metric-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 8px;
        }
        .metric-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        .metric-value {
            font-size: 24px;
            font-weight: bold;
        }
        .metric-subtitle {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }
        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
        }
        .status-online { background-color: #4caf50; }
        .status-warning { background-color: #ff9800; }
        .status-offline { background-color: #f44336; }
        .slots-bar {
            height: 6px;
            background: var(--vscode-progressBar-background);
            border-radius: 3px;
            margin-top: 8px;
            overflow: hidden;
        }
        .slots-bar-fill {
            height: 100%;
            background: var(--vscode-progressBar-background);
            transition: width 0.3s;
        }
        .button {
            width: 100%;
            padding: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 12px;
        }
        .button:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="metric-card">
        <div class="metric-label">
            <span class="status-indicator ${metrics ? 'status-online' : 'status-offline'}"></span>
            Orchestrator Status
        </div>
        <div class="metric-value">${metrics ? 'Online' : 'Offline'}</div>
    </div>

    <div class="metric-card">
        <div class="metric-label">Terminal Slots</div>
        <div class="metric-value">${slotsOccupied} / ${slotsTotal}</div>
        <div class="metric-subtitle">${slotsTotal - slotsOccupied} available</div>
        <div class="slots-bar">
            <div class="slots-bar-fill" style="width: ${(slotsOccupied / slotsTotal) * 100}%; background: ${slotsOccupied >= 10 ? '#f44336' : slotsOccupied >= 8 ? '#ff9800' : '#4caf50'}"></div>
        </div>
    </div>

    <div class="metric-card">
        <div class="metric-label">Active Sessions</div>
        <div class="metric-value">${sessionsRunning}</div>
        <div class="metric-subtitle">Success rate: ${successRate}%</div>
    </div>

    <button class="button" onclick="createSession()">
        + New Agent Session
    </button>

    <script>
        const vscode = acquireVsCodeApi();

        function createSession() {
            vscode.postMessage({ command: 'createSession' });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'refresh') {
                location.reload();
            }
        });
    </script>
</body>
</html>`;
    }
}

// ============================================
// AGENT API SERVICE
// ============================================

export class AgentApiService {
    private api: AxiosInstance;

    constructor(private serverUrl: string, private accessToken: string | null) {
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
    }

    updateCredentials(serverUrl: string, accessToken: string | null) {
        this.serverUrl = serverUrl;
        this.accessToken = accessToken;
        this.api = axios.create({
            baseURL: serverUrl,
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            httpsAgent: selfSignedAgent
        });
    }

    async createSession(data: {
        name: string;
        taskSpecification: string;
        modelId: number;
        config?: any;
    }): Promise<AgentSession> {
        const response = await this.api.post('/api/agents/sessions', data);
        return response.data;
    }

    async startSession(sessionId: number): Promise<void> {
        await this.api.post(`/api/agents/sessions/${sessionId}/start`);
    }

    async pauseSession(sessionId: number): Promise<void> {
        await this.api.post(`/api/agents/sessions/${sessionId}/pause`);
    }

    async resumeSession(sessionId: number): Promise<void> {
        await this.api.post(`/api/agents/sessions/${sessionId}/resume`);
    }

    async cancelSession(sessionId: number): Promise<void> {
        await this.api.post(`/api/agents/sessions/${sessionId}/cancel`);
    }

    async getSessionLogs(sessionId: number): Promise<any[]> {
        const response = await this.api.get(`/api/agents/sessions/${sessionId}/logs`);
        return response.data.logs || [];
    }

    async getTemplates(): Promise<any[]> {
        const response = await this.api.get('/api/agents/templates');
        return response.data || [];
    }

    async getModels(): Promise<any[]> {
        const response = await this.api.get('/api/chat/models');
        return response.data || [];
    }
}

// ============================================
// REGISTER AGENT PANEL COMMANDS
// ============================================

export function registerAgentCommands(
    context: vscode.ExtensionContext,
    sessionsProvider: AgentSessionsProvider,
    slotsProvider: TerminalSlotsProvider,
    dashboardProvider: AgentDashboardProvider,
    agentApi: AgentApiService
) {
    // Refresh agents
    context.subscriptions.push(
        vscode.commands.registerCommand('enterprise-ai-chat.refreshAgents', async () => {
            await Promise.all([
                sessionsProvider.refresh(),
                slotsProvider.refresh(),
                dashboardProvider.refresh()
            ]);
            vscode.window.showInformationMessage('Agent data refreshed');
        })
    );

    // Create agent session
    context.subscriptions.push(
        vscode.commands.registerCommand('enterprise-ai-chat.createAgentSession', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Session name',
                placeHolder: 'e.g., Implement user authentication'
            });

            if (!name) return;

            const taskSpec = await vscode.window.showInputBox({
                prompt: 'Task specification',
                placeHolder: 'Describe what the agent should do...'
            });

            if (!taskSpec) return;

            try {
                // Get available models
                const models = await agentApi.getModels();
                const modelItems = models.map(m => ({
                    label: m.name,
                    description: m.provider,
                    id: m.id
                }));

                const selectedModel = await vscode.window.showQuickPick(modelItems, {
                    placeHolder: 'Select AI model'
                });

                if (!selectedModel) return;

                const session = await agentApi.createSession({
                    name,
                    taskSpecification: taskSpec,
                    modelId: selectedModel.id
                });

                vscode.window.showInformationMessage(`Session "${session.name}" created`);

                // Ask if user wants to start immediately
                const start = await vscode.window.showQuickPick(['Yes', 'No'], {
                    placeHolder: 'Start session immediately?'
                });

                if (start === 'Yes') {
                    await agentApi.startSession(session.id);
                    vscode.window.showInformationMessage(`Session "${session.name}" started`);
                }

                sessionsProvider.refresh();
                slotsProvider.refresh();
                dashboardProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to create session: ${err.message}`);
            }
        })
    );

    // Show session detail
    context.subscriptions.push(
        vscode.commands.registerCommand('enterprise-ai-chat.showSessionDetail', async (session: AgentSession) => {
            const panel = vscode.window.createWebviewPanel(
                'agentSessionDetail',
                `Session: ${session.name}`,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            // Get logs
            let logs: any[] = [];
            try {
                logs = await agentApi.getSessionLogs(session.id);
            } catch (err) {
                console.error('Failed to get session logs:', err);
            }

            panel.webview.html = getSessionDetailHtml(session, logs);

            panel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'start':
                        await agentApi.startSession(session.id);
                        sessionsProvider.refresh();
                        break;
                    case 'pause':
                        await agentApi.pauseSession(session.id);
                        sessionsProvider.refresh();
                        break;
                    case 'resume':
                        await agentApi.resumeSession(session.id);
                        sessionsProvider.refresh();
                        break;
                    case 'cancel':
                        await agentApi.cancelSession(session.id);
                        sessionsProvider.refresh();
                        break;
                }
            });
        })
    );

    // Session context menu commands
    context.subscriptions.push(
        vscode.commands.registerCommand('enterprise-ai-chat.startSession', async (item: AgentSessionItem) => {
            await agentApi.startSession(item.session.id);
            sessionsProvider.refresh();
            slotsProvider.refresh();
        }),
        vscode.commands.registerCommand('enterprise-ai-chat.pauseSession', async (item: AgentSessionItem) => {
            await agentApi.pauseSession(item.session.id);
            sessionsProvider.refresh();
        }),
        vscode.commands.registerCommand('enterprise-ai-chat.resumeSession', async (item: AgentSessionItem) => {
            await agentApi.resumeSession(item.session.id);
            sessionsProvider.refresh();
        }),
        vscode.commands.registerCommand('enterprise-ai-chat.cancelSession', async (item: AgentSessionItem) => {
            await agentApi.cancelSession(item.session.id);
            sessionsProvider.refresh();
            slotsProvider.refresh();
        })
    );
}

function getSessionDetailHtml(session: AgentSession, logs: any[]): string {
    const statusColors: Record<string, string> = {
        pending: '#808080',
        initializing: '#2196f3',
        running: '#4caf50',
        paused: '#ff9800',
        completed: '#4caf50',
        failed: '#f44336',
        cancelled: '#9e9e9e'
    };

    const logsHtml = logs.map(log => {
        const typeColors: Record<string, string> = {
            info: '#2196f3',
            warning: '#ff9800',
            error: '#f44336',
            stdout: '#4caf50',
            stderr: '#f44336'
        };
        return `<div class="log-entry">
            <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
            <span class="log-type" style="color: ${typeColors[log.logType] || '#808080'}">[${log.logType}]</span>
            <span class="log-content">${log.content}</span>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        .title {
            font-size: 18px;
            font-weight: bold;
        }
        .status {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            color: white;
            background-color: ${statusColors[session.status]};
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-bottom: 16px;
        }
        .info-card {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
        }
        .info-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .info-value {
            font-size: 14px;
            margin-top: 4px;
        }
        .actions {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-danger {
            background: #f44336;
            color: white;
        }
        .logs-container {
            background: #1e1e1e;
            border-radius: 4px;
            padding: 12px;
            max-height: 400px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
        }
        .log-entry {
            margin-bottom: 4px;
            line-height: 1.4;
        }
        .log-time {
            color: #808080;
            margin-right: 8px;
        }
        .log-type {
            font-weight: bold;
            margin-right: 8px;
        }
        .log-content {
            color: #d4d4d4;
        }
        .task-spec {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            padding: 12px;
            margin-bottom: 16px;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div class="header">
        <span class="title">${session.name}</span>
        <span class="status">${session.status}</span>
    </div>

    <div class="info-grid">
        <div class="info-card">
            <div class="info-label">Terminal Slot</div>
            <div class="info-value">${session.terminalSlot}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Iterations</div>
            <div class="info-value">${session.iterationCount} / ${session.maxIterations}</div>
        </div>
    </div>

    <div class="task-spec">${session.taskSpecification}</div>

    <div class="actions">
        ${session.status === 'pending' ? '<button class="btn btn-primary" onclick="action(\'start\')">Start</button>' : ''}
        ${session.status === 'running' ? '<button class="btn btn-secondary" onclick="action(\'pause\')">Pause</button>' : ''}
        ${session.status === 'paused' ? '<button class="btn btn-primary" onclick="action(\'resume\')">Resume</button>' : ''}
        ${['running', 'paused', 'initializing'].includes(session.status) ? '<button class="btn btn-danger" onclick="action(\'cancel\')">Cancel</button>' : ''}
    </div>

    <h3>Logs</h3>
    <div class="logs-container">
        ${logsHtml || '<div style="color: #808080">No logs yet</div>'}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        function action(cmd) {
            vscode.postMessage({ command: cmd });
        }
    </script>
</body>
</html>`;
}
