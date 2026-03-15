# VS Code Extension Rewrite — Phase 2: Agents + Orchestrator

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent session management (create from template, view list, real-time SSE logs, pause/resume/cancel) and orchestrator monitoring (status bar with slot count, on-demand detail panel with SSE-driven 12-slot grid).

**Architecture:** Builds on Phase 1 core services (EventBus, ApiClient, AuthService, ConfigService). Two new modules (`agents/`, `orchestrator/`) each register commands and panels. OrchestratorStatusBar polls when panel is closed; OrchestratorPanel uses SSE when open. EventBus bridges agent events to orchestrator status.

**Tech Stack:** TypeScript, VS Code Extension API, React 18, esbuild, SSE streaming (via ApiClient.stream)

**Spec:** `docs/superpowers/specs/2026-03-15-vscode-extension-rewrite-design.md`

---

## File Structure

```
vscode-extension/
├── src/
│   ├── extension.ts                              # Updated — bootstrap agents + orchestrator modules
│   ├── core/
│   │   └── types.ts                              # Updated — agent/orchestrator message types
│   ├── utils/
│   │   ├── constants.ts                          # Updated — agent/orchestrator API_PATHS
│   │   └── helpers.ts                            # Updated — getNonce() shared utility
│   ├── modules/
│   │   ├── agents/
│   │   │   ├── AgentService.ts                   # API calls, SSE log streaming
│   │   │   ├── AgentCommands.ts                  # New session, view sessions commands
│   │   │   └── AgentPanel.ts                     # WebviewPanel provider
│   │   └── orchestrator/
│   │       ├── OrchestratorService.ts            # API calls, SSE events, polling
│   │       ├── OrchestratorStatusBar.ts          # StatusBarItem with slot count
│   │       └── OrchestratorPanel.ts              # WebviewPanel provider
├── webview-ui/
│   ├── shared/
│   │   └── types.ts                              # Shared type definitions for webview components
│   ├── agents/
│   │   ├── index.tsx                             # Entry point
│   │   ├── AgentsApp.tsx                         # Main container
│   │   ├── SessionList.tsx                       # Active/completed/failed sessions
│   │   ├── SessionLogViewer.tsx                  # Real-time SSE log display
│   │   └── SessionActions.tsx                    # Pause/resume/cancel buttons
│   ├── orchestrator/
│   │   ├── index.tsx                             # Entry point
│   │   ├── OrchestratorApp.tsx                   # Main container
│   │   ├── SlotGrid.tsx                          # 12-slot visual grid
│   │   └── SlotDetail.tsx                        # Per-slot info (agent, duration, progress)
│   └── build.mjs                                 # Updated — add agents + orchestrator entries
├── test/
│   ├── modules/
│   │   ├── agents/
│   │   │   └── AgentService.test.ts
│   │   └── orchestrator/
│   │       ├── OrchestratorService.test.ts
│   │       └── OrchestratorStatusBar.test.ts
```

---

## Chunk 1: Core Types Update + Agent Service

### Task 1: Extend core types for agents and orchestrator

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add agent and orchestrator types to types.ts**

```typescript
// Append to src/core/types.ts — after existing types

// ---- Agent Types ----
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface AgentSession {
  id: string;
  templateId: string;
  templateName: string;
  prompt: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  error?: string;
  slotId?: number;
}

export interface AgentLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  sessionId: string;
}

// ---- Orchestrator Types ----
export interface OrchestratorStatus {
  activeSlots: number;
  totalSlots: number;
  slots: OrchestratorSlot[];
}

export interface OrchestratorSlot {
  id: number;
  busy: boolean;
  sessionId?: string;
  agentName?: string;
  startedAt?: string;
  progress?: number;
}

// ---- Agent Extension <-> Webview Messages ----
export type AgentExtensionToWebview =
  | { type: 'setSessions'; payload: { sessions: AgentSession[] } }
  | { type: 'sessionUpdated'; payload: { session: AgentSession } }
  | { type: 'logEntry'; payload: AgentLogEntry }
  | { type: 'logHistory'; payload: { entries: AgentLogEntry[] } }
  | { type: 'sseStatus'; payload: { connected: boolean; message?: string } }
  | { type: 'setAuthenticated'; payload: { user: UserInfo } }
  | { type: 'setUnauthenticated' };

export type AgentWebviewToExtension =
  | { type: 'ready' }
  | { type: 'loadSessions' }
  | { type: 'selectSession'; payload: { sessionId: string } }
  | { type: 'pauseSession'; payload: { sessionId: string } }
  | { type: 'resumeSession'; payload: { sessionId: string } }
  | { type: 'cancelSession'; payload: { sessionId: string } };

// ---- Orchestrator Extension <-> Webview Messages ----
export type OrchestratorExtensionToWebview =
  | { type: 'setStatus'; payload: OrchestratorStatus }
  | { type: 'slotUpdated'; payload: { slot: OrchestratorSlot } }
  | { type: 'sseStatus'; payload: { connected: boolean; message?: string } }
  | { type: 'setAuthenticated'; payload: { user: UserInfo } }
  | { type: 'setUnauthenticated' };

export type OrchestratorWebviewToExtension =
  | { type: 'ready' }
  | { type: 'releaseSlot'; payload: { slotId: number } }
  | { type: 'terminateSession'; payload: { sessionId: string } };
```

- [ ] **Step 2: Add API_PATHS constants for agents and orchestrator**

Append to `src/utils/constants.ts` inside the `API_PATHS` object:

```typescript
  // Agent paths
  AGENT_TEMPLATES: '/api/agents/templates',
  AGENT_SESSIONS: '/api/agents/sessions',
  // Orchestrator paths
  ORCHESTRATOR_STATUS: '/api/orchestrator/status',
  ORCHESTRATOR_EVENTS: '/api/orchestrator/events',
  ORCHESTRATOR_SLOT_RELEASE: '/api/orchestrator/slots',
```

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts src/utils/constants.ts
git commit -m "feat(ext): add agent and orchestrator types to core types and API_PATHS constants"
```

---

### Task 2: AgentService

**Files:**
- Create: `src/modules/agents/AgentService.ts`
- Create: `test/modules/agents/AgentService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/agents/AgentService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../../../src/modules/agents/AgentService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('AgentService', () => {
  let agentService: AgentService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    agentService = new AgentService(apiClient, eventBus, outputChannel);
  });

  it('should fetch agent templates', async () => {
    const templates = [
      { id: 't1', name: 'Code Review', description: 'Reviews code', category: 'dev' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(templates);

    const result = await agentService.getTemplates();
    expect(result).toEqual(templates);
  });

  it('should fetch sessions', async () => {
    const sessions = [
      {
        id: 's1', templateId: 't1', templateName: 'Code Review',
        prompt: 'Review this', status: 'running', createdAt: '', updatedAt: '',
      },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);

    const result = await agentService.getSessions();
    expect(result).toEqual(sessions);
  });

  it('should create a new session', async () => {
    const session = {
      id: 's2', templateId: 't1', templateName: 'Code Review',
      prompt: 'Fix bugs', status: 'running', createdAt: '', updatedAt: '',
    };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(session);

    const result = await agentService.createSession('t1', 'Fix bugs');
    expect(result).toEqual(session);
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions', {
      templateId: 't1',
      prompt: 'Fix bugs',
    });
  });

  it('should emit agent:started on session creation', async () => {
    const listener = vi.fn();
    eventBus.on('agent:started', listener);
    const session = {
      id: 's3', templateId: 't1', templateName: 'Test',
      prompt: 'Test', status: 'running', createdAt: '', updatedAt: '',
    };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(session);

    await agentService.createSession('t1', 'Test');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's3' });
  });

  it('should pause a session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await agentService.pauseSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/pause');
  });

  it('should resume a session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await agentService.resumeSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/resume');
  });

  it('should cancel a session and emit agent:completed', async () => {
    const listener = vi.fn();
    eventBus.on('agent:completed', listener);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await agentService.cancelSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/cancel');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's1', status: 'cancelled' });
  });

  it('should start log streaming for a session', () => {
    const onEntry = vi.fn();
    const onError = vi.fn();
    agentService.streamSessionLogs('s1', onEntry, onError);
    expect(apiClient.stream).toHaveBeenCalled();
  });

  it('should stop log streaming', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    agentService.streamSessionLogs('s1', vi.fn(), vi.fn());
    agentService.stopLogStream();
    expect(abortFn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/agents/AgentService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/agents/AgentService.ts
import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { AgentTemplate, AgentSession, AgentLogEntry, StreamChunk } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class AgentService {
  private logController: AbortController | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async getTemplates(): Promise<AgentTemplate[]> {
    const templates = await this.apiClient.get<AgentTemplate[]>(API_PATHS.AGENT_TEMPLATES);
    this.outputChannel.appendLine(`[Agents] Loaded ${templates.length} templates`);
    return templates;
  }

  async getSessions(): Promise<AgentSession[]> {
    return this.apiClient.get<AgentSession[]>(API_PATHS.AGENT_SESSIONS);
  }

  async createSession(templateId: string, prompt: string): Promise<AgentSession> {
    const session = await this.apiClient.post<AgentSession>(API_PATHS.AGENT_SESSIONS, {
      templateId,
      prompt,
    });
    this.eventBus.emit('agent:started', { sessionId: session.id });
    this.outputChannel.appendLine(`[Agents] Session created: ${session.id}`);
    return session;
  }

  async pauseSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/pause`);
    this.outputChannel.appendLine(`[Agents] Session paused: ${sessionId}`);
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/resume`);
    this.outputChannel.appendLine(`[Agents] Session resumed: ${sessionId}`);
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/cancel`);
    this.eventBus.emit('agent:completed', { sessionId, status: 'cancelled' });
    this.outputChannel.appendLine(`[Agents] Session cancelled: ${sessionId}`);
  }

  streamSessionLogs(
    sessionId: string,
    onEntry: (entry: AgentLogEntry) => void,
    onError: (error: Error) => void,
  ): void {
    this.stopLogStream();

    this.logController = this.apiClient.stream(
      `${API_PATHS.AGENT_SESSIONS}/${sessionId}/logs`,
      { stream: true },
      (chunk: StreamChunk) => {
        if (chunk.content) {
          try {
            const entry = JSON.parse(chunk.content) as AgentLogEntry;
            onEntry(entry);
          } catch {
            onEntry({
              timestamp: new Date().toISOString(),
              level: 'info',
              message: chunk.content,
              sessionId,
            });
          }
        }
        if (chunk.done) {
          this.outputChannel.appendLine(`[Agents] Log stream ended for: ${sessionId}`);
        }
      },
      onError,
    );
  }

  stopLogStream(): void {
    if (this.logController) {
      this.logController.abort();
      this.logController = null;
    }
  }

  dispose(): void {
    this.stopLogStream();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/agents/AgentService.test.ts
```
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/AgentService.ts test/modules/agents/AgentService.test.ts
git commit -m "feat(ext): add AgentService with templates, sessions, and SSE log streaming"
```

---

## Chunk 2: Agent Commands + Agent Panel

### Task 3: AgentCommands

**Files:**
- Create: `src/modules/agents/AgentCommands.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/modules/agents/AgentCommands.ts
import * as vscode from 'vscode';
import type { ModuleContext } from '../../core/types';
import { AgentService } from './AgentService';
import type { AgentPanel } from './AgentPanel';

export function registerAgentCommands(
  context: ModuleContext,
  agentService: AgentService,
  getPanel: () => AgentPanel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.newAgentSession', async () => {
      if (!context.authService.isAuthenticated()) {
        vscode.window.showWarningMessage('Login required to create agent sessions.');
        return;
      }

      try {
        const templates = await agentService.getTemplates();
        if (templates.length === 0) {
          vscode.window.showInformationMessage('No agent templates available.');
          return;
        }

        const items = templates.map((t) => ({
          label: t.name,
          description: t.category,
          detail: t.description,
          templateId: t.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select an agent template',
          matchOnDescription: true,
          matchOnDetail: true,
        });
        if (!selected) { return; }

        const prompt = await vscode.window.showInputBox({
          prompt: 'Enter the task prompt for the agent',
          placeHolder: 'e.g., Review the authentication module for security issues',
        });
        if (!prompt) { return; }

        const session = await agentService.createSession(selected.templateId, prompt);
        vscode.window.showInformationMessage(`Agent session started: ${session.id}`);

        getPanel().show();
        getPanel().selectSession(session.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to create agent session: ${message}`);
      }
    }),

    vscode.commands.registerCommand('enterprise-ai.viewAgentSessions', () => {
      if (!context.authService.isAuthenticated()) {
        vscode.window.showWarningMessage('Login required to view agent sessions.');
        return;
      }
      getPanel().show();
    }),
  ];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/agents/AgentCommands.ts
git commit -m "feat(ext): add agent commands (new session with template picker, view sessions)"
```

---

### Task 4: AgentPanel

**Files:**
- Create or update: `src/utils/helpers.ts`
- Create: `src/modules/agents/AgentPanel.ts`

- [ ] **Step 1: Extract getNonce() to utils/helpers.ts**

Add the `getNonce` utility so it can be shared by AgentPanel and OrchestratorPanel:

```typescript
// src/utils/helpers.ts — append or create

export function getNonce(): string {
  const array = new Uint8Array(16);
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Write implementation**

```typescript
// src/modules/agents/AgentPanel.ts
import * as vscode from 'vscode';
import type {
  ModuleContext,
  AgentExtensionToWebview,
  AgentWebviewToExtension,
  AgentLogEntry,
} from '../../core/types';
import { getNonce } from '../../utils/helpers';
import { AgentService } from './AgentService';

export class AgentPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly agentService: AgentService;
  private activeSessionId: string | null = null;

  constructor(
    private readonly context: ModuleContext,
    agentService: AgentService,
  ) {
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
      case 'loadSessions': {
        await this.refreshSessions();
        break;
      }
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

        this.postMessage({
          type: 'sseStatus',
          payload: { connected: true },
        });
        break;
      }
      case 'pauseSession': {
        try {
          await this.agentService.pauseSession(message.payload.sessionId);
          await this.refreshSessions();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to pause session: ${error}`);
        }
        break;
      }
      case 'resumeSession': {
        try {
          await this.agentService.resumeSession(message.payload.sessionId);
          await this.refreshSessions();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to resume session: ${error}`);
        }
        break;
      }
      case 'cancelSession': {
        try {
          await this.agentService.cancelSession(message.payload.sessionId);
          await this.refreshSessions();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to cancel session: ${error}`);
        }
        break;
      }
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
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
// getNonce() imported from utils/helpers.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/helpers.ts src/modules/agents/AgentPanel.ts
git commit -m "feat(ext): add AgentPanel with SSE log streaming and session actions"
```

---

## Chunk 3: Orchestrator Service + Status Bar

### Task 5: OrchestratorService

**Files:**
- Create: `src/modules/orchestrator/OrchestratorService.ts`
- Create: `test/modules/orchestrator/OrchestratorService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/orchestrator/OrchestratorService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorService } from '../../../src/modules/orchestrator/OrchestratorService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { ConfigService } from '../../../src/core/ConfigService';
import { createMockOutputChannel } from '../../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let apiClient: ApiClient;
  let eventBus: EventBus;
  let configService: ConfigService;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    configService = new ConfigService(eventBus);
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    service = new OrchestratorService(apiClient, eventBus, configService, outputChannel);
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it('should fetch orchestrator status', async () => {
    const status = {
      activeSlots: 3, totalSlots: 12,
      slots: [{ id: 0, busy: true, sessionId: 's1', agentName: 'Review', startedAt: '', progress: 50 }],
    };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);

    const result = await service.getStatus();
    expect(result).toEqual(status);
  });

  it('should emit orchestrator:update after fetching status', async () => {
    const listener = vi.fn();
    eventBus.on('orchestrator:update', listener);
    const status = { activeSlots: 5, totalSlots: 12, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);

    await service.getStatus();
    expect(listener).toHaveBeenCalledWith({ activeSlots: 5, totalSlots: 12 });
  });

  it('should start polling at configured interval', async () => {
    const status = { activeSlots: 0, totalSlots: 12, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);

    service.startPolling();
    expect(apiClient.get).toHaveBeenCalledTimes(1); // initial fetch

    await vi.advanceTimersByTimeAsync(10000);
    expect(apiClient.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10000);
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it('should stop polling', async () => {
    const status = { activeSlots: 0, totalSlots: 12, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);

    service.startPolling();
    service.stopPolling();

    await vi.advanceTimersByTimeAsync(20000);
    expect(apiClient.get).toHaveBeenCalledTimes(1); // only initial fetch
  });

  it('should start SSE event stream', () => {
    const onUpdate = vi.fn();
    const onError = vi.fn();
    service.startEventStream(onUpdate, onError);
    expect(apiClient.stream).toHaveBeenCalled();
  });

  it('should stop SSE event stream', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    service.startEventStream(vi.fn(), vi.fn());
    service.stopEventStream();
    expect(abortFn).toHaveBeenCalled();
  });

  it('should release a slot', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await service.releaseSlot(3);
    expect(apiClient.post).toHaveBeenCalledWith('/api/orchestrator/slots/3/release');
  });

  it('should terminate a session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await service.terminateSession('s5');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s5/cancel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/orchestrator/OrchestratorService.ts
import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { ConfigService } from '../../core/ConfigService';
import type { OrchestratorStatus, OrchestratorSlot, StreamChunk } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class OrchestratorService {
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private sseController: AbortController | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly configService: ConfigService,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async getStatus(): Promise<OrchestratorStatus> {
    const status = await this.apiClient.get<OrchestratorStatus>(API_PATHS.ORCHESTRATOR_STATUS);
    this.eventBus.emit('orchestrator:update', {
      activeSlots: status.activeSlots,
      totalSlots: status.totalSlots,
    });
    return status;
  }

  startPolling(): void {
    this.stopPolling();
    this.getStatus().catch((err) => {
      this.outputChannel.appendLine(`[Orchestrator] Polling error: ${err}`);
    });

    const interval = this.configService.getOrchestratorPollingInterval();
    this.pollingTimer = setInterval(() => {
      this.getStatus().catch((err) => {
        this.outputChannel.appendLine(`[Orchestrator] Polling error: ${err}`);
      });
    }, interval);
  }

  stopPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  startEventStream(
    onUpdate: (slot: OrchestratorSlot) => void,
    onError: (error: Error) => void,
  ): void {
    this.stopEventStream();

    this.sseController = this.apiClient.stream(
      API_PATHS.ORCHESTRATOR_EVENTS,
      { stream: true },
      (chunk: StreamChunk) => {
        if (chunk.content) {
          try {
            const slot = JSON.parse(chunk.content) as OrchestratorSlot;
            onUpdate(slot);
          } catch {
            this.outputChannel.appendLine(`[Orchestrator] Malformed SSE chunk: ${chunk.content}`);
          }
        }
      },
      onError,
    );
  }

  stopEventStream(): void {
    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
    }
  }

  async releaseSlot(slotId: number): Promise<void> {
    await this.apiClient.post(`${API_PATHS.ORCHESTRATOR_SLOT_RELEASE}/${slotId}/release`);
    this.outputChannel.appendLine(`[Orchestrator] Slot ${slotId} released`);
  }

  async terminateSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/cancel`);
    this.outputChannel.appendLine(`[Orchestrator] Session ${sessionId} terminated`);
  }

  dispose(): void {
    this.stopPolling();
    this.stopEventStream();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorService.test.ts
```
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/orchestrator/OrchestratorService.ts test/modules/orchestrator/OrchestratorService.test.ts
git commit -m "feat(ext): add OrchestratorService with polling, SSE events, and slot management"
```

---

### Task 6: OrchestratorStatusBar

**Files:**
- Create: `src/modules/orchestrator/OrchestratorStatusBar.ts`
- Create: `test/modules/orchestrator/OrchestratorStatusBar.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/orchestrator/OrchestratorStatusBar.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorStatusBar } from '../../../src/modules/orchestrator/OrchestratorStatusBar';
import { EventBus } from '../../../src/core/EventBus';
import { OrchestratorService } from '../../../src/modules/orchestrator/OrchestratorService';
import { ConfigService } from '../../../src/core/ConfigService';

const mockStatusBarItem = {
  text: '',
  tooltip: '',
  color: undefined as string | undefined,
  backgroundColor: undefined as unknown,
  command: undefined as string | undefined,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn().mockReturnValue(mockStatusBarItem),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class { constructor(public id: string) {} },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('OrchestratorStatusBar', () => {
  let statusBar: OrchestratorStatusBar;
  let eventBus: EventBus;
  let orchestratorService: OrchestratorService;
  let configService: ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    configService = new ConfigService(eventBus);
    orchestratorService = {
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      getStatus: vi.fn().mockResolvedValue({ activeSlots: 0, totalSlots: 12, slots: [] }),
      dispose: vi.fn(),
    } as unknown as OrchestratorService;
    statusBar = new OrchestratorStatusBar(eventBus, orchestratorService, configService);
  });

  afterEach(() => {
    statusBar.dispose();
  });

  it('should create status bar item with command', () => {
    expect(mockStatusBarItem.command).toBe('enterprise-ai.openOrchestrator');
  });

  it('should show status bar on auth:login', () => {
    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(mockStatusBarItem.show).toHaveBeenCalled();
    expect(orchestratorService.startPolling).toHaveBeenCalled();
  });

  it('should hide status bar on auth:logout', () => {
    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    eventBus.emit('auth:logout', undefined);
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
    expect(orchestratorService.stopPolling).toHaveBeenCalled();
  });

  it('should update text on orchestrator:update', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 3, totalSlots: 12 });
    expect(mockStatusBarItem.text).toBe('$(pulse) 3/12 slots');
  });

  it('should set green color when usage < 50%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 5, totalSlots: 12 });
    expect(mockStatusBarItem.color).toBeUndefined();
  });

  it('should set yellow color when usage 50-80%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 8, totalSlots: 12 });
    expect(mockStatusBarItem.color).toBeDefined();
  });

  it('should set red color when usage > 80%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 11, totalSlots: 12 });
    expect(mockStatusBarItem.color).toBeDefined();
  });

  it('should stop polling when panel opens', () => {
    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    statusBar.onPanelOpened();
    expect(orchestratorService.stopPolling).toHaveBeenCalled();
  });

  it('should resume polling when panel closes', () => {
    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    statusBar.onPanelOpened();
    statusBar.onPanelClosed();
    expect(orchestratorService.startPolling).toHaveBeenCalledTimes(2); // initial + resume
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorStatusBar.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/orchestrator/OrchestratorStatusBar.ts
import * as vscode from 'vscode';
import type { EventBus } from '../../core/EventBus';
import type { ConfigService } from '../../core/ConfigService';
import type { OrchestratorService } from './OrchestratorService';

export class OrchestratorStatusBar {
  private readonly item: vscode.StatusBarItem;
  private isAuthenticated = false;
  private isPanelOpen = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly orchestratorService: OrchestratorService,
    private readonly configService: ConfigService,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'enterprise-ai.openOrchestrator';
    this.item.text = '$(pulse) 0/0 slots';
    this.item.tooltip = 'Enterprise AI Orchestrator — Click to open dashboard';

    this.eventBus.on('auth:login', () => {
      this.isAuthenticated = true;
      if (this.configService.getOrchestratorShowStatusBar()) {
        this.item.show();
        if (!this.isPanelOpen) {
          this.orchestratorService.startPolling();
        }
      }
    });

    this.eventBus.on('auth:logout', () => {
      this.isAuthenticated = false;
      this.item.hide();
      this.orchestratorService.stopPolling();
    });

    this.eventBus.on('orchestrator:update', ({ activeSlots, totalSlots }) => {
      this.updateDisplay(activeSlots, totalSlots);
    });

    this.eventBus.on('config:changed', () => {
      if (!this.configService.getOrchestratorShowStatusBar()) {
        this.item.hide();
        this.orchestratorService.stopPolling();
      } else if (this.isAuthenticated) {
        this.item.show();
        if (!this.isPanelOpen) {
          this.orchestratorService.startPolling();
        }
      }
    });
  }

  onPanelOpened(): void {
    this.isPanelOpen = true;
    this.orchestratorService.stopPolling();
  }

  onPanelClosed(): void {
    this.isPanelOpen = false;
    if (this.isAuthenticated) {
      this.orchestratorService.startPolling();
    }
  }

  private updateDisplay(activeSlots: number, totalSlots: number): void {
    this.item.text = `$(pulse) ${activeSlots}/${totalSlots} slots`;

    const usage = totalSlots > 0 ? activeSlots / totalSlots : 0;

    if (usage > 0.8) {
      this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
      this.item.tooltip = `Enterprise AI Orchestrator — ${activeSlots}/${totalSlots} slots (HIGH LOAD)`;
    } else if (usage >= 0.5) {
      this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
      this.item.tooltip = `Enterprise AI Orchestrator — ${activeSlots}/${totalSlots} slots (moderate)`;
    } else {
      this.item.color = undefined;
      this.item.tooltip = `Enterprise AI Orchestrator — ${activeSlots}/${totalSlots} slots`;
    }
  }

  dispose(): void {
    this.item.dispose();
    this.orchestratorService.stopPolling();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorStatusBar.test.ts
```
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/orchestrator/OrchestratorStatusBar.ts test/modules/orchestrator/OrchestratorStatusBar.test.ts
git commit -m "feat(ext): add OrchestratorStatusBar with color-coded slot count and polling"
```

---

## Chunk 4: Orchestrator Panel

### Task 7: OrchestratorPanel

**Files:**
- Create: `src/modules/orchestrator/OrchestratorPanel.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/modules/orchestrator/OrchestratorPanel.ts
import * as vscode from 'vscode';
import type {
  ModuleContext,
  OrchestratorExtensionToWebview,
  OrchestratorWebviewToExtension,
  OrchestratorSlot,
} from '../../core/types';
import { getNonce } from '../../utils/helpers';
import { OrchestratorService } from './OrchestratorService';
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
      vscode.ViewColumn.Active,
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

    this.statusBar.onPanelOpened();

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.orchestratorService.stopEventStream();
      this.statusBar.onPanelClosed();
    });
  }

  postMessage(message: OrchestratorExtensionToWebview): void {
    this.panel?.webview.postMessage(message);
  }

  private async handleMessage(message: OrchestratorWebviewToExtension): Promise<void> {
    switch (message.type) {
      case 'ready': {
        if (this.context.authService.isAuthenticated()) {
          const user = this.context.authService.getUser();
          if (user) {
            this.postMessage({ type: 'setAuthenticated', payload: { user } });
          }
        }

        // Fetch initial status
        try {
          const status = await this.orchestratorService.getStatus();
          this.postMessage({ type: 'setStatus', payload: status });
        } catch (error) {
          this.context.outputChannel.appendLine(`[OrchestratorPanel] Failed to get status: ${error}`);
        }

        // Start SSE stream for live updates
        this.orchestratorService.startEventStream(
          (slot: OrchestratorSlot) => {
            this.postMessage({ type: 'slotUpdated', payload: { slot } });
          },
          (error: Error) => {
            this.postMessage({
              type: 'sseStatus',
              payload: { connected: false, message: `Connection lost — reconnecting... (${error.message})` },
            });
          },
        );

        this.postMessage({
          type: 'sseStatus',
          payload: { connected: true },
        });
        break;
      }
      case 'releaseSlot': {
        try {
          await this.orchestratorService.releaseSlot(message.payload.slotId);
          const status = await this.orchestratorService.getStatus();
          this.postMessage({ type: 'setStatus', payload: status });
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to release slot: ${error}`);
        }
        break;
      }
      case 'terminateSession': {
        try {
          await this.orchestratorService.terminateSession(message.payload.sessionId);
          const status = await this.orchestratorService.getStatus();
          this.postMessage({ type: 'setStatus', payload: status });
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to terminate session: ${error}`);
        }
        break;
      }
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
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
// getNonce() imported from utils/helpers.ts
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/orchestrator/OrchestratorPanel.ts
git commit -m "feat(ext): add OrchestratorPanel with SSE-driven slot grid and session actions"
```

---

## Chunk 5: Webview UI — Agents

### Task 8: Agents webview React app

**Files:**
- Create: `webview-ui/shared/types.ts`
- Create: `webview-ui/agents/index.tsx`
- Create: `webview-ui/agents/AgentsApp.tsx`
- Create: `webview-ui/agents/SessionList.tsx`
- Create: `webview-ui/agents/SessionLogViewer.tsx`
- Create: `webview-ui/agents/SessionActions.tsx`

- [ ] **Step 1: Create shared types for webview components**

```typescript
// webview-ui/shared/types.ts
// Shared type definitions for all webview components.
// Webview components import from here instead of redefining locally.

export interface AgentSession {
  id: string;
  templateId: string;
  templateName: string;
  prompt: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  error?: string;
  slotId?: number;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  sessionId: string;
}

export interface SseState {
  connected: boolean;
  message?: string;
}

export interface OrchestratorSlot {
  id: number;
  busy: boolean;
  sessionId?: string;
  agentName?: string;
  startedAt?: string;
  progress?: number;
}

export interface OrchestratorStatus {
  activeSlots: number;
  totalSlots: number;
  slots: OrchestratorSlot[];
}
```

- [ ] **Step 2: Write agents entry point**

```typescript
// webview-ui/agents/index.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AgentsApp } from './AgentsApp';

const root = createRoot(document.getElementById('root')!);
root.render(<AgentsApp />);
```

- [ ] **Step 3: Write AgentsApp (main container)**

```typescript
// webview-ui/agents/AgentsApp.tsx
// Types imported from shared/types.ts
import React, { useState, useCallback } from 'react';
import { useVsCodeMessage, usePostMessage } from '../shared/hooks/useVsCodeApi';
import { useAuth } from '../shared/hooks/useAuth';
import type { AgentSession, LogEntry, SseState } from '../shared/types';
import { SessionList } from './SessionList';
import { SessionLogViewer } from './SessionLogViewer';
import { SessionActions } from './SessionActions';

type ExtensionMessage =
  | { type: 'setSessions'; payload: { sessions: AgentSession[] } }
  | { type: 'sessionUpdated'; payload: { session: AgentSession } }
  | { type: 'logEntry'; payload: LogEntry }
  | { type: 'logHistory'; payload: { entries: LogEntry[] } }
  | { type: 'sseStatus'; payload: SseState }
  | { type: 'setAuthenticated'; payload: { user: { id: number; email: string; name: string; role: string } } }
  | { type: 'setUnauthenticated' };

export function AgentsApp() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sseStatus, setSseStatus] = useState<SseState>({ connected: false });
  const { isAuthenticated, setAuthenticated, setUnauthenticated } = useAuth();
  const postMessage = usePostMessage();

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  useVsCodeMessage<ExtensionMessage>((msg) => {
    switch (msg.type) {
      case 'setSessions':
        setSessions(msg.payload.sessions);
        break;
      case 'sessionUpdated': {
        const updated = msg.payload.session;
        setSessions((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s)),
        );
        break;
      }
      case 'logEntry':
        setLogs((prev) => [...prev, msg.payload]);
        break;
      case 'logHistory':
        setLogs(msg.payload.entries);
        break;
      case 'sseStatus':
        setSseStatus(msg.payload);
        break;
      case 'setAuthenticated':
        setAuthenticated(msg.payload.user);
        break;
      case 'setUnauthenticated':
        setUnauthenticated();
        setSessions([]);
        setLogs([]);
        setSelectedSessionId(null);
        break;
    }
  });

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setLogs([]);
    postMessage({ type: 'selectSession', payload: { sessionId } });
  }, [postMessage]);

  const handlePause = useCallback((sessionId: string) => {
    postMessage({ type: 'pauseSession', payload: { sessionId } });
  }, [postMessage]);

  const handleResume = useCallback((sessionId: string) => {
    postMessage({ type: 'resumeSession', payload: { sessionId } });
  }, [postMessage]);

  const handleCancel = useCallback((sessionId: string) => {
    postMessage({ type: 'cancelSession', payload: { sessionId } });
  }, [postMessage]);

  const handleRefresh = useCallback(() => {
    postMessage({ type: 'loadSessions' });
  }, [postMessage]);

  // Signal ready on mount
  React.useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Login required. Use <strong>Enterprise AI: Login</strong> from the Command Palette.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{
        width: 280,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <strong>Agent Sessions</strong>
          <button
            onClick={handleRefresh}
            style={{ padding: '2px 8px', fontSize: '12px' }}
            title="Refresh sessions"
          >
            Refresh
          </button>
        </div>
        <SessionList
          sessions={sessions}
          selectedId={selectedSessionId}
          onSelect={handleSelectSession}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedSession ? (
          <>
            <div style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <strong>{selectedSession.templateName}</strong>
                <span style={{
                  marginLeft: 8,
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 11,
                  background: getStatusColor(selectedSession.status),
                  color: '#fff',
                }}>
                  {selectedSession.status}
                </span>
              </div>
              <SessionActions
                session={selectedSession}
                onPause={handlePause}
                onResume={handleResume}
                onCancel={handleCancel}
              />
            </div>

            {!sseStatus.connected && sseStatus.message && (
              <div className="error-banner">
                {sseStatus.message}
              </div>
            )}

            <SessionLogViewer logs={logs} />

            {selectedSession.error && (
              <div className="error-banner" style={{ margin: '0 8px 8px 8px' }}>
                Error: {selectedSession.error}
              </div>
            )}
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
          }}>
            Select a session to view logs
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'running': return '#2ea043';
    case 'paused': return '#d29922';
    case 'completed': return '#388bfd';
    case 'failed': return '#f85149';
    case 'cancelled': return '#8b949e';
    default: return '#8b949e';
  }
}
```

- [ ] **Step 4: Write SessionList**

```typescript
// webview-ui/agents/SessionList.tsx
// Types imported from shared/types.ts
import React from 'react';
import type { AgentSession } from '../shared/types';

interface SessionListProps {
  sessions: AgentSession[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  const grouped = groupByStatus(sessions);

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {grouped.active.length > 0 && (
        <SessionGroup label="Active" sessions={grouped.active} selectedId={selectedId} onSelect={onSelect} />
      )}
      {grouped.completed.length > 0 && (
        <SessionGroup label="Completed" sessions={grouped.completed} selectedId={selectedId} onSelect={onSelect} />
      )}
      {grouped.failed.length > 0 && (
        <SessionGroup label="Failed" sessions={grouped.failed} selectedId={selectedId} onSelect={onSelect} />
      )}
      {sessions.length === 0 && (
        <div style={{ padding: '16px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
          No sessions. Use <em>Enterprise AI: New Agent Session</em> to start one.
        </div>
      )}
    </div>
  );
}

interface SessionGroupProps {
  label: string;
  sessions: AgentSession[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}

function SessionGroup({ label, sessions, selectedId, onSelect }: SessionGroupProps) {
  return (
    <div>
      <div style={{
        padding: '6px 12px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        letterSpacing: '0.5px',
      }}>
        {label} ({sessions.length})
      </div>
      {sessions.map((session) => (
        <div
          key={session.id}
          onClick={() => onSelect(session.id)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            borderLeft: session.id === selectedId ? '3px solid var(--accent)' : '3px solid transparent',
            background: session.id === selectedId ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelect(session.id); }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {session.templateName}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 2,
          }}>
            {session.prompt}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
            {formatRelativeTime(session.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupByStatus(sessions: AgentSession[]) {
  const active: AgentSession[] = [];
  const completed: AgentSession[] = [];
  const failed: AgentSession[] = [];

  for (const session of sessions) {
    if (session.status === 'running' || session.status === 'paused') {
      active.push(session);
    } else if (session.status === 'completed') {
      completed.push(session);
    } else {
      failed.push(session);
    }
  }

  return { active, completed, failed };
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}
```

- [ ] **Step 5: Write SessionLogViewer**

```typescript
// webview-ui/agents/SessionLogViewer.tsx
// Types imported from shared/types.ts
import React, { useEffect, useRef } from 'react';
import type { LogEntry } from '../shared/types';

interface SessionLogViewerProps {
  logs: LogEntry[];
}

export function SessionLogViewer({ logs }: SessionLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !autoScrollRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [logs]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const threshold = 50;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    autoScrollRef.current = isNearBottom;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        fontSize: 12,
        lineHeight: 1.6,
        padding: '8px 12px',
        background: 'var(--bg-secondary)',
      }}
    >
      {logs.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', padding: '16px 0' }}>
          Waiting for log output...
        </div>
      )}
      {logs.map((entry, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 8,
            padding: '1px 0',
            color: getLevelColor(entry.level),
          }}
        >
          <span style={{ color: 'var(--text-secondary)', flexShrink: 0, minWidth: 75 }}>
            {formatTimestamp(entry.timestamp)}
          </span>
          <span style={{
            flexShrink: 0,
            minWidth: 40,
            fontWeight: entry.level === 'error' ? 600 : 400,
          }}>
            [{entry.level.toUpperCase()}]
          </span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {entry.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function getLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'var(--error)';
    case 'warn': return 'var(--vscode-editorWarning-foreground, #d29922)';
    case 'debug': return 'var(--text-secondary)';
    default: return 'var(--text-primary)';
  }
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}
```

- [ ] **Step 6: Write SessionActions**

```typescript
// webview-ui/agents/SessionActions.tsx
// Types imported from shared/types.ts
import React from 'react';
import type { AgentSession } from '../shared/types';

interface SessionActionsProps {
  session: AgentSession;
  onPause: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onCancel: (sessionId: string) => void;
}

export function SessionActions({ session, onPause, onResume, onCancel }: SessionActionsProps) {
  const isActive = session.status === 'running' || session.status === 'paused';

  if (!isActive) {
    return null;
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {session.status === 'running' && (
        <button
          onClick={() => onPause(session.id)}
          style={{
            padding: '3px 10px',
            fontSize: 12,
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
          }}
          title="Pause session"
        >
          Pause
        </button>
      )}
      {session.status === 'paused' && (
        <button
          onClick={() => onResume(session.id)}
          style={{
            padding: '3px 10px',
            fontSize: 12,
          }}
          title="Resume session"
        >
          Resume
        </button>
      )}
      <button
        onClick={() => onCancel(session.id)}
        style={{
          padding: '3px 10px',
          fontSize: 12,
          background: 'var(--vscode-inputValidation-errorBackground)',
          color: 'var(--error)',
        }}
        title="Cancel session"
      >
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Build and verify**

```bash
cd vscode-extension/webview-ui && node build.mjs
```
Expected: `out/agentsWebview.js` created without errors.

- [ ] **Step 8: Commit**

```bash
git add webview-ui/shared/types.ts webview-ui/agents/
git commit -m "feat(ext): add agents webview React app with session list, log viewer, and actions"
```

---

## Chunk 6: Webview UI — Orchestrator

### Task 9: Orchestrator webview React app

**Files:**
- Create: `webview-ui/orchestrator/index.tsx`
- Create: `webview-ui/orchestrator/OrchestratorApp.tsx`
- Create: `webview-ui/orchestrator/SlotGrid.tsx`
- Create: `webview-ui/orchestrator/SlotDetail.tsx`

- [ ] **Step 1: Write orchestrator entry point**

```typescript
// webview-ui/orchestrator/index.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OrchestratorApp } from './OrchestratorApp';

const root = createRoot(document.getElementById('root')!);
root.render(<OrchestratorApp />);
```

- [ ] **Step 2: Write OrchestratorApp (main container)**

```typescript
// webview-ui/orchestrator/OrchestratorApp.tsx
// Types imported from shared/types.ts
import React, { useState, useCallback, useEffect } from 'react';
import { useVsCodeMessage, usePostMessage } from '../shared/hooks/useVsCodeApi';
import { useAuth } from '../shared/hooks/useAuth';
import type { OrchestratorSlot, OrchestratorStatus, SseState } from '../shared/types';
import { SlotGrid } from './SlotGrid';
import { SlotDetail } from './SlotDetail';

type ExtensionMessage =
  | { type: 'setStatus'; payload: OrchestratorStatus }
  | { type: 'slotUpdated'; payload: { slot: OrchestratorSlot } }
  | { type: 'sseStatus'; payload: SseState }
  | { type: 'setAuthenticated'; payload: { user: { id: number; email: string; name: string; role: string } } }
  | { type: 'setUnauthenticated' };

export function OrchestratorApp() {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [sseStatus, setSseStatus] = useState<SseState>({ connected: false });
  const { isAuthenticated, setAuthenticated, setUnauthenticated } = useAuth();
  const postMessage = usePostMessage();

  useVsCodeMessage<ExtensionMessage>((msg) => {
    switch (msg.type) {
      case 'setStatus':
        setStatus(msg.payload);
        break;
      case 'slotUpdated': {
        const updatedSlot = msg.payload.slot;
        setStatus((prev) => {
          if (!prev) return prev;
          const newSlots = prev.slots.map((s) =>
            s.id === updatedSlot.id ? updatedSlot : s,
          );
          const activeSlots = newSlots.filter((s) => s.busy).length;
          return { ...prev, slots: newSlots, activeSlots };
        });
        break;
      }
      case 'sseStatus':
        setSseStatus(msg.payload);
        break;
      case 'setAuthenticated':
        setAuthenticated(msg.payload.user);
        break;
      case 'setUnauthenticated':
        setUnauthenticated();
        setStatus(null);
        setSelectedSlotId(null);
        break;
    }
  });

  const handleReleaseSlot = useCallback((slotId: number) => {
    postMessage({ type: 'releaseSlot', payload: { slotId } });
  }, [postMessage]);

  const handleTerminateSession = useCallback((sessionId: string) => {
    postMessage({ type: 'terminateSession', payload: { sessionId } });
  }, [postMessage]);

  useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  const selectedSlot = status?.slots.find((s) => s.id === selectedSlotId) ?? null;

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Login required. Use <strong>Enterprise AI: Login</strong> from the Command Palette.</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading orchestrator status...
      </div>
    );
  }

  const usage = status.totalSlots > 0 ? status.activeSlots / status.totalSlots : 0;
  const usageLabel = usage > 0.8 ? 'HIGH LOAD' : usage >= 0.5 ? 'Moderate' : 'Normal';
  const usageColor = usage > 0.8 ? '#f85149' : usage >= 0.5 ? '#d29922' : '#2ea043';

  return (
    <div style={{ padding: 16, height: '100vh', overflow: 'auto' }}>
      {!sseStatus.connected && sseStatus.message && (
        <div className="error-banner" style={{ marginBottom: 12 }}>
          {sseStatus.message}
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Orchestrator Dashboard
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14 }}>
            <strong>{status.activeSlots}</strong>/{status.totalSlots} slots
          </span>
          <span style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            background: usageColor,
            color: '#fff',
          }}>
            {usageLabel}
          </span>
        </div>
      </div>

      <SlotGrid
        slots={status.slots}
        selectedSlotId={selectedSlotId}
        onSelectSlot={setSelectedSlotId}
      />

      {selectedSlot && selectedSlot.busy && (
        <SlotDetail
          slot={selectedSlot}
          onRelease={handleReleaseSlot}
          onTerminate={handleTerminateSession}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write SlotGrid**

```typescript
// webview-ui/orchestrator/SlotGrid.tsx
// Types imported from shared/types.ts
import React from 'react';
import type { OrchestratorSlot } from '../shared/types';

interface SlotGridProps {
  slots: OrchestratorSlot[];
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
}

export function SlotGrid({ slots, selectedSlotId, onSelectSlot }: SlotGridProps) {
  // Ensure we always show 12 slots even if API returns fewer
  const normalizedSlots: OrchestratorSlot[] = Array.from({ length: 12 }, (_, i) => {
    const existing = slots.find((s) => s.id === i);
    return existing ?? { id: i, busy: false };
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 8,
      marginBottom: 16,
    }}>
      {normalizedSlots.map((slot) => (
        <div
          key={slot.id}
          onClick={() => onSelectSlot(slot.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelectSlot(slot.id); }}
          style={{
            padding: 12,
            borderRadius: 6,
            border: slot.id === selectedSlotId
              ? '2px solid var(--accent)'
              : '1px solid var(--border)',
            background: slot.busy
              ? 'var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.15))'
              : 'var(--bg-secondary)',
            cursor: slot.busy ? 'pointer' : 'default',
            transition: 'border-color 0.15s',
            minHeight: 80,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}>
              Slot {slot.id}
            </span>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: slot.busy ? '#2ea043' : '#484f58',
              flexShrink: 0,
            }} />
          </div>

          {slot.busy ? (
            <div style={{ marginTop: 6 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {slot.agentName ?? 'Agent'}
              </div>
              {slot.progress !== undefined && (
                <div style={{
                  marginTop: 4,
                  height: 3,
                  borderRadius: 2,
                  background: 'var(--vscode-progressBar-background, #0078d4)',
                  width: `${Math.min(100, Math.max(0, slot.progress))}%`,
                  transition: 'width 0.3s ease',
                }} />
              )}
              <div style={{
                fontSize: 10,
                color: 'var(--text-secondary)',
                marginTop: 4,
              }}>
                {slot.startedAt ? formatDuration(slot.startedAt) : ''}
              </div>
            </div>
          ) : (
            <div style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              marginTop: 6,
            }}>
              Free
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatDuration(startedAt: string): string {
  if (!startedAt) return '';
  try {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - start) / 1000);

    if (diffSec < 60) return `${diffSec}s`;
    const min = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    if (min < 60) return `${min}m ${sec}s`;
    const hrs = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hrs}h ${remMin}m`;
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Write SlotDetail**

```typescript
// webview-ui/orchestrator/SlotDetail.tsx
// Types imported from shared/types.ts
import React, { useState } from 'react';
import type { OrchestratorSlot } from '../shared/types';

interface SlotDetailProps {
  slot: OrchestratorSlot;
  onRelease: (slotId: number) => void;
  onTerminate: (sessionId: string) => void;
}

export function SlotDetail({ slot, onRelease, onTerminate }: SlotDetailProps) {
  const [confirmAction, setConfirmAction] = useState<'release' | 'terminate' | null>(null);

  const handleRelease = () => {
    if (confirmAction === 'release') {
      onRelease(slot.id);
      setConfirmAction(null);
    } else {
      setConfirmAction('release');
    }
  };

  const handleTerminate = () => {
    if (confirmAction === 'terminate' && slot.sessionId) {
      onTerminate(slot.sessionId);
      setConfirmAction(null);
    } else {
      setConfirmAction('terminate');
    }
  };

  const handleCancelConfirm = () => {
    setConfirmAction(null);
  };

  return (
    <div style={{
      padding: 16,
      border: '1px solid var(--border)',
      borderRadius: 6,
      background: 'var(--bg-secondary)',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 14 }}>
        Slot {slot.id} Detail
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Agent:</span>
        <span>{slot.agentName ?? 'Unknown'}</span>

        <span style={{ color: 'var(--text-secondary)' }}>Session ID:</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{slot.sessionId ?? '—'}</span>

        <span style={{ color: 'var(--text-secondary)' }}>Started:</span>
        <span>{slot.startedAt ? new Date(slot.startedAt).toLocaleString() : '—'}</span>

        <span style={{ color: 'var(--text-secondary)' }}>Progress:</span>
        <span>{slot.progress !== undefined ? `${slot.progress}%` : '—'}</span>
      </div>

      {slot.progress !== undefined && (
        <div style={{
          marginTop: 12,
          height: 6,
          borderRadius: 3,
          background: 'var(--vscode-editor-background)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            borderRadius: 3,
            background: 'var(--vscode-progressBar-background, #0078d4)',
            width: `${Math.min(100, Math.max(0, slot.progress))}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          onClick={handleRelease}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            background: confirmAction === 'release'
              ? 'var(--vscode-inputValidation-warningBackground)'
              : 'var(--vscode-button-secondaryBackground)',
            color: confirmAction === 'release'
              ? 'var(--vscode-editorWarning-foreground)'
              : 'var(--vscode-button-secondaryForeground)',
          }}
          title={confirmAction === 'release' ? 'Click again to confirm' : 'Release this slot'}
        >
          {confirmAction === 'release' ? 'Confirm Release' : 'Release Slot'}
        </button>

        {slot.sessionId && (
          <button
            onClick={handleTerminate}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              background: confirmAction === 'terminate'
                ? 'var(--vscode-inputValidation-errorBackground)'
                : 'var(--vscode-button-secondaryBackground)',
              color: confirmAction === 'terminate'
                ? 'var(--error)'
                : 'var(--vscode-button-secondaryForeground)',
            }}
            title={confirmAction === 'terminate' ? 'Click again to confirm' : 'Terminate the associated session'}
          >
            {confirmAction === 'terminate' ? 'Confirm Terminate' : 'Terminate Session'}
          </button>
        )}

        {confirmAction && (
          <button
            onClick={handleCancelConfirm}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build and verify**

```bash
cd vscode-extension/webview-ui && node build.mjs
```
Expected: `out/orchestratorWebview.js` created without errors.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/orchestrator/
git commit -m "feat(ext): add orchestrator webview React app with slot grid and detail panel"
```

---

## Chunk 7: Build Config Update + Extension Entry Point + Integration

### Task 10: Update build.mjs for new entry points

**Files:**
- Modify: `webview-ui/build.mjs`

- [ ] **Step 1: Update entries array in build.mjs**

Replace the `entries` array:

```javascript
const entries = [
  { in: 'chat/index.tsx', out: '../out/chatWebview' },
  { in: 'agents/index.tsx', out: '../out/agentsWebview' },
  { in: 'orchestrator/index.tsx', out: '../out/orchestratorWebview' },
];
```

- [ ] **Step 2: Build all webviews**

```bash
cd vscode-extension/webview-ui && node build.mjs
```
Expected: `out/chatWebview.js`, `out/agentsWebview.js`, `out/orchestratorWebview.js`, `out/theme.css` all created.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/build.mjs
git commit -m "feat(ext): add agents and orchestrator entry points to webview build config"
```

---

### Task 11: Update extension.ts to bootstrap agents and orchestrator modules

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Update extension.ts**

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { EventBus } from './core/EventBus';
import { ConfigService } from './core/ConfigService';
import { ApiClient } from './core/ApiClient';
import { AuthService } from './core/AuthService';
import { ChatPanel } from './modules/chat/ChatPanel';
import { registerChatCommands } from './modules/chat/ChatCommands';
import { registerCodeActionCommands } from './modules/code-actions/CodeActionCommands';
import { EnterpriseAICodeActionProvider } from './modules/code-actions/CodeActionProvider';
import { AgentService } from './modules/agents/AgentService';
import { AgentPanel } from './modules/agents/AgentPanel';
import { registerAgentCommands } from './modules/agents/AgentCommands';
import { OrchestratorService } from './modules/orchestrator/OrchestratorService';
import { OrchestratorStatusBar } from './modules/orchestrator/OrchestratorStatusBar';
import { OrchestratorPanel } from './modules/orchestrator/OrchestratorPanel';
import { OUTPUT_CHANNEL_NAME } from './utils/constants';
import type { ModuleContext } from './core/types';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  outputChannel.appendLine('[Extension] Activating Enterprise AI...');

  // Core services
  const eventBus = new EventBus();
  const configService = new ConfigService(eventBus);
  const apiClient = new ApiClient(configService, eventBus, outputChannel);
  const authService = new AuthService(apiClient, eventBus, context, outputChannel);

  const moduleContext: ModuleContext = {
    extensionContext: context,
    apiClient,
    authService,
    configService,
    eventBus,
    outputChannel,
  };

  // Chat panel (lazy)
  let chatPanel: ChatPanel | null = null;
  const getChatPanel = (): ChatPanel => {
    if (!chatPanel) {
      chatPanel = new ChatPanel(moduleContext);
    }
    return chatPanel;
  };

  // Agents module
  const agentService = new AgentService(apiClient, eventBus, outputChannel);
  let agentPanel: AgentPanel | null = null;
  const getAgentPanel = (): AgentPanel => {
    if (!agentPanel) {
      agentPanel = new AgentPanel(moduleContext, agentService);
    }
    return agentPanel;
  };

  // Orchestrator module
  const orchestratorService = new OrchestratorService(apiClient, eventBus, configService, outputChannel);
  const orchestratorStatusBar = new OrchestratorStatusBar(eventBus, orchestratorService, configService);
  let orchestratorPanel: OrchestratorPanel | null = null;
  const getOrchestratorPanel = (): OrchestratorPanel => {
    if (!orchestratorPanel) {
      orchestratorPanel = new OrchestratorPanel(moduleContext, orchestratorService, orchestratorStatusBar);
    }
    return orchestratorPanel;
  };

  // Register commands
  const disposables = [
    ...registerChatCommands(moduleContext, getChatPanel),
    ...registerCodeActionCommands(getChatPanel),
    ...registerAgentCommands(moduleContext, agentService, getAgentPanel),
    vscode.commands.registerCommand('enterprise-ai.openOrchestrator', () => {
      if (!authService.isAuthenticated()) {
        vscode.window.showWarningMessage('Login required to open orchestrator.');
        return;
      }
      getOrchestratorPanel().show();
    }),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new EnterpriseAICodeActionProvider(),
      { providedCodeActionKinds: EnterpriseAICodeActionProvider.providedCodeActionKinds },
    ),
  ];

  context.subscriptions.push(
    ...disposables,
    orchestratorStatusBar,
    { dispose: () => orchestratorService.dispose() },
    { dispose: () => agentService.dispose() },
    outputChannel,
  );

  // Restore session
  authService.tryRestoreSession();
  outputChannel.appendLine('[Extension] Activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
```

- [ ] **Step 2: Full build test**

```bash
cd vscode-extension && npm run build:all
```
Expected: `out/extension.js`, `out/chatWebview.js`, `out/agentsWebview.js`, `out/orchestratorWebview.js`, `out/theme.css` all created.

- [ ] **Step 3: Run all tests**

```bash
cd vscode-extension && npm run test
```
Expected: All tests pass (core + agents + orchestrator).

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ext): bootstrap agents and orchestrator modules in extension entry point"
```

---

### Task 12: Final integration verification

- [ ] **Step 1: Run full test suite and verify coverage**

```bash
cd vscode-extension && npx vitest run --coverage
```
Expected: 80%+ coverage on core/ and modules/.

- [ ] **Step 2: Package VSIX**

```bash
cd vscode-extension && npm run package
```
Expected: VSIX created without errors.

- [ ] **Step 3: Commit if any fixes were needed**

```bash
git add src/ webview-ui/ test/ && git commit -m "fix(ext): Phase 2 integration fixes" || echo "Nothing to commit"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1-2 | Agent/orchestrator types, AgentService with templates + sessions + SSE logs |
| 2 | 3-4 | AgentCommands (template picker + prompt), AgentPanel (webview provider with SSE) |
| 3 | 5-6 | OrchestratorService (polling + SSE + slot management), OrchestratorStatusBar (color-coded) |
| 4 | 7 | OrchestratorPanel (webview provider with SSE-driven slot updates) |
| 5 | 8 | Agents webview React app (SessionList, SessionLogViewer, SessionActions) |
| 6 | 9 | Orchestrator webview React app (SlotGrid, SlotDetail) |
| 7 | 10-12 | Build config update, extension.ts integration, full build + test verification |

**Total tasks:** 12
**Total commits:** ~12
**New files:** 19
**Modified files:** 4 (types.ts, constants.ts, build.mjs, extension.ts)
**Updated files:** 1 (helpers.ts — getNonce extracted)
**Coverage target:** 80%+ on core/ and modules/
