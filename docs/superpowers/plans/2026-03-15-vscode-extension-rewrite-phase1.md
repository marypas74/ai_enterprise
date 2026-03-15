# VS Code Extension Rewrite — Phase 1: Core + Chat (MVP)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the VS Code extension with modular architecture: core service layer + chat panel + code actions. Remove direct Claude mode.

**Architecture:** Slim entry point bootstraps independent modules. Core services (ApiClient, AuthService, ConfigService, EventBus) are injected into modules. Each module registers its own commands and panels. Webview uses React 18 with esbuild.

**Tech Stack:** TypeScript, VS Code Extension API, React 18, esbuild, Axios, SSE streaming

**Spec:** `docs/superpowers/specs/2026-03-15-vscode-extension-rewrite-design.md`

---

## File Structure

```
vscode-extension/
├── src/
│   ├── extension.ts                         # Entry point (~50 lines)
│   ├── core/
│   │   ├── types.ts                         # Shared types + message protocol
│   │   ├── EventBus.ts                      # Typed event emitter
│   │   ├── ConfigService.ts                 # VS Code settings wrapper
│   │   ├── ApiClient.ts                     # HTTP + SSE client
│   │   └── AuthService.ts                   # Login, JWT, refresh
│   ├── modules/
│   │   ├── chat/
│   │   │   ├── ChatPanel.ts                 # WebviewPanel provider
│   │   │   ├── ChatCommands.ts              # Command registration
│   │   │   └── ChatService.ts               # Chat logic, streaming
│   │   └── code-actions/
│   │       ├── CodeActionProvider.ts         # VS Code CodeActionProvider
│   │       └── CodeActionCommands.ts         # Explain/fix/improve/tests
│   └── utils/
│       ├── constants.ts                     # Defaults, config keys
│       └── helpers.ts                       # Shared utilities
├── webview-ui/
│   ├── shared/
│   │   ├── components/
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── CodeBlock.tsx
│   │   │   ├── StreamingText.tsx
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── ErrorBanner.tsx
│   │   │   └── ModelPicker.tsx
│   │   ├── hooks/
│   │   │   ├── useVsCodeApi.ts
│   │   │   ├── useStreaming.ts
│   │   │   ├── useModels.ts
│   │   │   └── useAuth.ts
│   │   └── theme/
│   │       └── main.css
│   ├── chat/
│   │   ├── index.tsx
│   │   ├── ChatApp.tsx
│   │   ├── MessageArea.tsx
│   │   ├── ChatInput.tsx
│   │   └── ConversationList.tsx
│   └── build.mjs
├── test/
│   ├── core/
│   │   ├── EventBus.test.ts
│   │   ├── ConfigService.test.ts
│   │   ├── ApiClient.test.ts
│   │   └── AuthService.test.ts
│   ├── modules/
│   │   ├── chat/ChatService.test.ts
│   │   └── code-actions/CodeActionProvider.test.ts
│   └── setup.ts
└── package.json
```

---

## Chunk 1: Project Setup + Core Types + EventBus

### Task 1: Initialize project structure

**Files:**
- Create: `src/core/types.ts`
- Create: `src/utils/constants.ts`
- Modify: `package.json` (update settings, commands, remove Claude direct)
- Create: `test/setup.ts`

- [ ] **Step 1: Create directory structure**

```bash
cd vscode-extension
mkdir -p src/core src/modules/chat src/modules/code-actions src/utils
mkdir -p webview-ui/shared/components webview-ui/shared/hooks webview-ui/shared/theme
mkdir -p webview-ui/chat
mkdir -p test/core test/modules/chat test/modules/code-actions
```

- [ ] **Step 2: Create constants.ts**

```typescript
// src/utils/constants.ts
export const CONFIG_SECTION = 'enterprise-ai';

export const CONFIG_KEYS = {
  SERVER_URL: 'serverUrl',
  ALLOW_SELF_SIGNED: 'allowSelfSignedCerts',
  BOT_ICON_STYLE: 'botIconStyle',
  ORCHESTRATOR_POLLING: 'orchestrator.pollingInterval',
  ORCHESTRATOR_SHOW: 'orchestrator.showStatusBar',
} as const;

export const WEBVIEW_DEPS = [
  'react@^18.2.0',
  'react-dom@^18.2.0',
  'react-markdown@^9.0.1',
  'remark-gfm@^4.0.0',
  'react-syntax-highlighter@^16.1.0',
  '@types/react@^18.2.0',
  '@types/react-dom@^18.2.0',
  '@types/react-syntax-highlighter@^15.5.0',
] as const;

export const DEFAULTS = {
  SERVER_URL: 'https://plane.lushlolli.com',
  ALLOW_SELF_SIGNED: false,
  ORCHESTRATOR_POLLING: 10000,
  ORCHESTRATOR_SHOW: true,
} as const;

export const API_PATHS = {
  LOGIN: '/api/auth/login',
  MODELS: '/api/chat/models',
  COMPLETIONS: '/api/chat/completions',
  CONVERSATIONS: '/api/chat/conversations',
  DOCUMENTS: '/api/documents',
  AGENT_SESSIONS: '/api/agents/sessions',
  AGENT_TEMPLATES: '/api/agents/templates',
  ORCHESTRATOR_STATUS: '/api/orchestrator/status',
  ORCHESTRATOR_EVENTS: '/api/orchestrator/events',
  ORCHESTRATOR_WORKTREES: '/api/orchestrator/worktrees',
  TOOLS_GENERATE_DOCX: '/api/tools/generate-docx',
  TOOLS_GENERATE_EXCEL: '/api/tools/generate-excel',
  TOOLS_GENERATE_PPTX: '/api/tools/generate-pptx',
  TOOLS_CONVERT_PDF: '/api/tools/convert-to-pdf',
} as const;

export const OUTPUT_CHANNEL_NAME = 'Enterprise AI';
```

- [ ] **Step 3: Create core types.ts with message protocol**

```typescript
// src/core/types.ts

// ---- Event Bus ----
export interface EventMap {
  'auth:login': { userId: string; email: string };
  'auth:logout': void;
  'config:changed': { key: string; value: unknown };
  'models:loaded': { models: AIModel[] };
  'agent:started': { sessionId: string };
  'agent:completed': { sessionId: string; status: 'success' | 'failed' };
  'worktree:ready': { sessionId: string; branch: string };
  'orchestrator:update': { activeSlots: number; totalSlots: number };
}

// ---- API ----
export interface AIModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  totp?: string;
}

export interface LoginResponse {
  token: string;
  user: UserInfo;
}

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StreamChunk {
  content?: string;
  done?: boolean;
  conversationId?: number;
  error?: string;
  thinking?: string;
}

// ---- Extension <-> Webview Messages ----
export type ExtensionToWebview =
  | { type: 'streamChunk'; payload: StreamChunk }
  | { type: 'streamEnd' }
  | { type: 'streamError'; payload: { message: string } }
  | { type: 'setAuthenticated'; payload: { user: UserInfo; models: AIModel[] } }
  | { type: 'setUnauthenticated' }
  | { type: 'setModels'; payload: { models: AIModel[] } }
  | { type: 'setConversations'; payload: { conversations: Conversation[] } }
  | { type: 'restoreState'; payload: Record<string, unknown> };

export type WebviewToExtension =
  | { type: 'sendMessage'; payload: { message: string; modelId: string; conversationId?: number } }
  | { type: 'abortRequest' }
  | { type: 'newChat' }
  | { type: 'loadConversations' }
  | { type: 'deleteConversation'; payload: { id: number } }
  | { type: 'renameConversation'; payload: { id: number; title: string } }
  | { type: 'login'; payload: LoginRequest }
  | { type: 'logout' }
  | { type: 'ready' };

// Extension internal messages (not in protocol, used by ChatCommands → ChatPanel)
export type InternalToWebview =
  | { type: 'addContext'; payload: { text: string; fileName: string } }
  | { type: 'addFileContext'; payload: { filePath: string } }
  | { type: 'prefillMessage'; payload: { text: string } }
  | { type: 'newChat' }
  | { type: 'abortRequest' };

export interface Conversation {
  id: number;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Module Interface ----
export interface Module {
  activate(context: ModuleContext): void;
  deactivate(): void;
}

export interface ModuleContext {
  extensionContext: import('vscode').ExtensionContext;
  apiClient: import('./ApiClient').ApiClient;
  authService: import('./AuthService').AuthService;
  configService: import('./ConfigService').ConfigService;
  eventBus: import('./EventBus').EventBus;
  outputChannel: import('vscode').OutputChannel;
}
```

- [ ] **Step 4: Create test setup**

```typescript
// test/setup.ts
import * as vscode from 'vscode';

// Mock VS Code API for unit tests
export function createMockExtensionContext(): vscode.ExtensionContext {
  const globalState = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: (key: string) => globalState.get(key),
      update: (key: string, value: unknown) => {
        globalState.set(key, value);
        return Promise.resolve();
      },
      keys: () => [...globalState.keys()],
      setKeysForSync: () => {},
    },
    extensionPath: '/mock/extension',
    extensionUri: vscode.Uri.file('/mock/extension'),
  } as unknown as vscode.ExtensionContext;
}

export function createMockOutputChannel(): vscode.OutputChannel {
  return {
    name: 'Test',
    append: () => {},
    appendLine: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
    replace: () => {},
  } as vscode.OutputChannel;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/utils/constants.ts test/setup.ts
git commit -m "feat(ext): scaffold core types, constants, and test setup"
```

---

### Task 2: EventBus

**Files:**
- Create: `src/core/EventBus.ts`
- Create: `test/core/EventBus.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/core/EventBus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

describe('EventBus', () => {
  it('should call listener when event is emitted', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('auth:login', listener);
    bus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(listener).toHaveBeenCalledWith({ userId: '1', email: 'test@test.com' });
  });

  it('should not call listener after off()', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('auth:login', listener);
    bus.off('auth:login', listener);
    bus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('should support once() listeners', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.once('auth:logout', listener);
    bus.emit('auth:logout', undefined);
    bus.emit('auth:logout', undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple listeners for same event', () => {
    const bus = new EventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    bus.on('config:changed', listener1);
    bus.on('config:changed', listener2);
    bus.emit('config:changed', { key: 'serverUrl', value: 'https://test.com' });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should return disposable from on()', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const disposable = bus.on('auth:login', listener);
    disposable.dispose();
    bus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/core/EventBus.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/EventBus.ts
import type { EventMap } from './types';

type Listener<T> = (data: T) => void;

interface Disposable {
  dispose(): void;
}

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): Disposable {
    const set = this.listeners.get(event as string) ?? new Set();
    set.add(listener as Listener<unknown>);
    this.listeners.set(event as string, set);
    return {
      dispose: () => this.off(event, listener),
    };
  }

  once<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): Disposable {
    const wrapper: Listener<EventMap[K]> = (data) => {
      this.off(event, wrapper);
      listener(data);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    const set = this.listeners.get(event as string);
    if (set) {
      set.delete(listener as Listener<unknown>);
      if (set.size === 0) {
        this.listeners.delete(event as string);
      }
    }
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (set) {
      for (const listener of [...set]) {
        listener(data);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/core/EventBus.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/EventBus.ts test/core/EventBus.test.ts
git commit -m "feat(ext): add typed EventBus with disposable listeners"
```

---

### Task 3: ConfigService

**Files:**
- Create: `src/core/ConfigService.ts`
- Create: `test/core/ConfigService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/core/ConfigService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';
import { DEFAULTS } from '../../src/utils/constants';

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((key: string, defaultValue: unknown) => defaultValue),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('ConfigService', () => {
  let configService: ConfigService;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    configService = new ConfigService(eventBus);
  });

  it('should return default server URL', () => {
    expect(configService.getServerUrl()).toBe(DEFAULTS.SERVER_URL);
  });

  it('should return default allowSelfSigned', () => {
    expect(configService.getAllowSelfSigned()).toBe(DEFAULTS.ALLOW_SELF_SIGNED);
  });

  it('should return orchestrator polling interval', () => {
    expect(configService.getOrchestratorPollingInterval()).toBe(DEFAULTS.ORCHESTRATOR_POLLING);
  });

  it('should return orchestrator show status bar', () => {
    expect(configService.getOrchestratorShowStatusBar()).toBe(DEFAULTS.ORCHESTRATOR_SHOW);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/core/ConfigService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/ConfigService.ts
import * as vscode from 'vscode';
import { CONFIG_SECTION, CONFIG_KEYS, DEFAULTS } from '../utils/constants';
import type { EventBus } from './EventBus';

export class ConfigService {
  private readonly disposable: vscode.Disposable;

  constructor(private readonly eventBus: EventBus) {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        this.eventBus.emit('config:changed', {
          key: CONFIG_SECTION,
          value: this.getAll(),
        });
      }
    });
  }

  getServerUrl(): string {
    return this.get<string>(CONFIG_KEYS.SERVER_URL, DEFAULTS.SERVER_URL);
  }

  getAllowSelfSigned(): boolean {
    return this.get<boolean>(CONFIG_KEYS.ALLOW_SELF_SIGNED, DEFAULTS.ALLOW_SELF_SIGNED);
  }

  getBotIconStyle(): string {
    return this.get<string>(CONFIG_KEYS.BOT_ICON_STYLE, 'default');
  }

  getOrchestratorPollingInterval(): number {
    return this.get<number>(CONFIG_KEYS.ORCHESTRATOR_POLLING, DEFAULTS.ORCHESTRATOR_POLLING);
  }

  getOrchestratorShowStatusBar(): boolean {
    return this.get<boolean>(CONFIG_KEYS.ORCHESTRATOR_SHOW, DEFAULTS.ORCHESTRATOR_SHOW);
  }

  private get<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, defaultValue);
  }

  private getAll(): Record<string, unknown> {
    return {
      serverUrl: this.getServerUrl(),
      allowSelfSigned: this.getAllowSelfSigned(),
      botIconStyle: this.getBotIconStyle(),
      orchestratorPolling: this.getOrchestratorPollingInterval(),
      orchestratorShow: this.getOrchestratorShowStatusBar(),
    };
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/core/ConfigService.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/ConfigService.ts test/core/ConfigService.test.ts
git commit -m "feat(ext): add ConfigService with typed getters and change events"
```

---

## Chunk 2: ApiClient + AuthService

### Task 4: ApiClient

**Files:**
- Create: `src/core/ApiClient.ts`
- Create: `test/core/ApiClient.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/core/ApiClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../../src/core/ApiClient';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';
import { createMockOutputChannel } from '../setup';

// Mock axios
vi.mock('axios', () => {
  const mockInstance = {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: 'test' } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: 'created' } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    default: { create: vi.fn().mockReturnValue(mockInstance) },
  };
});

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_key: string, def: unknown) => def),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('ApiClient', () => {
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    apiClient = new ApiClient(configService, eventBus, outputChannel);
  });

  it('should perform GET request', async () => {
    const result = await apiClient.get<string>('/api/test');
    expect(result).toBe('test');
  });

  it('should perform POST request', async () => {
    const result = await apiClient.post<string>('/api/test', { data: 'value' });
    expect(result).toBe('created');
  });

  it('should perform DELETE request', async () => {
    await expect(apiClient.delete('/api/test')).resolves.not.toThrow();
  });

  it('should set auth token', () => {
    apiClient.setToken('test-token');
    expect(apiClient.hasToken()).toBe(true);
  });

  it('should clear auth token', () => {
    apiClient.setToken('test-token');
    apiClient.clearToken();
    expect(apiClient.hasToken()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/core/ApiClient.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/ApiClient.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as https from 'https';
import * as vscode from 'vscode';
import type { ConfigService } from './ConfigService';
import type { EventBus } from './EventBus';
import type { ApiResponse, StreamChunk } from './types';

export class ApiClient {
  private readonly client: AxiosInstance;
  private token: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    const baseURL = this.configService.getServerUrl();
    const allowSelfSigned = this.configService.getAllowSelfSigned();

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      httpsAgent: allowSelfSigned
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined,
    });

    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          this.outputChannel.appendLine('[ApiClient] 401 — session expired');
          this.eventBus.emit('auth:logout', undefined);
        }
        throw error;
      },
    );

    this.eventBus.on('config:changed', () => {
      this.client.defaults.baseURL = this.configService.getServerUrl();
    });
  }

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.withRetry(() => this.client.get<ApiResponse<T>>(path, { params }));
    return response.data.data as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.withRetry(() => this.client.post<ApiResponse<T>>(path, body));
    return response.data.data as T;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.withRetry(() => this.client.delete<ApiResponse<T>>(path));
    return response.data.data as T;
  }

  stream(
    path: string,
    body: unknown,
    onChunk: (chunk: StreamChunk) => void,
    onError?: (error: Error) => void,
  ): AbortController {
    const controller = new AbortController();
    this.doStream(path, body, onChunk, onError, controller);
    return controller;
  }

  private async doStream(
    path: string,
    body: unknown,
    onChunk: (chunk: StreamChunk) => void,
    onError: ((error: Error) => void) | undefined,
    controller: AbortController,
    attempt = 0,
  ): Promise<void> {
    const maxRetries = 5;
    const baseURL = this.configService.getServerUrl();
    const url = `${baseURL}${path}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.eventBus.emit('auth:logout', undefined);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) { throw new Error('No response body'); }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(line.slice(6)) as StreamChunk;
              onChunk(chunk);
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) { return; }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        this.outputChannel.appendLine(
          `[ApiClient] SSE reconnect attempt ${attempt + 1}/${maxRetries} in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.doStream(path, body, onChunk, onError, controller, attempt + 1);
      }

      this.outputChannel.appendLine(`[ApiClient] SSE failed after ${maxRetries} retries`);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) { throw error; }
        const axiosErr = error as AxiosError;
        if (axiosErr.response?.status === 401 || axiosErr.response?.status === 403) {
          throw error; // don't retry auth errors
        }
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error('Unreachable');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/core/ApiClient.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/ApiClient.ts test/core/ApiClient.test.ts
git commit -m "feat(ext): add ApiClient with HTTP, SSE streaming, and retry logic"
```

---

### Task 5: AuthService

**Files:**
- Create: `src/core/AuthService.ts`
- Create: `test/core/AuthService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/core/AuthService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/core/AuthService';
import { ApiClient } from '../../src/core/ApiClient';
import { EventBus } from '../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;
  let apiClient: ApiClient;
  let eventBus: EventBus;
  let context: ReturnType<typeof createMockExtensionContext>;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      post: vi.fn(),
      setToken: vi.fn(),
      clearToken: vi.fn(),
      hasToken: vi.fn().mockReturnValue(false),
    } as unknown as ApiClient;
    context = createMockExtensionContext();
    const outputChannel = createMockOutputChannel();
    authService = new AuthService(apiClient, eventBus, context, outputChannel);
  });

  it('should login successfully', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });

    const result = await authService.login('admin@test.com', 'password');
    expect(result).toBe(true);
    expect(apiClient.setToken).toHaveBeenCalledWith('jwt-token');
  });

  it('should emit auth:login on successful login', async () => {
    const listener = vi.fn();
    eventBus.on('auth:login', listener);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });

    await authService.login('admin@test.com', 'password');
    expect(listener).toHaveBeenCalledWith({ userId: '1', email: 'admin@test.com' });
  });

  it('should return false on login failure', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    const result = await authService.login('bad@test.com', 'wrong');
    expect(result).toBe(false);
  });

  it('should logout and emit event', () => {
    const listener = vi.fn();
    eventBus.on('auth:logout', listener);
    authService.logout();
    expect(apiClient.clearToken).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
  });

  it('should restore token from global state', async () => {
    await context.globalState.update('enterprise-ai.token', 'saved-token');
    await context.globalState.update('enterprise-ai.user', JSON.stringify({
      id: 1, email: 'test@test.com', name: 'Test', role: 'user',
    }));
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(true);
    expect(apiClient.setToken).toHaveBeenCalledWith('saved-token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/core/AuthService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/AuthService.ts
import * as vscode from 'vscode';
import type { ApiClient } from './ApiClient';
import type { EventBus } from './EventBus';
import type { LoginResponse, UserInfo } from './types';
import { API_PATHS } from '../utils/constants';

const TOKEN_KEY = 'enterprise-ai.token';
const USER_KEY = 'enterprise-ai.user';

export class AuthService {
  private currentUser: UserInfo | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.eventBus.on('auth:logout', () => this.handleLogout());
  }

  async login(email: string, password: string, totp?: string): Promise<boolean> {
    try {
      const response = await this.apiClient.post<LoginResponse>(API_PATHS.LOGIN, {
        email,
        password,
        ...(totp ? { totp } : {}),
      });

      this.apiClient.setToken(response.token);
      this.currentUser = response.user;

      await this.context.globalState.update(TOKEN_KEY, response.token);
      await this.context.globalState.update(USER_KEY, JSON.stringify(response.user));

      this.eventBus.emit('auth:login', {
        userId: String(response.user.id),
        email: response.user.email,
      });

      this.outputChannel.appendLine(`[Auth] Login successful: ${response.user.email}`);
      return true;
    } catch (error) {
      this.outputChannel.appendLine(`[Auth] Login failed: ${error}`);
      vscode.window.showErrorMessage('Login failed. Check credentials.');
      return false;
    }
  }

  logout(): void {
    // handleLogout() clears token/state; we just emit the event
    this.eventBus.emit('auth:logout', undefined);
    this.outputChannel.appendLine('[Auth] Logged out');
  }

  tryRestoreSession(): boolean {
    const token = this.context.globalState.get<string>(TOKEN_KEY);
    const userJson = this.context.globalState.get<string>(USER_KEY);

    if (token && userJson) {
      try {
        this.currentUser = JSON.parse(userJson) as UserInfo;
        this.apiClient.setToken(token);
        this.eventBus.emit('auth:login', {
          userId: String(this.currentUser.id),
          email: this.currentUser.email,
        });
        this.outputChannel.appendLine(`[Auth] Session restored: ${this.currentUser.email}`);
        return true;
      } catch {
        this.outputChannel.appendLine('[Auth] Failed to restore session');
      }
    }
    return false;
  }

  getUser(): UserInfo | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null && this.apiClient.hasToken();
  }

  private handleLogout(): void {
    this.currentUser = null;
    this.apiClient.clearToken();
    this.context.globalState.update(TOKEN_KEY, undefined);
    this.context.globalState.update(USER_KEY, undefined);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/core/AuthService.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/AuthService.ts test/core/AuthService.test.ts
git commit -m "feat(ext): add AuthService with login, logout, and session restore"
```

---

## Chunk 3: Chat Module (Extension Side)

### Task 6: ChatService

**Files:**
- Create: `src/modules/chat/ChatService.ts`
- Create: `test/modules/chat/ChatService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/chat/ChatService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../../src/modules/chat/ChatService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

describe('ChatService', () => {
  let chatService: ChatService;
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
    chatService = new ChatService(apiClient, eventBus, outputChannel);
  });

  it('should fetch models from backend', async () => {
    const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(models);

    const result = await chatService.loadModels();
    expect(result).toEqual(models);
  });

  it('should emit models:loaded after fetching', async () => {
    const listener = vi.fn();
    eventBus.on('models:loaded', listener);
    const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(models);

    await chatService.loadModels();
    expect(listener).toHaveBeenCalledWith({ models });
  });

  it('should fetch conversations', async () => {
    const convos = [{ id: 1, title: 'Test', modelId: 'gpt-4o', createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(convos);

    const result = await chatService.loadConversations();
    expect(result).toEqual(convos);
  });

  it('should start streaming message', () => {
    const onChunk = vi.fn();
    const onError = vi.fn();
    chatService.sendMessage('Hello', 'gpt-4o', onChunk, onError);
    expect(apiClient.stream).toHaveBeenCalled();
  });

  it('should abort active stream', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    chatService.sendMessage('Hello', 'gpt-4o', vi.fn(), vi.fn());
    chatService.abortCurrentRequest();
    expect(abortFn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/chat/ChatService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/chat/ChatService.ts
import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { AIModel, Conversation, StreamChunk } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class ChatService {
  private currentController: AbortController | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async loadModels(): Promise<AIModel[]> {
    const models = await this.apiClient.get<AIModel[]>(API_PATHS.MODELS);
    this.eventBus.emit('models:loaded', { models });
    this.outputChannel.appendLine(`[Chat] Loaded ${models.length} models`);
    return models;
  }

  async loadConversations(): Promise<Conversation[]> {
    return this.apiClient.get<Conversation[]>(API_PATHS.CONVERSATIONS);
  }

  async deleteConversation(id: number): Promise<void> {
    await this.apiClient.delete(`${API_PATHS.CONVERSATIONS}/${id}`);
  }

  sendMessage(
    message: string,
    modelId: string,
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    conversationId?: number,
  ): void {
    this.abortCurrentRequest();

    this.currentController = this.apiClient.stream(
      API_PATHS.COMPLETIONS,
      {
        message,
        model: modelId,
        ...(conversationId ? { conversationId } : {}),
        stream: true,
      },
      onChunk,
      onError,
    );
  }

  abortCurrentRequest(): void {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/chat/ChatService.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/chat/ChatService.ts test/modules/chat/ChatService.test.ts
git commit -m "feat(ext): add ChatService with streaming, models, conversations"
```

---

### Task 7: ChatCommands

**Files:**
- Create: `src/modules/chat/ChatCommands.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/modules/chat/ChatCommands.ts
import * as vscode from 'vscode';
import type { ModuleContext } from '../../core/types';
import type { ChatPanel } from './ChatPanel';

export function registerChatCommands(
  context: ModuleContext,
  getPanel: () => ChatPanel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.openChat', () => {
      getPanel().show();
    }),

    vscode.commands.registerCommand('enterprise-ai.newChat', () => {
      getPanel().postMessage({ type: 'newChat' } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.abortRequest', () => {
      getPanel().postMessage({ type: 'abortRequest' } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.addToChat', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      if (!selection) { return; }
      const fileName = editor.document.fileName;
      getPanel().show();
      getPanel().postMessage({
        type: 'addContext',
        payload: { text: selection, fileName },
      } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.addFileToContext', (uri: vscode.Uri) => {
      if (!uri) { return; }
      getPanel().show();
      getPanel().postMessage({
        type: 'addFileContext',
        payload: { filePath: uri.fsPath },
      } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.chatWithContext', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      const fileName = editor.document.fileName;
      getPanel().show();
      getPanel().postMessage({
        type: 'addContext',
        payload: { text: selection || editor.document.getText(), fileName },
      } as never);
    }),

    vscode.commands.registerCommand('enterprise-ai.login', async () => {
      const email = await vscode.window.showInputBox({ prompt: 'Email', placeHolder: 'admin@enterprise.local' });
      if (!email) { return; }
      const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
      if (!password) { return; }
      const totp = await vscode.window.showInputBox({ prompt: 'TOTP code (leave empty if not enabled)', placeHolder: '000000' });
      await context.authService.login(email, password, totp || undefined);
    }),

    vscode.commands.registerCommand('enterprise-ai.logout', () => {
      context.authService.logout();
      vscode.window.showInformationMessage('Logged out from Enterprise AI');
    }),

    vscode.commands.registerCommand('enterprise-ai.configure', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai');
    }),

    vscode.commands.registerCommand('enterprise-ai.showLogs', () => {
      context.outputChannel.show();
    }),
  ];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/chat/ChatCommands.ts
git commit -m "feat(ext): add chat and auth command registrations"
```

---

### Task 8: ChatPanel (WebviewPanel provider)

**Files:**
- Create: `src/modules/chat/ChatPanel.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/modules/chat/ChatPanel.ts
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
        // handled in webview
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
  import('crypto').then((c) => c.randomFillSync(array));
  // Synchronous fallback for nonce generation
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/chat/ChatPanel.ts
git commit -m "feat(ext): add ChatPanel webview provider with message routing"
```

---

## Chunk 4: Code Actions + Entry Point + Package.json

### Task 9: CodeActionProvider + Commands

**Files:**
- Create: `src/modules/code-actions/CodeActionProvider.ts`
- Create: `src/modules/code-actions/CodeActionCommands.ts`

- [ ] **Step 1: Write CodeActionProvider**

```typescript
// src/modules/code-actions/CodeActionProvider.ts
import * as vscode from 'vscode';

export class EnterpriseAICodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    if (range.isEmpty) { return []; }

    const actions: vscode.CodeAction[] = [];
    const commands = [
      { title: 'Explain Code', command: 'enterprise-ai.explainCode' },
      { title: 'Fix Code', command: 'enterprise-ai.fixCode' },
      { title: 'Improve Code', command: 'enterprise-ai.improveCode' },
      { title: 'Generate Tests', command: 'enterprise-ai.generateTests' },
    ];

    for (const { title, command } of commands) {
      const action = new vscode.CodeAction(`Enterprise AI: ${title}`, vscode.CodeActionKind.QuickFix);
      action.command = { command, title };
      actions.push(action);
    }

    return actions;
  }
}
```

- [ ] **Step 2: Write CodeActionCommands**

```typescript
// src/modules/code-actions/CodeActionCommands.ts
import * as vscode from 'vscode';
import type { ChatPanel } from '../chat/ChatPanel';

export function registerCodeActionCommands(
  getPanel: () => ChatPanel,
): vscode.Disposable[] {
  const codeActionCommands = [
    { id: 'enterprise-ai.explainCode', prompt: 'Explain the following code:\n\n' },
    { id: 'enterprise-ai.fixCode', prompt: 'Fix any issues in the following code:\n\n' },
    { id: 'enterprise-ai.improveCode', prompt: 'Improve the following code:\n\n' },
    { id: 'enterprise-ai.generateTests', prompt: 'Generate tests for the following code:\n\n' },
  ];

  return codeActionCommands.map(({ id, prompt }) =>
    vscode.commands.registerCommand(id, () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('Select code first');
        return;
      }
      const lang = editor.document.languageId;
      const fileName = editor.document.fileName;
      getPanel().show();
      getPanel().postMessage({
        type: 'prefillMessage',
        payload: { text: `${prompt}\`\`\`${lang}\n${selection}\n\`\`\`\n\nFile: ${fileName}` },
      } as never);
    }),
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/code-actions/CodeActionProvider.ts src/modules/code-actions/CodeActionCommands.ts
git commit -m "feat(ext): add code action provider and commands (explain/fix/improve/tests)"
```

---

### Task 10: Extension entry point

**Files:**
- Create: `src/extension.ts` (overwrite existing)

- [ ] **Step 1: Write slim extension.ts**

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
  const getPanel = (): ChatPanel => {
    if (!chatPanel) {
      chatPanel = new ChatPanel(moduleContext);
    }
    return chatPanel;
  };

  // Register commands
  const disposables = [
    ...registerChatCommands(moduleContext, getPanel),
    ...registerCodeActionCommands(getPanel),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new EnterpriseAICodeActionProvider(),
      { providedCodeActionKinds: EnterpriseAICodeActionProvider.providedCodeActionKinds },
    ),
  ];

  context.subscriptions.push(...disposables, outputChannel);

  // Restore session
  authService.tryRestoreSession();
  outputChannel.appendLine('[Extension] Activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
```

- [ ] **Step 2: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ext): slim entry point bootstrapping core services and modules"
```

---

### Task 11: Update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current package.json**

```bash
cd vscode-extension && cat package.json
```

- [ ] **Step 2: Replace `activationEvents`**

```json
"activationEvents": [
  "onCommand:enterprise-ai.openChat",
  "onCommand:enterprise-ai.login",
  "onCommand:enterprise-ai.explainCode",
  "onCommand:enterprise-ai.fixCode",
  "onCommand:enterprise-ai.improveCode",
  "onCommand:enterprise-ai.generateTests",
  "onCommand:enterprise-ai.newAgentSession",
  "onCommand:enterprise-ai.openOrchestrator",
  "onCommand:enterprise-ai.generateDocument",
  "onCommand:enterprise-ai.manageWorktrees",
  "onCommand:enterprise-ai.showLogs",
  "onStartupFinished"
]
```

- [ ] **Step 3: Replace `contributes.configuration`**

Remove all Claude-direct settings (`useDirectClaude`, `claudeAuthMode`, `claudeApiKey`, `claudeModel`, `defaultModel`, `useReactUI`). Set:

```json
"contributes": {
  "configuration": {
    "title": "Enterprise AI",
    "properties": {
      "enterprise-ai.serverUrl": {
        "type": "string",
        "default": "https://plane.lushlolli.com",
        "description": "Backend server URL"
      },
      "enterprise-ai.allowSelfSignedCerts": {
        "type": "boolean",
        "default": false,
        "description": "Allow self-signed TLS certificates"
      },
      "enterprise-ai.botIconStyle": {
        "type": "string",
        "default": "default",
        "enum": ["default", "purple", "sparkle", "brain", "chat", "robot"],
        "description": "Bot icon style in chat"
      },
      "enterprise-ai.orchestrator.pollingInterval": {
        "type": "number",
        "default": 10000,
        "description": "Orchestrator status bar polling interval (ms)"
      },
      "enterprise-ai.orchestrator.showStatusBar": {
        "type": "boolean",
        "default": true,
        "description": "Show orchestrator slot count in status bar"
      }
    }
  }
}
```

- [ ] **Step 4: Replace `contributes.commands`**

```json
"commands": [
  { "command": "enterprise-ai.openChat", "title": "Open Chat", "category": "Enterprise AI" },
  { "command": "enterprise-ai.newChat", "title": "New Chat", "category": "Enterprise AI" },
  { "command": "enterprise-ai.explainCode", "title": "Explain Code", "category": "Enterprise AI" },
  { "command": "enterprise-ai.fixCode", "title": "Fix Code", "category": "Enterprise AI" },
  { "command": "enterprise-ai.improveCode", "title": "Improve Code", "category": "Enterprise AI" },
  { "command": "enterprise-ai.generateTests", "title": "Generate Tests", "category": "Enterprise AI" },
  { "command": "enterprise-ai.addToChat", "title": "Add to Chat", "category": "Enterprise AI" },
  { "command": "enterprise-ai.addFileToContext", "title": "Add File to Context", "category": "Enterprise AI" },
  { "command": "enterprise-ai.chatWithContext", "title": "Chat with Context", "category": "Enterprise AI" },
  { "command": "enterprise-ai.inlineEdit", "title": "Inline Edit with AI", "category": "Enterprise AI" },
  { "command": "enterprise-ai.useTemplate", "title": "Use Prompt Template", "category": "Enterprise AI" },
  { "command": "enterprise-ai.ragSearch", "title": "RAG Search", "category": "Enterprise AI" },
  { "command": "enterprise-ai.generateDocument", "title": "Generate Document", "category": "Enterprise AI" },
  { "command": "enterprise-ai.newAgentSession", "title": "New Agent Session", "category": "Enterprise AI" },
  { "command": "enterprise-ai.viewAgentSessions", "title": "View Agent Sessions", "category": "Enterprise AI" },
  { "command": "enterprise-ai.openOrchestrator", "title": "Open Orchestrator", "category": "Enterprise AI" },
  { "command": "enterprise-ai.manageWorktrees", "title": "Manage Worktrees", "category": "Enterprise AI" },
  { "command": "enterprise-ai.login", "title": "Login", "category": "Enterprise AI" },
  { "command": "enterprise-ai.logout", "title": "Logout", "category": "Enterprise AI" },
  { "command": "enterprise-ai.configure", "title": "Settings", "category": "Enterprise AI" },
  { "command": "enterprise-ai.showLogs", "title": "Show Logs", "category": "Enterprise AI" }
]
```

- [ ] **Step 5: Replace `contributes.keybindings`**

```json
"keybindings": [
  { "command": "enterprise-ai.openChat", "key": "ctrl+shift+l", "mac": "cmd+shift+l" },
  { "command": "enterprise-ai.newChat", "key": "ctrl+n", "mac": "cmd+n", "when": "enterprise-ai.chatFocused" },
  { "command": "enterprise-ai.addToChat", "key": "ctrl+shift+a", "mac": "cmd+shift+a", "when": "editorHasSelection" },
  { "command": "enterprise-ai.inlineEdit", "key": "ctrl+shift+k", "mac": "cmd+shift+k", "when": "editorTextFocus && editorHasSelection" },
  { "command": "enterprise-ai.chatWithContext", "key": "ctrl+shift+c", "mac": "cmd+shift+c", "when": "editorTextFocus" },
  { "command": "enterprise-ai.useTemplate", "key": "ctrl+shift+t", "mac": "cmd+shift+t" },
  { "command": "enterprise-ai.ragSearch", "key": "ctrl+shift+r", "mac": "cmd+shift+r" },
  { "command": "enterprise-ai.generateDocument", "key": "ctrl+alt+g", "mac": "cmd+alt+g" },
  { "command": "enterprise-ai.newAgentSession", "key": "ctrl+alt+n", "mac": "cmd+alt+n" }
]
```

- [ ] **Step 6: Replace `contributes.menus`**

```json
"menus": {
  "editor/context": [
    { "submenu": "enterprise-ai.submenu", "group": "enterprise-ai" }
  ],
  "enterprise-ai.submenu": [
    { "command": "enterprise-ai.inlineEdit", "when": "editorHasSelection", "group": "1_edit" },
    { "command": "enterprise-ai.chatWithContext", "when": "editorTextFocus", "group": "2_context" },
    { "command": "enterprise-ai.addToChat", "when": "editorHasSelection", "group": "2_context" },
    { "command": "enterprise-ai.explainCode", "when": "editorHasSelection", "group": "3_actions" },
    { "command": "enterprise-ai.improveCode", "when": "editorHasSelection", "group": "3_actions" },
    { "command": "enterprise-ai.fixCode", "when": "editorHasSelection", "group": "3_actions" },
    { "command": "enterprise-ai.generateTests", "when": "editorHasSelection", "group": "3_actions" }
  ],
  "explorer/context": [
    { "command": "enterprise-ai.addFileToContext", "group": "enterprise-ai" }
  ]
},
"submenus": [
  { "id": "enterprise-ai.submenu", "label": "Enterprise AI" }
]
```

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "feat(ext): update package.json — new commands, settings, menus, activation events"
```

---

### Task 11b: Setup webview dependencies

**Files:**
- Create: `webview-ui/package.json`
- Create: `webview-ui/tsconfig.json`

- [ ] **Step 1: Create webview-ui/package.json**

```json
{
  "name": "enterprise-ai-webview",
  "version": "3.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "react-syntax-highlighter": "^16.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/react-syntax-highlighter": "^15.5.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create webview-ui/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "../out",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd vscode-extension/webview-ui && npm install
```

- [ ] **Step 4: Commit**

```bash
git add webview-ui/package.json webview-ui/tsconfig.json webview-ui/package-lock.json
git commit -m "feat(ext): add webview-ui package with React 18 and build dependencies"
```

---

## Chunk 5: Webview UI (Chat)

### Task 12: Build config + shared theme

**Files:**
- Create: `webview-ui/build.mjs`
- Create: `webview-ui/shared/theme/main.css`

- [ ] **Step 1: Write esbuild config**

```javascript
// webview-ui/build.mjs
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
  target: 'es2020',
  format: 'iife',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
  external: [],
};

const entries = [
  { in: 'chat/index.tsx', out: '../out/chatWebview' },
];

async function build() {
  for (const entry of entries) {
    const ctx = await esbuild.context({
      ...sharedConfig,
      entryPoints: [entry.in],
      outfile: `${entry.out}.js`,
    });

    if (isWatch) {
      await ctx.watch();
      console.log(`Watching ${entry.in}...`);
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  }

  // CSS
  const cssCtx = await esbuild.context({
    entryPoints: ['shared/theme/main.css'],
    outfile: '../out/theme.css',
    bundle: true,
    minify: !isWatch,
  });

  if (isWatch) {
    await cssCtx.watch();
  } else {
    await cssCtx.rebuild();
    await cssCtx.dispose();
  }

  if (!isWatch) { console.log('Build complete'); }
}

build().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Write theme CSS**

```css
/* webview-ui/shared/theme/main.css */
:root {
  --bg-primary: var(--vscode-editor-background);
  --bg-secondary: var(--vscode-sideBar-background);
  --text-primary: var(--vscode-editor-foreground);
  --text-secondary: var(--vscode-descriptionForeground);
  --border: var(--vscode-panel-border);
  --accent: var(--vscode-button-background);
  --accent-hover: var(--vscode-button-hoverBackground);
  --accent-text: var(--vscode-button-foreground);
  --error: var(--vscode-errorForeground);
  --input-bg: var(--vscode-input-background);
  --input-border: var(--vscode-input-border);
  --input-text: var(--vscode-input-foreground);
  --scrollbar: var(--vscode-scrollbarSlider-background);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.5;
  overflow: hidden;
  height: 100vh;
}

#root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

button {
  background: var(--accent);
  color: var(--accent-text);
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: inherit;
}
button:hover { background: var(--accent-hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

input, textarea {
  background: var(--input-bg);
  color: var(--input-text);
  border: 1px solid var(--input-border);
  border-radius: 4px;
  padding: 6px 10px;
  font-family: inherit;
  font-size: inherit;
}

.error-banner {
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--error);
  padding: 8px 12px;
  border-radius: 4px;
  margin: 8px;
}
```

- [ ] **Step 3: Commit**

```bash
git add webview-ui/build.mjs webview-ui/shared/theme/main.css
git commit -m "feat(ext): add esbuild multi-entry config and VS Code theme CSS"
```

---

### Task 13: Shared hooks

**Files:**
- Create: `webview-ui/shared/hooks/useVsCodeApi.ts`
- Create: `webview-ui/shared/hooks/useStreaming.ts`
- Create: `webview-ui/shared/hooks/useModels.ts`
- Create: `webview-ui/shared/hooks/useAuth.ts`

- [ ] **Step 1: Write useVsCodeApi hook**

```typescript
// webview-ui/shared/hooks/useVsCodeApi.ts
import { useCallback, useEffect, useRef } from 'react';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (!api) { api = acquireVsCodeApi(); }
  return api;
}

export function useVsCodeMessage<T>(handler: (message: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      handlerRef.current(event.data as T);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}

export function usePostMessage(): (message: unknown) => void {
  return useCallback((message: unknown) => {
    getVsCodeApi().postMessage(message);
  }, []);
}
```

- [ ] **Step 2: Write useStreaming hook**

```typescript
// webview-ui/shared/hooks/useStreaming.ts
import { useState, useCallback, useRef } from 'react';

interface StreamState {
  isStreaming: boolean;
  content: string;
  error: string | null;
}

export function useStreaming() {
  const [state, setState] = useState<StreamState>({
    isStreaming: false,
    content: '',
    error: null,
  });
  const contentRef = useRef('');

  const startStream = useCallback(() => {
    contentRef.current = '';
    setState({ isStreaming: true, content: '', error: null });
  }, []);

  const appendChunk = useCallback((text: string) => {
    contentRef.current += text;
    setState((prev) => ({ ...prev, content: contentRef.current }));
  }, []);

  const endStream = useCallback(() => {
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, isStreaming: false, error }));
  }, []);

  return { ...state, startStream, appendChunk, endStream, setError };
}
```

- [ ] **Step 3: Write useModels hook**

```typescript
// webview-ui/shared/hooks/useModels.ts
import { useState, useCallback } from 'react';

interface AIModel {
  id: string;
  name: string;
  provider: string;
}

export function useModels() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  const updateModels = useCallback((newModels: AIModel[]) => {
    setModels(newModels);
    if (newModels.length > 0 && !selectedModel) {
      setSelectedModel(newModels[0].id);
    }
  }, [selectedModel]);

  return { models, selectedModel, setSelectedModel, updateModels };
}
```

- [ ] **Step 4: Write useAuth hook**

```typescript
// webview-ui/shared/hooks/useAuth.ts
import { useState, useCallback } from 'react';

interface UserInfo {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: UserInfo | null;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
  });

  const setAuthenticated = useCallback((user: UserInfo) => {
    setAuth({ isAuthenticated: true, user });
  }, []);

  const setUnauthenticated = useCallback(() => {
    setAuth({ isAuthenticated: false, user: null });
  }, []);

  return { ...auth, setAuthenticated, setUnauthenticated };
}
```

- [ ] **Step 5: Commit**

```bash
git add webview-ui/shared/hooks/
git commit -m "feat(ext): add shared React hooks (vsCodeApi, streaming, models, auth)"
```

---

### Task 14: Shared components

**Files:**
- Create: `webview-ui/shared/components/MessageBubble.tsx`
- Create: `webview-ui/shared/components/CodeBlock.tsx`
- Create: `webview-ui/shared/components/StreamingText.tsx`
- Create: `webview-ui/shared/components/LoadingSpinner.tsx`
- Create: `webview-ui/shared/components/ErrorBanner.tsx`
- Create: `webview-ui/shared/components/ModelPicker.tsx`

- [ ] **Step 1: Write all shared components**

Each component is small (30-80 lines). Create them all:

**MessageBubble.tsx** — Renders a chat message with Markdown support (react-markdown + remark-gfm). Props: `role: 'user' | 'assistant'`, `content: string`, `isStreaming: boolean`.

**CodeBlock.tsx** — Syntax highlighted code with copy button. Uses react-syntax-highlighter with VS Code dark theme.

**StreamingText.tsx** — Renders text with blinking cursor during streaming. Props: `content: string`, `isStreaming: boolean`.

**LoadingSpinner.tsx** — Simple CSS spinner using VS Code accent color.

**ErrorBanner.tsx** — Red banner with error message and dismiss button. Props: `message: string`, `onDismiss: () => void`.

**ModelPicker.tsx** — Dropdown select for AI models grouped by provider. Props: `models: AIModel[]`, `selected: string`, `onChange: (id: string) => void`.

(Full code for each component should be written during implementation — these are standard React presentational components, 30-80 lines each.)

- [ ] **Step 2: Commit**

```bash
git add webview-ui/shared/components/
git commit -m "feat(ext): add shared webview components (MessageBubble, CodeBlock, ModelPicker, etc.)"
```

---

### Task 15: Chat webview app

**Files:**
- Create: `webview-ui/chat/index.tsx`
- Create: `webview-ui/chat/ChatApp.tsx`
- Create: `webview-ui/chat/MessageArea.tsx`
- Create: `webview-ui/chat/ChatInput.tsx`
- Create: `webview-ui/chat/ConversationList.tsx`

- [ ] **Step 1: Write chat entry point**

```typescript
// webview-ui/chat/index.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './ChatApp';

const root = createRoot(document.getElementById('root')!);
root.render(<ChatApp />);
```

- [ ] **Step 2: Write ChatApp (main container)**

ChatApp manages:
- Message handler from extension (useVsCodeMessage)
- Auth state (useAuth)
- Model state (useModels)
- Streaming state (useStreaming)
- Message history (useState)
- Routes incoming extension messages to appropriate state updates

~150 lines.

- [ ] **Step 3: Write MessageArea**

Scrollable message list. Uses MessageBubble for each message. Auto-scrolls on new content. Shows StreamingText for in-progress responses. ~80 lines.

- [ ] **Step 4: Write ChatInput**

Text area with:
- `@file` and `@selection` support (NOTE: `@document` is Phase 3 scope — stub the detection hook but don't implement)
- Model picker (ModelPicker component)
- Send button + Shift+Enter for newline, Enter to send
- Abort button during streaming
~120 lines.

- [ ] **Step 5: Write ConversationList**

Sidebar/drawer with conversation list. Click to load, right-click to delete. New chat button. ~60 lines.

- [ ] **Step 6: Build and verify**

```bash
cd webview-ui && node build.mjs
```
Expected: `out/chatWebview.js` and `out/theme.css` created without errors.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/chat/
git commit -m "feat(ext): add chat webview React app with streaming and conversations"
```

---

## Chunk 6: Integration + Package.json Final + Build Verification

### Task 16: Update package.json scripts

- [ ] **Step 1: Add/update npm scripts**

```json
{
  "scripts": {
    "build:ext": "esbuild src/extension.ts --bundle --outfile=out/extension.js --external:vscode --format=cjs --platform=node --target=node20",
    "build:webview": "cd webview-ui && node build.mjs",
    "build:all": "npm run build:ext && npm run build:webview",
    "watch:ext": "npm run build:ext -- --watch",
    "watch:webview": "cd webview-ui && node build.mjs --watch",
    "watch": "concurrently \"npm run watch:ext\" \"npm run watch:webview\"",
    "lint": "eslint src/ webview-ui/",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "npm run build:all && vsce package",
    "release": "npm version patch && npm run package"
  }
}
```

- [ ] **Step 2: Full build test**

```bash
cd vscode-extension && npm run build:all
```
Expected: `out/extension.js`, `out/chatWebview.js`, `out/theme.css` all created.

- [ ] **Step 3: Run all tests**

```bash
cd vscode-extension && npm run test
```
Expected: All tests pass, 80%+ coverage on core/.

- [ ] **Step 4: Package VSIX**

```bash
cd vscode-extension && npm run package
```
Expected: `enterprise-ai-chat-3.0.0.vsix` created.

- [ ] **Step 5: Commit**

```bash
git add src/ webview-ui/ test/ package.json
git commit -m "feat(ext): Phase 1 complete — core + chat + code actions MVP"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1-3 | Project scaffold, types, EventBus, ConfigService |
| 2 | 4-5 | ApiClient (HTTP + SSE), AuthService |
| 3 | 6-8 | ChatService, ChatCommands, ChatPanel |
| 4 | 9-11 | Code Actions, extension.ts, package.json |
| 5 | 12-15 | Webview build, shared components/hooks, chat UI |
| 6 | 16 | Integration, build verification, VSIX packaging |

**Total tasks:** 16
**Total commits:** ~16
**Coverage target:** 80%+ on core/, modules with mocks
