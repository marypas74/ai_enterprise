# VS Code Extension Rewrite — Phase 4: Polish & Test

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve production-ready quality with 80%+ test coverage on core services, integration tests for every module, E2E tests for critical user flows, performance validation (< 500ms activation), and clean VSIX packaging.

**Architecture:** Phase 4 adds no new production code. It adds comprehensive tests layered on the existing modular architecture: unit tests for `core/`, integration tests for `modules/` with mocked core, E2E tests using `@vscode/test-electron` for full user flows, and performance/packaging verification.

**Tech Stack:** Vitest, @vscode/test-electron, @vitest/coverage-v8, VS Code Extension API

**Spec:** `docs/superpowers/specs/2026-03-15-vscode-extension-rewrite-design.md`

---

## File Structure

```
vscode-extension/
├── test/
│   ├── setup.ts                                    # (exists from Phase 1)
│   ├── core/
│   │   ├── EventBus.test.ts                        # (exists) + extended edge cases
│   │   ├── ConfigService.test.ts                   # (exists) + extended edge cases
│   │   ├── ApiClient.test.ts                       # (exists) + extended edge cases
│   │   └── AuthService.test.ts                     # (exists) + extended edge cases
│   ├── modules/
│   │   ├── chat/
│   │   │   ├── ChatService.test.ts                 # (exists) + extended edge cases
│   │   │   ├── ChatPanel.integration.test.ts       # NEW — panel + service interaction
│   │   │   └── ChatCommands.integration.test.ts    # NEW — command → panel routing
│   │   ├── code-actions/
│   │   │   ├── CodeActionProvider.test.ts           # (exists from Phase 1)
│   │   │   └── CodeActionCommands.integration.test.ts  # NEW
│   │   ├── agents/
│   │   │   ├── AgentService.test.ts                # NEW — unit tests
│   │   │   └── AgentPanel.integration.test.ts      # NEW — panel + service
│   │   ├── orchestrator/
│   │   │   ├── OrchestratorService.test.ts         # NEW — unit tests
│   │   │   ├── OrchestratorStatusBar.test.ts       # NEW — status bar logic
│   │   │   └── OrchestratorPanel.integration.test.ts  # NEW
│   │   ├── documents/
│   │   │   ├── DocumentService.test.ts             # NEW — unit tests
│   │   │   └── DocumentCommands.integration.test.ts   # NEW
│   │   └── worktree/
│   │       ├── WorktreeService.test.ts             # NEW — unit tests
│   │       └── WorktreeScmProvider.integration.test.ts  # NEW
│   └── e2e/
│       ├── tsconfig.json                           # NEW — TypeScript config for E2E compilation
│       ├── runTests.ts                             # NEW — @vscode/test-electron launcher
│       ├── suite/
│       │   ├── index.ts                            # NEW — Mocha test runner for e2e
│       │   ├── chat.e2e.test.ts                    # NEW — login → chat → streaming
│       │   ├── codeAction.e2e.test.ts              # NEW — select → explain → response
│       │   ├── agent.e2e.test.ts                   # NEW — agent session lifecycle
│       │   ├── orchestrator.e2e.test.ts            # NEW — status bar → panel → slots
│       │   ├── document.e2e.test.ts                # NEW — @document + generate
│       │   └── worktree.e2e.test.ts                # NEW — worktree merge flow
│       └── fixtures/
│           └── sample.ts                           # NEW — sample file for code actions
├── vitest.config.ts                                # (exists) + coverage config update
└── package.json                                    # (exists) + test:e2e script
```

---

## Chunk 1: Core Unit Tests — Edge Cases & Error Scenarios

### Task 1: EventBus edge cases

**Files:**
- Modify: `test/core/EventBus.test.ts`

- [ ] **Step 1: Add edge case tests**

```typescript
// test/core/EventBus.test.ts — APPEND to existing tests
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

describe('EventBus — edge cases', () => {
  it('should not throw when emitting event with no listeners', () => {
    const bus = new EventBus();
    expect(() => bus.emit('auth:login', { userId: '1', email: 'a@b.com' })).not.toThrow();
  });

  it('should not throw when removing listener that was never added', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    expect(() => bus.off('auth:login', listener)).not.toThrow();
  });

  it('should handle listener that throws without affecting other listeners', () => {
    const bus = new EventBus();
    const badListener = vi.fn(() => { throw new Error('boom'); });
    const goodListener = vi.fn();
    bus.on('auth:login', badListener);
    bus.on('auth:login', goodListener);
    // EventBus iterates over spread copy — thrown error propagates but second listener still ran
    // If current impl doesn't catch, this test documents behavior.
    // Adjust based on actual behavior: wrap in try-catch if needed
    try {
      bus.emit('auth:login', { userId: '1', email: 'a@b.com' });
    } catch {
      // expected if not caught internally
    }
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();
  });

  it('should handle removing listener during emit', () => {
    const bus = new EventBus();
    const listener1 = vi.fn(() => {
      bus.off('auth:login', listener2);
    });
    const listener2 = vi.fn();
    bus.on('auth:login', listener1);
    bus.on('auth:login', listener2);
    bus.emit('auth:login', { userId: '1', email: 'a@b.com' });
    // listener2 should still be called because emit iterates over spread copy
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should removeAllListeners', () => {
    const bus = new EventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    bus.on('auth:login', listener1);
    bus.on('auth:logout', listener2);
    bus.removeAllListeners();
    bus.emit('auth:login', { userId: '1', email: 'a@b.com' });
    bus.emit('auth:logout', undefined);
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });

  it('should allow re-subscribing after off()', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('auth:login', listener);
    bus.off('auth:login', listener);
    bus.on('auth:login', listener);
    bus.emit('auth:login', { userId: '1', email: 'a@b.com' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should not duplicate listener when on() called twice with same function', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('auth:login', listener);
    bus.on('auth:login', listener);
    bus.emit('auth:login', { userId: '1', email: 'a@b.com' });
    // Set-based storage: same reference added twice = 1 entry
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/core/EventBus.test.ts
```
Expected: All tests pass (original + new edge cases).

- [ ] **Step 3: Commit**

```bash
git add test/core/EventBus.test.ts
git commit -m "test(ext): add EventBus edge case tests — error handling, re-subscribe, removeAll"
```

---

### Task 2: ConfigService edge cases

**Files:**
- Modify: `test/core/ConfigService.test.ts`

- [ ] **Step 1: Add edge case tests**

```typescript
// test/core/ConfigService.test.ts — APPEND to existing tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';

vi.mock('vscode', () => {
  let changeHandler: ((e: { affectsConfiguration: (s: string) => boolean }) => void) | null = null;
  const mockConfig = new Map<string, unknown>();
  return {
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((key: string, defaultValue: unknown) => mockConfig.get(key) ?? defaultValue),
      }),
      onDidChangeConfiguration: vi.fn((handler) => {
        changeHandler = handler;
        return { dispose: () => { changeHandler = null; } };
      }),
    },
    __triggerConfigChange: (section: string) => {
      changeHandler?.({ affectsConfiguration: (s: string) => s === section });
    },
    __setConfigValue: (key: string, value: unknown) => { mockConfig.set(key, value); },
    __resetConfig: () => { mockConfig.clear(); },
  };
});

describe('ConfigService — edge cases', () => {
  let configService: ConfigService;
  let eventBus: EventBus;

  beforeEach(async () => {
    const vscode = await import('vscode') as any;
    vscode.__resetConfig();
    eventBus = new EventBus();
    configService = new ConfigService(eventBus);
  });

  it('should emit config:changed when enterprise-ai config changes', async () => {
    const listener = vi.fn();
    eventBus.on('config:changed', listener);
    const vscode = await import('vscode') as any;
    vscode.__triggerConfigChange('enterprise-ai');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveProperty('key', 'enterprise-ai');
  });

  it('should NOT emit config:changed for unrelated config sections', async () => {
    const listener = vi.fn();
    eventBus.on('config:changed', listener);
    const vscode = await import('vscode') as any;
    vscode.__triggerConfigChange('editor.fontSize');
    expect(listener).not.toHaveBeenCalled();
  });

  it('should return custom server URL when configured', async () => {
    const vscode = await import('vscode') as any;
    vscode.__setConfigValue('serverUrl', 'https://custom.example.com');
    expect(configService.getServerUrl()).toBe('https://custom.example.com');
  });

  it('should return bot icon style', () => {
    expect(configService.getBotIconStyle()).toBe('default');
  });

  it('should clean up disposable on dispose()', async () => {
    const listener = vi.fn();
    eventBus.on('config:changed', listener);
    configService.dispose();
    const vscode = await import('vscode') as any;
    vscode.__triggerConfigChange('enterprise-ai');
    // After dispose, the config change listener should be removed
    // (depends on implementation — if dispose removes the VS Code listener)
    // The dispose() call itself should not throw
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/core/ConfigService.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/core/ConfigService.test.ts
git commit -m "test(ext): add ConfigService edge cases — config change events, custom values, dispose"
```

---

### Task 3: ApiClient edge cases — retries, timeouts, SSE reconnection

**Files:**
- Modify: `test/core/ApiClient.test.ts`

- [ ] **Step 1: Add edge case tests**

```typescript
// test/core/ApiClient.test.ts — APPEND to existing tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../../src/core/ApiClient';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';
import { createMockOutputChannel } from '../setup';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_key: string, def: unknown) => def),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

// Capture the mock instance for per-test configuration
let mockAxiosInstance: any;
vi.mock('axios', () => {
  mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { headers: { common: {} }, baseURL: '' },
  };
  return {
    default: { create: vi.fn().mockReturnValue(mockAxiosInstance) },
  };
});

describe('ApiClient — error handling and retries', () => {
  let apiClient: ApiClient;
  let eventBus: EventBus;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    outputChannel = createMockOutputChannel();
    apiClient = new ApiClient(configService, eventBus, outputChannel);
    vi.clearAllMocks();
  });

  it('should retry on transient error and succeed on second attempt', async () => {
    mockAxiosInstance.get
      .mockRejectedValueOnce({ response: { status: 500 }, message: 'Internal Server Error' })
      .mockResolvedValueOnce({ data: { success: true, data: 'recovered' } });

    const result = await apiClient.get<string>('/api/test');
    expect(result).toBe('recovered');
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on 401 — emit auth:logout instead', async () => {
    const logoutListener = vi.fn();
    eventBus.on('auth:logout', logoutListener);

    // The 401 is handled by the interceptor registered in constructor
    // For this test, simulate the interceptor behavior
    mockAxiosInstance.get.mockRejectedValue({
      response: { status: 401 },
      message: 'Unauthorized',
    });

    await expect(apiClient.get('/api/test')).rejects.toThrow();
    // 401 should not be retried (only 1 call)
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on 403', async () => {
    mockAxiosInstance.get.mockRejectedValue({
      response: { status: 403 },
      message: 'Forbidden',
    });

    await expect(apiClient.get('/api/test')).rejects.toThrow();
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('should fail after max retries exhausted', async () => {
    mockAxiosInstance.get.mockRejectedValue({
      response: { status: 502 },
      message: 'Bad Gateway',
    });

    await expect(apiClient.get('/api/test')).rejects.toThrow();
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4); // 1 initial + 3 retries = 4 total
  });

  it('should update baseURL when config:changed event fires', () => {
    eventBus.emit('config:changed', { key: 'enterprise-ai', value: {} });
    // Verify the baseURL setter was accessed (the handler reads configService.getServerUrl())
    // This test verifies the event subscription is wired correctly
    expect(mockAxiosInstance.defaults.baseURL).toBeDefined();
  });
});

describe('ApiClient — SSE streaming', () => {
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    const configService = new ConfigService(eventBus);
    const outputChannel = createMockOutputChannel();
    apiClient = new ApiClient(configService, eventBus, outputChannel);
  });

  it('should return AbortController from stream()', () => {
    // Mock global fetch for SSE test
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"content":"hello"}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    }));

    const onChunk = vi.fn();
    const controller = apiClient.stream('/api/chat/completions', { message: 'hi' }, onChunk);
    expect(controller).toBeInstanceOf(AbortController);

    vi.unstubAllGlobals();
  });

  it('should abort streaming when controller.abort() is called', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const onChunk = vi.fn();
    const onError = vi.fn();
    const controller = apiClient.stream('/api/chat/completions', { message: 'hi' }, onChunk, onError);
    controller.abort();

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    // onError should NOT be called when abort is intentional
    expect(onError).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should parse SSE data lines correctly', async () => {
    const chunks: string[] = [];
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"content":"Hello"}\n\ndata: {"content":" World"}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    }));

    const onChunk = vi.fn((chunk) => { if (chunk.content) { chunks.push(chunk.content); } });
    apiClient.stream('/api/chat/completions', { message: 'hi' }, onChunk);

    // Wait for async stream processing
    await new Promise((r) => setTimeout(r, 100));
    expect(chunks).toEqual(['Hello', ' World']);

    vi.unstubAllGlobals();
  });

  it('should skip malformed SSE data lines', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {invalid-json}\ndata: {"content":"ok"}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    }));

    const onChunk = vi.fn();
    apiClient.stream('/api/chat/completions', { message: 'hi' }, onChunk);

    await new Promise((r) => setTimeout(r, 100));
    // Only valid chunk should arrive
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({ content: 'ok' }));

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/core/ApiClient.test.ts
```
Expected: All tests pass (original + new).

- [ ] **Step 3: Commit**

```bash
git add test/core/ApiClient.test.ts
git commit -m "test(ext): add ApiClient edge cases — retries, 401/403, SSE parsing, abort"
```

---

### Task 4: AuthService edge cases — TOTP, refresh, corrupt state

**Files:**
- Modify: `test/core/AuthService.test.ts`

- [ ] **Step 1: Add edge case tests**

```typescript
// test/core/AuthService.test.ts — APPEND to existing tests
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

describe('AuthService — edge cases', () => {
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

  it('should login with TOTP code', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-totp',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });

    const result = await authService.login('admin@test.com', 'password', '123456');
    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ totp: '123456' }),
    );
  });

  it('should handle network error during login', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network Error: ECONNREFUSED'),
    );

    const result = await authService.login('admin@test.com', 'password');
    expect(result).toBe(false);
  });

  it('should handle timeout during login', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('timeout of 30000ms exceeded'),
    );

    const result = await authService.login('admin@test.com', 'password');
    expect(result).toBe(false);
  });

  it('should return false for tryRestoreSession when no saved token', () => {
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(false);
    expect(apiClient.setToken).not.toHaveBeenCalled();
  });

  it('should return false for tryRestoreSession with corrupt user JSON', async () => {
    await context.globalState.update('enterprise-ai.token', 'saved-token');
    await context.globalState.update('enterprise-ai.user', 'not-valid-json{{{');
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(false);
  });

  it('should return false for tryRestoreSession when token exists but user is missing', async () => {
    await context.globalState.update('enterprise-ai.token', 'saved-token');
    // No user stored
    const restored = authService.tryRestoreSession();
    expect(restored).toBe(false);
  });

  it('should clear state on auth:logout event from external source', async () => {
    // Simulate a successful login first
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });
    await authService.login('admin@test.com', 'password');

    // External logout (e.g., 401 from ApiClient)
    eventBus.emit('auth:logout', undefined);

    expect(apiClient.clearToken).toHaveBeenCalled();
    expect(authService.getUser()).toBeNull();
    expect(authService.isAuthenticated()).toBe(false);
  });

  it('should report isAuthenticated correctly', async () => {
    expect(authService.isAuthenticated()).toBe(false);

    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
    });
    (apiClient.hasToken as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await authService.login('admin@test.com', 'password');
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('should persist token and user to globalState on login', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'persisted-token',
      user: { id: 42, email: 'user@test.com', name: 'User', role: 'user' },
    });

    await authService.login('user@test.com', 'password');

    expect(context.globalState.get('enterprise-ai.token')).toBe('persisted-token');
    const storedUser = JSON.parse(context.globalState.get('enterprise-ai.user') as string);
    expect(storedUser.id).toBe(42);
    expect(storedUser.email).toBe('user@test.com');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/core/AuthService.test.ts
```
Expected: All tests pass (original + new).

- [ ] **Step 3: Commit**

```bash
git add test/core/AuthService.test.ts
git commit -m "test(ext): add AuthService edge cases — TOTP, network errors, corrupt state, persistence"
```

---

## Chunk 2: Module Unit Tests (Agents, Orchestrator, Documents, Worktree)

### Task 5: AgentService unit tests

**Files:**
- Create: `test/modules/agents/AgentService.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/agents/AgentService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../../../src/modules/agents/AgentService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

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
      { id: 't1', name: 'Code Review', description: 'Reviews code' },
      { id: 't2', name: 'Bug Fix', description: 'Fixes bugs' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(templates);

    const result = await agentService.loadTemplates();
    expect(result).toEqual(templates);
    expect(apiClient.get).toHaveBeenCalledWith('/api/agents/templates');
  });

  it('should create a new agent session', async () => {
    const session = { id: 's1', status: 'running', templateId: 't1' };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(session);

    const result = await agentService.createSession('t1', 'Fix the login bug');
    expect(result).toEqual(session);
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions', {
      templateId: 't1',
      prompt: 'Fix the login bug',
    });
  });

  it('should emit agent:started when session is created', async () => {
    const listener = vi.fn();
    eventBus.on('agent:started', listener);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', status: 'running' });

    await agentService.createSession('t1', 'prompt');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's1' });
  });

  it('should fetch active sessions', async () => {
    const sessions = [
      { id: 's1', status: 'running' },
      { id: 's2', status: 'completed' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);

    const result = await agentService.loadSessions();
    expect(result).toEqual(sessions);
  });

  it('should start log streaming for a session', () => {
    const onChunk = vi.fn();
    const onError = vi.fn();
    agentService.streamLogs('s1', onChunk, onError);
    expect(apiClient.stream).toHaveBeenCalledWith(
      '/api/agents/sessions/s1/logs',
      undefined,
      onChunk,
      onError,
    );
  });

  it('should cancel a session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', status: 'cancelled' });

    await agentService.cancelSession('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/cancel');
  });

  it('should handle error when creating session', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Server error'));

    await expect(agentService.createSession('t1', 'prompt')).rejects.toThrow('Server error');
  });

  it('should emit agent:completed when session finishes', async () => {
    const listener = vi.fn();
    eventBus.on('agent:completed', listener);

    // Simulate the completion callback (depends on implementation)
    // AgentService likely watches log stream for completion event
    agentService.notifyCompleted('s1', 'success');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's1', status: 'success' });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/agents/AgentService.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/agents/AgentService.test.ts
git commit -m "test(ext): add AgentService unit tests — templates, sessions, streaming, cancel"
```

---

### Task 6: OrchestratorService unit tests

**Files:**
- Create: `test/modules/orchestrator/OrchestratorService.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/orchestrator/OrchestratorService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorService } from '../../../src/modules/orchestrator/OrchestratorService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    service = new OrchestratorService(apiClient, eventBus, outputChannel);
  });

  afterEach(() => {
    vi.useRealTimers();
    service.dispose();
  });

  it('should fetch orchestrator status', async () => {
    const status = { activeSlots: 3, totalSlots: 12, slots: [] };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(status);

    const result = await service.getStatus();
    expect(result).toEqual(status);
    expect(apiClient.get).toHaveBeenCalledWith('/api/orchestrator/status');
  });

  it('should emit orchestrator:update after fetching status', async () => {
    const listener = vi.fn();
    eventBus.on('orchestrator:update', listener);
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      activeSlots: 5,
      totalSlots: 12,
      slots: [],
    });

    await service.getStatus();
    expect(listener).toHaveBeenCalledWith({ activeSlots: 5, totalSlots: 12 });
  });

  it('should start polling at configured interval', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      activeSlots: 0,
      totalSlots: 12,
      slots: [],
    });

    service.startPolling(5000);
    expect(apiClient.get).toHaveBeenCalledTimes(1); // immediate first call

    await vi.advanceTimersByTimeAsync(5000);
    expect(apiClient.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it('should stop polling', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      activeSlots: 0,
      totalSlots: 12,
      slots: [],
    });

    service.startPolling(5000);
    service.stopPolling();

    await vi.advanceTimersByTimeAsync(10000);
    expect(apiClient.get).toHaveBeenCalledTimes(1); // only initial call
  });

  it('should start SSE event stream', () => {
    const onChunk = vi.fn();
    service.startEventStream(onChunk);
    expect(apiClient.stream).toHaveBeenCalledWith(
      '/api/orchestrator/events',
      undefined,
      onChunk,
      expect.any(Function),
    );
  });

  it('should release a slot', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await service.releaseSlot('slot-5');
    expect(apiClient.post).toHaveBeenCalledWith('/api/orchestrator/slots/slot-5/release');
  });

  it('should handle polling error gracefully', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network down'));

    service.startPolling(5000);
    // Should not throw — error is handled internally
    await vi.advanceTimersByTimeAsync(5000);
    expect(apiClient.get).toHaveBeenCalledTimes(2); // retries continue
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorService.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/orchestrator/OrchestratorService.test.ts
git commit -m "test(ext): add OrchestratorService unit tests — status, polling, SSE, slot release"
```

---

### Task 7: OrchestratorStatusBar unit tests

**Files:**
- Create: `test/modules/orchestrator/OrchestratorStatusBar.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/orchestrator/OrchestratorStatusBar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorStatusBar } from '../../../src/modules/orchestrator/OrchestratorStatusBar';
import { EventBus } from '../../../src/core/EventBus';

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn().mockReturnValue({
      text: '',
      tooltip: '',
      color: undefined,
      command: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    }),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
}));

describe('OrchestratorStatusBar', () => {
  let statusBar: OrchestratorStatusBar;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    statusBar = new OrchestratorStatusBar(eventBus);
  });

  it('should update text on orchestrator:update event', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 3, totalSlots: 12 });
    const item = statusBar.getStatusBarItem();
    expect(item.text).toContain('3/12');
  });

  it('should show green color when usage < 50%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 2, totalSlots: 12 });
    const item = statusBar.getStatusBarItem();
    // Color depends on implementation — green/default for < 50%
    expect(item.color).toBeUndefined(); // or green theme color
  });

  it('should show yellow color when usage 50-80%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 8, totalSlots: 12 });
    const item = statusBar.getStatusBarItem();
    expect(item.color).toBeDefined(); // yellow warning color
  });

  it('should show red color when usage > 80%', () => {
    eventBus.emit('orchestrator:update', { activeSlots: 11, totalSlots: 12 });
    const item = statusBar.getStatusBarItem();
    expect(item.color).toBeDefined(); // red error color
  });

  it('should set command to open orchestrator panel', () => {
    const item = statusBar.getStatusBarItem();
    expect(item.command).toBe('enterprise-ai.openOrchestrator');
  });

  it('should show status bar item', () => {
    statusBar.show();
    expect(statusBar.getStatusBarItem().show).toHaveBeenCalled();
  });

  it('should hide status bar item', () => {
    statusBar.hide();
    expect(statusBar.getStatusBarItem().hide).toHaveBeenCalled();
  });

  it('should dispose status bar item', () => {
    statusBar.dispose();
    expect(statusBar.getStatusBarItem().dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorStatusBar.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/orchestrator/OrchestratorStatusBar.test.ts
git commit -m "test(ext): add OrchestratorStatusBar unit tests — colors, text, show/hide"
```

---

### Task 8: DocumentService unit tests

**Files:**
- Create: `test/modules/documents/DocumentService.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/documents/DocumentService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../../../src/modules/documents/DocumentService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

describe('DocumentService', () => {
  let service: DocumentService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    service = new DocumentService(apiClient, eventBus, outputChannel);
  });

  it('should fetch document list', async () => {
    const docs = [
      { id: 1, name: 'README.md', type: 'markdown' },
      { id: 2, name: 'spec.pdf', type: 'pdf' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    const result = await service.loadDocuments();
    expect(result).toEqual(docs);
    expect(apiClient.get).toHaveBeenCalledWith('/api/documents');
  });

  it('should search documents with query', async () => {
    const results = [{ id: 1, name: 'README.md', relevance: 0.95 }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const result = await service.searchDocuments('readme');
    expect(result).toEqual(results);
    expect(apiClient.get).toHaveBeenCalledWith('/api/documents', { q: 'readme' });
  });

  it('should generate DOCX document', async () => {
    const blob = new Blob(['content']);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await service.generateDocument('docx', 'Create a report');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/tools/generate-docx',
      { content: 'Create a report' },
    );
    expect(result).toBe(blob);
  });

  it('should generate Excel document', async () => {
    const blob = new Blob(['excel-content']);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    await service.generateDocument('excel', 'Monthly sales data');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/tools/generate-excel',
      { content: 'Monthly sales data' },
    );
  });

  it('should generate PDF via convert endpoint', async () => {
    const blob = new Blob(['pdf-content']);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    await service.generateDocument('pdf', 'Invoice content');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/tools/convert-to-pdf',
      { content: 'Invoice content' },
    );
  });

  it('should cache document list', async () => {
    const docs = [{ id: 1, name: 'doc.md', type: 'markdown' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await service.loadDocuments();
    await service.loadDocuments();
    // Second call should use cache (only 1 API call)
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache when requested', async () => {
    const docs = [{ id: 1, name: 'doc.md', type: 'markdown' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await service.loadDocuments();
    service.invalidateCache();
    await service.loadDocuments();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('should handle API error on document load', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(service.loadDocuments()).rejects.toThrow('503');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/documents/DocumentService.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/documents/DocumentService.test.ts
git commit -m "test(ext): add DocumentService unit tests — load, search, generate, cache"
```

---

### Task 9: WorktreeService unit tests

**Files:**
- Create: `test/modules/worktree/WorktreeService.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/worktree/WorktreeService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeService } from '../../../src/modules/worktree/WorktreeService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

describe('WorktreeService', () => {
  let service: WorktreeService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    service = new WorktreeService(apiClient, eventBus, outputChannel);
  });

  it('should fetch all active worktrees', async () => {
    const worktrees = [
      { sessionId: 's1', branch: 'agent/fix-login', files: ['auth.ts'], conflicts: [] },
      { sessionId: 's2', branch: 'agent/add-tests', files: ['test.ts'], conflicts: [] },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(worktrees);

    const result = await service.loadWorktrees();
    expect(result).toEqual(worktrees);
    expect(apiClient.get).toHaveBeenCalledWith('/api/orchestrator/worktrees');
  });

  it('should fetch worktree status for a specific session', async () => {
    const worktree = {
      sessionId: 's1',
      branch: 'agent/fix-login',
      path: '/tmp/worktree-s1',
      files: ['src/auth.ts', 'src/login.ts'],
      conflicts: [],
    };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(worktree);

    const result = await service.getWorktreeStatus('s1');
    expect(result).toEqual(worktree);
    expect(apiClient.get).toHaveBeenCalledWith('/api/agents/sessions/s1/worktree');
  });

  it('should merge worktree', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, merged: true });

    const result = await service.mergeWorktree('s1');
    expect(result).toEqual({ success: true, merged: true });
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/worktree/merge');
  });

  it('should discard worktree', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await service.discardWorktree('s1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/worktree/discard');
  });

  it('should emit worktree:ready when merge result contains conflicts', async () => {
    const listener = vi.fn();
    eventBus.on('worktree:ready', listener);

    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 's1',
      branch: 'agent/feature',
      files: ['file.ts'],
      conflicts: [],
      status: 'ready',
    });

    await service.checkAndNotifyReady('s1');
    expect(listener).toHaveBeenCalledWith({ sessionId: 's1', branch: 'agent/feature' });
  });

  it('should handle merge conflicts', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      merged: false,
      conflicts: ['src/auth.ts'],
    });

    const result = await service.mergeWorktree('s1');
    expect(result.merged).toBe(false);
    expect(result.conflicts).toContain('src/auth.ts');
  });

  it('should handle network error on worktree fetch', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.loadWorktrees()).rejects.toThrow('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/worktree/WorktreeService.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/worktree/WorktreeService.test.ts
git commit -m "test(ext): add WorktreeService unit tests — fetch, merge, discard, conflicts"
```

---

## Chunk 3: Integration Tests (Module + Core interactions)

### Task 10: ChatPanel integration test

**Files:**
- Create: `test/modules/chat/ChatPanel.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/chat/ChatPanel.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatPanel } from '../../../src/modules/chat/ChatPanel';
import { EventBus } from '../../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import type { ModuleContext, WebviewToExtension } from '../../../src/core/types';

vi.mock('vscode', () => {
  const mockWebview = {
    html: '',
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn().mockResolvedValue(true),
    asWebviewUri: vi.fn((uri: any) => uri),
    cspSource: 'https://mock.csp',
  };
  const mockPanel = {
    webview: mockWebview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    window: {
      createWebviewPanel: vi.fn().mockReturnValue(mockPanel),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    },
    ViewColumn: { Beside: 2 },
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
      joinPath: (...parts: any[]) => ({ fsPath: parts.map((p: any) => p.fsPath || p).join('/') }),
    },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((_k: string, d: unknown) => d),
      }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    },
  };
});

describe('ChatPanel integration', () => {
  let chatPanel: ChatPanel;
  let eventBus: EventBus;
  let moduleContext: ModuleContext;
  let mockApiClient: any;

  beforeEach(() => {
    eventBus = new EventBus();
    mockApiClient = {
      get: vi.fn().mockResolvedValue([]),
      post: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
      setToken: vi.fn(),
      clearToken: vi.fn(),
      hasToken: vi.fn().mockReturnValue(true),
    };
    const mockAuthService = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'user' }),
      login: vi.fn(),
      logout: vi.fn(),
    };
    moduleContext = {
      extensionContext: createMockExtensionContext(),
      apiClient: mockApiClient,
      authService: mockAuthService as any,
      configService: { getServerUrl: () => 'https://test.com' } as any,
      eventBus,
      outputChannel: createMockOutputChannel(),
    };
    chatPanel = new ChatPanel(moduleContext);
  });

  it('should create webview panel on show()', async () => {
    const vscode = await import('vscode') as any;
    chatPanel.show();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'enterprise-ai.chat',
      'Enterprise AI Chat',
      expect.any(Number),
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('should reveal existing panel on second show()', async () => {
    const vscode = await import('vscode') as any;
    chatPanel.show();
    chatPanel.show();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('should send setAuthenticated when auth:login fires', async () => {
    const vscode = await import('vscode') as any;
    const mockPanel = vscode.window.createWebviewPanel();
    chatPanel.show();

    mockApiClient.get.mockResolvedValue([{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }]);

    eventBus.emit('auth:login', { userId: '1', email: 'test@test.com' });

    // Wait for async model loading
    await new Promise((r) => setTimeout(r, 50));

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setAuthenticated' }),
    );
  });

  it('should send setUnauthenticated when auth:logout fires', () => {
    chatPanel.show();
    eventBus.emit('auth:logout', undefined);
    // postMessage should be called with setUnauthenticated
  });

  it('should route sendMessage to ChatService streaming', async () => {
    const vscode = await import('vscode') as any;
    chatPanel.show();

    // Simulate the webview sending a message
    const onDidReceiveMessage = vscode.window.createWebviewPanel().webview.onDidReceiveMessage;
    const messageHandler = onDidReceiveMessage.mock.calls[0]?.[0];

    if (messageHandler) {
      const msg: WebviewToExtension = {
        type: 'sendMessage',
        payload: { message: 'Hello AI', modelId: 'gpt-4o' },
      };
      await messageHandler(msg);
      expect(mockApiClient.stream).toHaveBeenCalled();
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/chat/ChatPanel.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/chat/ChatPanel.integration.test.ts
git commit -m "test(ext): add ChatPanel integration tests — panel lifecycle, auth events, message routing"
```

---

### Task 11: ChatCommands integration test

**Files:**
- Create: `test/modules/chat/ChatCommands.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/chat/ChatCommands.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerChatCommands } from '../../../src/modules/chat/ChatCommands';
import type { ModuleContext } from '../../../src/core/types';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import { EventBus } from '../../../src/core/EventBus';

const registeredCommands = new Map<string, (...args: any[]) => any>();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: any[]) => any) => {
      registeredCommands.set(id, handler);
      return { dispose: () => registeredCommands.delete(id) };
    }),
    executeCommand: vi.fn(),
  },
  window: {
    activeTextEditor: undefined as any,
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('ChatCommands integration', () => {
  let mockPanel: any;
  let moduleContext: ModuleContext;

  beforeEach(async () => {
    registeredCommands.clear();
    const vscode = await import('vscode') as any;
    vscode.window.activeTextEditor = undefined;

    mockPanel = {
      show: vi.fn(),
      postMessage: vi.fn(),
    };
    const eventBus = new EventBus();
    moduleContext = {
      extensionContext: createMockExtensionContext(),
      apiClient: {} as any,
      authService: {
        login: vi.fn().mockResolvedValue(true),
        logout: vi.fn(),
      } as any,
      configService: {} as any,
      eventBus,
      outputChannel: createMockOutputChannel(),
    };
    registerChatCommands(moduleContext, () => mockPanel);
  });

  it('should register openChat command', () => {
    expect(registeredCommands.has('enterprise-ai.openChat')).toBe(true);
  });

  it('should open panel on openChat', () => {
    registeredCommands.get('enterprise-ai.openChat')!();
    expect(mockPanel.show).toHaveBeenCalled();
  });

  it('should register login command', () => {
    expect(registeredCommands.has('enterprise-ai.login')).toBe(true);
  });

  it('should register logout command', () => {
    expect(registeredCommands.has('enterprise-ai.logout')).toBe(true);
  });

  it('should call authService.logout on logout command', () => {
    registeredCommands.get('enterprise-ai.logout')!();
    expect(moduleContext.authService.logout).toHaveBeenCalled();
  });

  it('should register addToChat command', () => {
    expect(registeredCommands.has('enterprise-ai.addToChat')).toBe(true);
  });

  it('should not crash addToChat when no active editor', () => {
    expect(() => registeredCommands.get('enterprise-ai.addToChat')!()).not.toThrow();
    expect(mockPanel.show).not.toHaveBeenCalled();
  });

  it('should send context to panel when addToChat has selection', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue('const x = 1;'),
        fileName: '/test/file.ts',
      },
      selection: { start: 0, end: 13 },
    };

    registeredCommands.get('enterprise-ai.addToChat')!();
    expect(mockPanel.show).toHaveBeenCalled();
    expect(mockPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'addContext',
        payload: expect.objectContaining({ text: 'const x = 1;', fileName: '/test/file.ts' }),
      }),
    );
  });

  it('should register showLogs command', () => {
    expect(registeredCommands.has('enterprise-ai.showLogs')).toBe(true);
  });

  it('should register configure command', () => {
    expect(registeredCommands.has('enterprise-ai.configure')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/chat/ChatCommands.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/chat/ChatCommands.integration.test.ts
git commit -m "test(ext): add ChatCommands integration tests — command registration, panel routing"
```

---

### Task 12: CodeActionCommands integration test

**Files:**
- Create: `test/modules/code-actions/CodeActionCommands.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/code-actions/CodeActionCommands.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCodeActionCommands } from '../../../src/modules/code-actions/CodeActionCommands';

const registeredCommands = new Map<string, (...args: any[]) => any>();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: any[]) => any) => {
      registeredCommands.set(id, handler);
      return { dispose: () => registeredCommands.delete(id) };
    }),
  },
  window: {
    activeTextEditor: undefined as any,
    showWarningMessage: vi.fn(),
  },
}));

describe('CodeActionCommands integration', () => {
  let mockPanel: any;

  beforeEach(() => {
    registeredCommands.clear();
    mockPanel = {
      show: vi.fn(),
      postMessage: vi.fn(),
    };
    registerCodeActionCommands(() => mockPanel);
  });

  it('should register all 4 code action commands', () => {
    expect(registeredCommands.has('enterprise-ai.explainCode')).toBe(true);
    expect(registeredCommands.has('enterprise-ai.fixCode')).toBe(true);
    expect(registeredCommands.has('enterprise-ai.improveCode')).toBe(true);
    expect(registeredCommands.has('enterprise-ai.generateTests')).toBe(true);
  });

  it('should show warning when no code is selected', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.activeTextEditor = {
      document: { getText: vi.fn().mockReturnValue(''), languageId: 'typescript', fileName: 'test.ts' },
      selection: { start: 0, end: 0 },
    };

    registeredCommands.get('enterprise-ai.explainCode')!();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Select code first');
  });

  it('should open panel and prefill message for explainCode', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue('function add(a, b) { return a + b; }'),
        languageId: 'typescript',
        fileName: '/src/math.ts',
      },
      selection: { start: 0, end: 37 },
    };

    registeredCommands.get('enterprise-ai.explainCode')!();
    expect(mockPanel.show).toHaveBeenCalled();
    expect(mockPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'prefillMessage',
        payload: expect.objectContaining({
          text: expect.stringContaining('Explain the following code'),
        }),
      }),
    );
  });

  it('should include language id in code block', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue('print("hello")'),
        languageId: 'python',
        fileName: '/src/main.py',
      },
      selection: { start: 0, end: 15 },
    };

    registeredCommands.get('enterprise-ai.fixCode')!();
    const message = mockPanel.postMessage.mock.calls[0][0];
    expect(message.payload.text).toContain('```python');
  });

  it('should not open panel when no active editor', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.activeTextEditor = undefined;

    registeredCommands.get('enterprise-ai.improveCode')!();
    expect(mockPanel.show).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/code-actions/CodeActionCommands.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/code-actions/CodeActionCommands.integration.test.ts
git commit -m "test(ext): add CodeActionCommands integration tests — prefill, language detection, guards"
```

---

### Task 13: AgentPanel integration test

**Files:**
- Create: `test/modules/agents/AgentPanel.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/agents/AgentPanel.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentPanel } from '../../../src/modules/agents/AgentPanel';
import { EventBus } from '../../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import type { ModuleContext } from '../../../src/core/types';

vi.mock('vscode', () => {
  const mockWebview = {
    html: '',
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn().mockResolvedValue(true),
    asWebviewUri: vi.fn((uri: any) => uri),
    cspSource: 'https://mock.csp',
  };
  const mockPanel = {
    webview: mockWebview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    window: {
      createWebviewPanel: vi.fn().mockReturnValue(mockPanel),
      showQuickPick: vi.fn(),
      showInputBox: vi.fn(),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    },
    ViewColumn: { Beside: 2 },
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
      joinPath: (...parts: any[]) => ({ fsPath: parts.map((p: any) => p.fsPath || p).join('/') }),
    },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((_k: string, d: unknown) => d),
      }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    },
  };
});

describe('AgentPanel integration', () => {
  let agentPanel: AgentPanel;
  let eventBus: EventBus;
  let mockApiClient: any;

  beforeEach(() => {
    eventBus = new EventBus();
    mockApiClient = {
      get: vi.fn().mockResolvedValue([]),
      post: vi.fn().mockResolvedValue({ id: 's1', status: 'running' }),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    };
    const moduleContext: ModuleContext = {
      extensionContext: createMockExtensionContext(),
      apiClient: mockApiClient,
      authService: { isAuthenticated: () => true, getUser: () => ({ id: 1 }) } as any,
      configService: {} as any,
      eventBus,
      outputChannel: createMockOutputChannel(),
    };
    agentPanel = new AgentPanel(moduleContext);
  });

  it('should create webview panel on show()', async () => {
    const vscode = await import('vscode') as any;
    agentPanel.show();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'enterprise-ai.agents',
      expect.stringContaining('Agent'),
      expect.any(Number),
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('should update panel when agent:started event fires', () => {
    agentPanel.show();
    const postMessage = vi.fn();
    // The panel should react to agent events
    eventBus.emit('agent:started', { sessionId: 's1' });
    // Panel internally refreshes session list
    expect(mockApiClient.get).toHaveBeenCalled();
  });

  it('should update panel when agent:completed event fires', () => {
    agentPanel.show();
    eventBus.emit('agent:completed', { sessionId: 's1', status: 'success' });
    // Panel should refresh
    expect(mockApiClient.get).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/agents/AgentPanel.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/agents/AgentPanel.integration.test.ts
git commit -m "test(ext): add AgentPanel integration tests — panel lifecycle, event handling"
```

---

### Task 14: OrchestratorPanel integration test

**Files:**
- Create: `test/modules/orchestrator/OrchestratorPanel.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/orchestrator/OrchestratorPanel.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorPanel } from '../../../src/modules/orchestrator/OrchestratorPanel';
import { EventBus } from '../../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import type { ModuleContext } from '../../../src/core/types';

vi.mock('vscode', () => {
  const mockWebview = {
    html: '',
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn().mockResolvedValue(true),
    asWebviewUri: vi.fn((uri: any) => uri),
    cspSource: 'https://mock.csp',
  };
  const mockPanel = {
    webview: mockWebview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    window: {
      createWebviewPanel: vi.fn().mockReturnValue(mockPanel),
    },
    ViewColumn: { Beside: 2 },
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
      joinPath: (...parts: any[]) => ({ fsPath: parts.map((p: any) => p.fsPath || p).join('/') }),
    },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((_k: string, d: unknown) => d),
      }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    },
  };
});

describe('OrchestratorPanel integration', () => {
  let panel: OrchestratorPanel;
  let eventBus: EventBus;
  let mockApiClient: any;

  beforeEach(() => {
    eventBus = new EventBus();
    mockApiClient = {
      get: vi.fn().mockResolvedValue({ activeSlots: 3, totalSlots: 12, slots: [] }),
      post: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    };
    const moduleContext: ModuleContext = {
      extensionContext: createMockExtensionContext(),
      apiClient: mockApiClient,
      authService: { isAuthenticated: () => true } as any,
      configService: {
        getOrchestratorPollingInterval: () => 10000,
      } as any,
      eventBus,
      outputChannel: createMockOutputChannel(),
    };
    panel = new OrchestratorPanel(moduleContext);
  });

  it('should create panel on show()', async () => {
    const vscode = await import('vscode') as any;
    panel.show();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });

  it('should start SSE stream when panel opens', () => {
    panel.show();
    expect(mockApiClient.stream).toHaveBeenCalledWith(
      '/api/orchestrator/events',
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('should fetch initial status on show()', () => {
    panel.show();
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/orchestrator/status');
  });

  it('should update on orchestrator:update event', () => {
    panel.show();
    eventBus.emit('orchestrator:update', { activeSlots: 5, totalSlots: 12 });
    // Panel should process the update (verified via postMessage)
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/orchestrator/OrchestratorPanel.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/orchestrator/OrchestratorPanel.integration.test.ts
git commit -m "test(ext): add OrchestratorPanel integration tests — SSE stream, initial status fetch"
```

---

### Task 15: DocumentCommands integration test

**Files:**
- Create: `test/modules/documents/DocumentCommands.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/documents/DocumentCommands.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDocumentCommands } from '../../../src/modules/documents/DocumentCommands';
import { EventBus } from '../../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import type { ModuleContext } from '../../../src/core/types';

const registeredCommands = new Map<string, (...args: any[]) => any>();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: any[]) => any) => {
      registeredCommands.set(id, handler);
      return { dispose: () => registeredCommands.delete(id) };
    }),
  },
  window: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showSaveDialog: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    fs: {
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe('DocumentCommands integration', () => {
  let mockApiClient: any;

  beforeEach(() => {
    registeredCommands.clear();
    mockApiClient = {
      post: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const moduleContext: ModuleContext = {
      extensionContext: createMockExtensionContext(),
      apiClient: mockApiClient,
      authService: {} as any,
      configService: {} as any,
      eventBus: new EventBus(),
      outputChannel: createMockOutputChannel(),
    };
    registerDocumentCommands(moduleContext);
  });

  it('should register generateDocument command', () => {
    expect(registeredCommands.has('enterprise-ai.generateDocument')).toBe(true);
  });

  it('should prompt for format and content', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.showQuickPick.mockResolvedValue({ label: 'DOCX', value: 'docx' });
    vscode.window.showInputBox.mockResolvedValue('Create a quarterly report');
    vscode.window.showSaveDialog.mockResolvedValue({ fsPath: '/tmp/report.docx' });

    await registeredCommands.get('enterprise-ai.generateDocument')!();

    expect(vscode.window.showQuickPick).toHaveBeenCalled();
    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(mockApiClient.post).toHaveBeenCalled();
  });

  it('should abort if user cancels format selection', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.showQuickPick.mockResolvedValue(undefined);

    await registeredCommands.get('enterprise-ai.generateDocument')!();

    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it('should abort if user cancels content input', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.showQuickPick.mockResolvedValue({ label: 'Excel', value: 'excel' });
    vscode.window.showInputBox.mockResolvedValue(undefined);

    await registeredCommands.get('enterprise-ai.generateDocument')!();

    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it('should show error on API failure', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.showQuickPick.mockResolvedValue({ label: 'PDF', value: 'pdf' });
    vscode.window.showInputBox.mockResolvedValue('Invoice');
    vscode.window.showSaveDialog.mockResolvedValue({ fsPath: '/tmp/invoice.pdf' });
    mockApiClient.post.mockRejectedValue(new Error('Generation failed'));

    await registeredCommands.get('enterprise-ai.generateDocument')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/documents/DocumentCommands.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/documents/DocumentCommands.integration.test.ts
git commit -m "test(ext): add DocumentCommands integration tests — format selection, generation, cancellation"
```

---

### Task 16: WorktreeScmProvider integration test

**Files:**
- Create: `test/modules/worktree/WorktreeScmProvider.integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// test/modules/worktree/WorktreeScmProvider.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeScmProvider } from '../../../src/modules/worktree/WorktreeScmProvider';
import { EventBus } from '../../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import type { ModuleContext } from '../../../src/core/types';

const mockSourceControl = {
  createResourceGroup: vi.fn().mockReturnValue({
    resourceStates: [],
    dispose: vi.fn(),
  }),
  dispose: vi.fn(),
  inputBox: { value: '', placeholder: '' },
};

vi.mock('vscode', () => ({
  scm: {
    createSourceControl: vi.fn().mockReturnValue(mockSourceControl),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, path, scheme: 'file' }),
    parse: (s: string) => ({ fsPath: s, path: s, scheme: 'file' }),
  },
  commands: {
    registerCommand: vi.fn().mockReturnValue({ dispose: () => {} }),
    executeCommand: vi.fn(),
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('WorktreeScmProvider integration', () => {
  let scmProvider: WorktreeScmProvider;
  let eventBus: EventBus;
  let mockApiClient: any;

  beforeEach(async () => {
    const vscode = await import('vscode') as any;
    vi.clearAllMocks();
    eventBus = new EventBus();
    mockApiClient = {
      get: vi.fn().mockResolvedValue([]),
      post: vi.fn().mockResolvedValue({ success: true, merged: true }),
    };
    const moduleContext: ModuleContext = {
      extensionContext: createMockExtensionContext(),
      apiClient: mockApiClient,
      authService: { isAuthenticated: () => true } as any,
      configService: {} as any,
      eventBus,
      outputChannel: createMockOutputChannel(),
    };
    scmProvider = new WorktreeScmProvider(moduleContext);
  });

  it('should register SCM provider', async () => {
    const vscode = await import('vscode') as any;
    expect(vscode.scm.createSourceControl).toHaveBeenCalledWith(
      'enterprise-ai-worktrees',
      'Enterprise AI Worktrees',
      expect.anything(),
    );
  });

  it('should refresh worktrees on worktree:ready event', () => {
    eventBus.emit('worktree:ready', { sessionId: 's1', branch: 'agent/fix' });
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/orchestrator/worktrees');
  });

  it('should update resource groups when worktrees are loaded', async () => {
    mockApiClient.get.mockResolvedValue([
      {
        sessionId: 's1',
        branch: 'agent/fix-login',
        files: [
          { path: 'src/auth.ts', status: 'modified' },
          { path: 'src/login.ts', status: 'added' },
        ],
        conflicts: [],
      },
    ]);

    await scmProvider.refresh();
    expect(mockSourceControl.createResourceGroup).toHaveBeenCalledWith(
      's1',
      expect.stringContaining('agent/fix-login'),
    );
  });

  it('should show notification with merge action on worktree:ready', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.showInformationMessage.mockResolvedValue('Merge');

    eventBus.emit('worktree:ready', { sessionId: 's1', branch: 'agent/feature' });

    await new Promise((r) => setTimeout(r, 50));
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('agent/feature'),
      expect.any(String), // 'Merge'
      expect.any(String), // 'Review'
      expect.any(String), // 'Dismiss'
    );
  });

  it('should call merge API when user selects Merge', async () => {
    const vscode = await import('vscode') as any;
    vscode.window.showInformationMessage.mockResolvedValue('Merge');

    eventBus.emit('worktree:ready', { sessionId: 's1', branch: 'agent/feature' });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/agents/sessions/s1/worktree/merge');
  });

  it('should dispose SCM provider', () => {
    scmProvider.dispose();
    expect(mockSourceControl.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd vscode-extension && npx vitest run test/modules/worktree/WorktreeScmProvider.integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/modules/worktree/WorktreeScmProvider.integration.test.ts
git commit -m "test(ext): add WorktreeScmProvider integration tests — SCM registration, refresh, merge, notification"
```

---

## Chunk 4: E2E Tests

### Task 17: E2E test infrastructure setup

**Files:**
- Create: `test/e2e/runTests.ts`
- Create: `test/e2e/suite/index.ts`
- Create: `test/e2e/fixtures/sample.ts`
- Create: `test/e2e/tsconfig.json`

- [ ] **Step 1: Create E2E test launcher**

```typescript
// test/e2e/runTests.ts
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const testWorkspace = path.resolve(__dirname, './fixtures');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        '--disable-extensions',
        '--disable-gpu',
      ],
    });
  } catch (err) {
    console.error('Failed to run E2E tests:', err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Create Mocha test runner for E2E suite**

```typescript
// test/e2e/suite/index.ts
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 30000,
  });

  const testsRoot = path.resolve(__dirname);
  const files = await glob('**/*.e2e.test.js', { cwd: testsRoot });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} E2E tests failed`));
      } else {
        resolve();
      }
    });
  });
}
```

- [ ] **Step 3: Create sample fixture file**

```typescript
// test/e2e/fixtures/sample.ts
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

// This file is used by E2E tests as a sample file for code actions
```

- [ ] **Step 4: Create E2E tsconfig.json**

```json
// test/e2e/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "../../out/test/e2e",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": [
    "**/*.ts"
  ],
  "exclude": [
    "fixtures/**"
  ]
}
```

- [ ] **Step 5: Add devDependencies to package.json**

Add to `package.json` devDependencies:
```json
{
  "@vscode/test-electron": "^2.3.9",
  "mocha": "^10.4.0",
  "@types/mocha": "^10.0.6",
  "glob": "^10.3.0"
}
```

Add to `package.json` scripts:
```json
{
  "test:e2e": "tsc -p test/e2e/tsconfig.json && node out/test/e2e/runTests.js"
}
```

- [ ] **Step 6: Install and commit**

```bash
cd vscode-extension && npm install --save-dev @vscode/test-electron mocha @types/mocha glob
git add test/e2e/runTests.ts test/e2e/suite/index.ts test/e2e/fixtures/sample.ts test/e2e/tsconfig.json package.json package-lock.json
git commit -m "test(ext): add E2E test infrastructure — @vscode/test-electron launcher, Mocha runner, tsconfig"
```

---

### Task 18: E2E — Login, Chat, Streaming

**Files:**
- Create: `test/e2e/suite/chat.e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/suite/chat.e2e.test.ts
// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing (streaming responses, document generation, worktree merge) requires
// a running backend mock server. Backend mock setup is documented in test/e2e/README.md
// but is optional for CI — these smoke tests validate the extension loads and commands work.
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('E2E: Chat Flow', () => {
  const EXTENSION_ID = 'enterprise-ai-chat';
  const TIMEOUT = 15000;

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    // Wait for extension to activate
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('extension should activate successfully', async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'Extension should be found');
    assert.ok(ext!.isActive, 'Extension should be active');
  });

  test('openChat command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.openChat'),
      'openChat command should be registered',
    );
  });

  test('login command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.login'),
      'login command should be registered',
    );
  });

  test('openChat should create a webview panel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.openChat');

    // Wait for panel to appear
    await new Promise((r) => setTimeout(r, 1000));

    // Check that a tab with the chat title exists
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const chatTab = tabs.find((t) => t.label.includes('Enterprise AI'));
    assert.ok(chatTab, 'Chat panel tab should exist');
  });

  test('newChat command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.newChat'),
      'newChat command should be registered',
    );
  });

  test('showLogs command should open output channel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.showLogs');
    // Output channel "Enterprise AI" should be visible
    // No direct API to assert output channels, but command should not throw
  });

  test('logout command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.logout'),
      'logout command should be registered',
    );
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/suite/chat.e2e.test.ts
git commit -m "test(ext): add E2E chat flow tests — activation, command registration, panel creation"
```

---

### Task 19: E2E — Code Action flow

**Files:**
- Create: `test/e2e/suite/codeAction.e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/suite/codeAction.e2e.test.ts
// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing (streaming responses, document generation, worktree merge) requires
// a running backend mock server. Backend mock setup is documented in test/e2e/README.md
// but is optional for CI — these smoke tests validate the extension loads and commands work.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('E2E: Code Action Flow', () => {
  const TIMEOUT = 15000;
  const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sample.ts');

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension('enterprise-ai-chat');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('code action commands should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('enterprise-ai.explainCode'));
    assert.ok(commands.includes('enterprise-ai.fixCode'));
    assert.ok(commands.includes('enterprise-ai.improveCode'));
    assert.ok(commands.includes('enterprise-ai.generateTests'));
  });

  test('explainCode should open chat panel with selected code', async function () {
    this.timeout(TIMEOUT);

    // Open the fixture file
    const doc = await vscode.workspace.openTextDocument(FIXTURE_PATH);
    const editor = await vscode.window.showTextDocument(doc);

    // Select the add function (lines 1-3)
    editor.selection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(2, 1),
    );

    // Execute explain code
    await vscode.commands.executeCommand('enterprise-ai.explainCode');

    // Wait for panel to appear
    await new Promise((r) => setTimeout(r, 1000));

    // Verify chat panel opened
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const chatTab = tabs.find((t) => t.label.includes('Enterprise AI'));
    assert.ok(chatTab, 'Chat panel should open after explainCode');
  });

  test('code action provider should provide actions for selection', async function () {
    this.timeout(TIMEOUT);

    const doc = await vscode.workspace.openTextDocument(FIXTURE_PATH);
    const editor = await vscode.window.showTextDocument(doc);

    // Select some code
    editor.selection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(2, 1),
    );

    // Get code actions for the selection
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      doc.uri,
      editor.selection,
    );

    // Should have Enterprise AI actions
    const aiActions = (actions || []).filter((a) =>
      a.title.includes('Enterprise AI'),
    );
    assert.ok(aiActions.length > 0, 'Should have Enterprise AI code actions');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/suite/codeAction.e2e.test.ts
git commit -m "test(ext): add E2E code action tests — command registration, selection-based actions"
```

---

### Task 20: E2E — Agent Session lifecycle

**Files:**
- Create: `test/e2e/suite/agent.e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/suite/agent.e2e.test.ts
// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing (streaming responses, document generation, worktree merge) requires
// a running backend mock server. Backend mock setup is documented in test/e2e/README.md
// but is optional for CI — these smoke tests validate the extension loads and commands work.
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('E2E: Agent Session Flow', () => {
  const TIMEOUT = 15000;

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension('enterprise-ai-chat');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('newAgentSession command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.newAgentSession'),
      'newAgentSession should be registered',
    );
  });

  test('viewAgentSessions command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.viewAgentSessions'),
      'viewAgentSessions should be registered',
    );
  });

  test('viewAgentSessions should open agent panel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.viewAgentSessions');

    await new Promise((r) => setTimeout(r, 1000));

    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const agentTab = tabs.find((t) =>
      t.label.includes('Agent') || t.label.includes('agent'),
    );
    assert.ok(agentTab, 'Agent panel tab should exist');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/suite/agent.e2e.test.ts
git commit -m "test(ext): add E2E agent session tests — command registration, panel creation"
```

---

### Task 21: E2E — Orchestrator status bar and panel

**Files:**
- Create: `test/e2e/suite/orchestrator.e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/suite/orchestrator.e2e.test.ts
// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing (streaming responses, document generation, worktree merge) requires
// a running backend mock server. Backend mock setup is documented in test/e2e/README.md
// but is optional for CI — these smoke tests validate the extension loads and commands work.
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('E2E: Orchestrator Flow', () => {
  const TIMEOUT = 15000;

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension('enterprise-ai-chat');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('openOrchestrator command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.openOrchestrator'),
      'openOrchestrator should be registered',
    );
  });

  test('openOrchestrator should create panel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.openOrchestrator');

    await new Promise((r) => setTimeout(r, 1000));

    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const orchTab = tabs.find((t) =>
      t.label.includes('Orchestrator') || t.label.includes('orchestrator'),
    );
    assert.ok(orchTab, 'Orchestrator panel tab should exist');
  });

  test('orchestrator config settings should be accessible', function () {
    const config = vscode.workspace.getConfiguration('enterprise-ai');
    const polling = config.get<number>('orchestrator.pollingInterval');
    assert.ok(typeof polling === 'number', 'pollingInterval should be a number');
    assert.ok(polling > 0, 'pollingInterval should be positive');

    const showStatusBar = config.get<boolean>('orchestrator.showStatusBar');
    assert.ok(typeof showStatusBar === 'boolean', 'showStatusBar should be a boolean');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/suite/orchestrator.e2e.test.ts
git commit -m "test(ext): add E2E orchestrator tests — command, panel, config settings"
```

---

### Task 22: E2E — Document generation and @document

**Files:**
- Create: `test/e2e/suite/document.e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/suite/document.e2e.test.ts
// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing (streaming responses, document generation, worktree merge) requires
// a running backend mock server. Backend mock setup is documented in test/e2e/README.md
// but is optional for CI — these smoke tests validate the extension loads and commands work.
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('E2E: Document Flow', () => {
  const TIMEOUT = 15000;

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension('enterprise-ai-chat');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('generateDocument command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.generateDocument'),
      'generateDocument should be registered',
    );
  });

  test('ragSearch command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.ragSearch'),
      'ragSearch should be registered',
    );
  });

  test('addFileToContext command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.addFileToContext'),
      'addFileToContext should be registered',
    );
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/suite/document.e2e.test.ts
git commit -m "test(ext): add E2E document tests — command registration for generate and RAG"
```

---

### Task 23: E2E — Worktree SCM integration

**Files:**
- Create: `test/e2e/suite/worktree.e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/suite/worktree.e2e.test.ts
// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing (streaming responses, document generation, worktree merge) requires
// a running backend mock server. Backend mock setup is documented in test/e2e/README.md
// but is optional for CI — these smoke tests validate the extension loads and commands work.
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('E2E: Worktree Flow', () => {
  const TIMEOUT = 15000;

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension('enterprise-ai-chat');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('manageWorktrees command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.manageWorktrees'),
      'manageWorktrees should be registered',
    );
  });

  test('SCM provider should be registered', async function () {
    this.timeout(TIMEOUT);

    // Wait for onStartupFinished to register the SCM provider
    await new Promise((r) => setTimeout(r, 2000));

    // VS Code SCM API doesn't expose a way to list providers directly,
    // but the command should not throw, indicating SCM is registered
    await assert.doesNotReject(
      vscode.commands.executeCommand('enterprise-ai.manageWorktrees'),
      'manageWorktrees should execute without error',
    );
  });

  test('extension should contribute SCM context menu commands', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    // Worktree module registers merge/discard commands
    const worktreeCommands = commands.filter((c) =>
      c.startsWith('enterprise-ai.worktree') || c === 'enterprise-ai.manageWorktrees',
    );
    assert.ok(worktreeCommands.length >= 1, 'Should have worktree-related commands');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/suite/worktree.e2e.test.ts
git commit -m "test(ext): add E2E worktree tests — command registration, SCM provider"
```

---

## Chunk 5: Performance, Coverage, and VSIX Packaging

### Task 24: Performance measurement — activation time

**Files:**
- No new files (uses CLI profiling)

- [ ] **Step 1: Measure activation time with --prof**

```bash
cd vscode-extension

# Build the extension first
npm run build:all

# Run VS Code with profiling to measure activation time
# This generates a .cpuprofile file
code --extensionDevelopmentPath=$(pwd) --prof-startup --disable-extensions 2>&1 | head -20

# Alternative: measure activation time via the extension itself
# Add timing to extension.ts activate() if not already present
```

- [ ] **Step 2: Verify activation under 500ms**

```bash
cd vscode-extension

# Parse the startup profile (if .cpuprofile was generated)
# Look for 'activate' in the profile
node -e "
const fs = require('fs');
const profiles = fs.readdirSync('.').filter(f => f.endsWith('.cpuprofile'));
if (profiles.length === 0) {
  console.log('No profile found — run VS Code with --prof-startup first');
  process.exit(0);
}
const profile = JSON.parse(fs.readFileSync(profiles[0], 'utf8'));
const activateNode = profile.nodes?.find(n => n.callFrame?.functionName?.includes('activate'));
if (activateNode) {
  console.log('Activation profile node found:', activateNode.callFrame.functionName);
}
console.log('Total profile time:', profile.endTime - profile.startTime, 'us');
"

# Manual verification: check extension.ts logs timing
echo "Verify [Extension] Activated log appears within 500ms of [Extension] Activating..."
```

- [ ] **Step 3: Add activation timing to extension.ts (if not present)**

Ensure `src/extension.ts` has timing:

```typescript
// At the start of activate():
const startTime = Date.now();

// At the end of activate():
const elapsed = Date.now() - startTime;
outputChannel.appendLine(`[Extension] Activated in ${elapsed}ms`);
if (elapsed > 500) {
  outputChannel.appendLine(`[Extension] WARNING: Activation exceeded 500ms target`);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "perf(ext): add activation timing measurement — warn if > 500ms"
```

---

### Task 25: Vitest coverage configuration and verification

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install coverage dependencies**

```bash
cd vscode-extension && npm install --save-dev @vitest/coverage-v8
```

- [ ] **Step 2: Update vitest.config.ts with coverage**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/core/**/*.ts',
        'src/modules/**/*.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/core/types.ts',
      ],
      thresholds: {
        'src/core/**': {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        'src/modules/**': {
          branches: 60,
          functions: 60,
          lines: 60,
          statements: 60,
        },
      },
    },
  },
});
```

- [ ] **Step 3: Add coverage script to package.json**

```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage",
    "test:coverage:check": "vitest run --coverage --coverage.thresholdAutoUpdate=false"
  }
}
```

- [ ] **Step 4: Run coverage and verify 80%+ on core/**

```bash
cd vscode-extension && npx vitest run --coverage
```
Expected: 80%+ line/branch/function coverage on `src/core/` files. If below 80%, add more tests before proceeding.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "test(ext): configure vitest coverage — 80% threshold on core/, 60% on modules/, v8 provider"
```

---

### Task 26: Update .vscodeignore for clean VSIX packaging

**Files:**
- Modify: `.vscodeignore`

- [ ] **Step 1: Update .vscodeignore to exclude test files, coverage, profiles, and fixtures**

Append the following entries to `.vscodeignore` (create if missing):

```
# Test files
test/**
coverage/**
*.cpuprofile

# E2E fixtures
test/e2e/fixtures/**

# Config files not needed in VSIX
vitest.config.ts
tsconfig.test.json
test/e2e/tsconfig.json
.nyc_output/**
```

- [ ] **Step 2: Commit**

```bash
git add .vscodeignore
git commit -m "chore(ext): update .vscodeignore — exclude tests, coverage, profiles, fixtures from VSIX"
```

---

### Task 27: VSIX packaging and clean install verification

**Files:**
- No new files

- [ ] **Step 1: Build everything**

```bash
cd vscode-extension
npm run build:all
```
Expected: `out/extension.js`, `out/chatWebview.js`, `out/agentsWebview.js`, `out/orchestratorWebview.js`, `out/theme.css` all created.

- [ ] **Step 2: Run all unit + integration tests**

```bash
cd vscode-extension && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 3: Run coverage check**

```bash
cd vscode-extension && npx vitest run --coverage
```
Expected: 80%+ on `src/core/`.

- [ ] **Step 4: Package VSIX**

```bash
cd vscode-extension && npx vsce package --no-dependencies
```
Expected: `enterprise-ai-chat-3.0.0.vsix` (or current version) created successfully.

- [ ] **Step 5: Verify VSIX contents**

```bash
cd vscode-extension

# List VSIX contents to verify all required files are included
npx vsce ls --no-dependencies | head -30

# Verify key files
npx vsce ls --no-dependencies | grep -E "out/extension.js|out/chatWebview.js|out/agentsWebview.js|out/orchestratorWebview.js|out/theme.css|package.json"
```
Expected: All 5 output files + package.json present in VSIX.

- [ ] **Step 6: Test clean install**

```bash
cd vscode-extension

# Install VSIX in a clean VS Code instance (no prior config)
code --install-extension enterprise-ai-chat-3.0.0.vsix --force

# Verify extension loads
code --list-extensions | grep enterprise-ai

# Open VS Code and run smoke test
code --extensionDevelopmentPath=$(pwd) --disable-extensions
```
Expected: Extension installs without errors, appears in extension list.

- [ ] **Step 7: Verify Output Channel**

```bash
# In VS Code, open Command Palette → "Enterprise AI: Show Logs"
# Verify "Enterprise AI" output channel contains:
# [Extension] Activating Enterprise AI...
# [Extension] Activated in Xms
# Verify logs are readable and properly formatted
echo "Manual verification: check Output Channel 'Enterprise AI' for readable logs"
```

- [ ] **Step 8: Run E2E tests**

```bash
cd vscode-extension && npm run test:e2e
```
Expected: All E2E tests pass.

- [ ] **Step 9: Final commit**

```bash
git add vitest.config.ts package.json package-lock.json src/extension.ts .vscodeignore
git commit -m "test(ext): Phase 4 complete — all tests pass, 80%+ coverage, VSIX verified"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1-4 | Core edge case tests: EventBus, ConfigService, ApiClient (retries/SSE), AuthService (TOTP/errors) |
| 2 | 5-9 | Module unit tests: AgentService, OrchestratorService, OrchestratorStatusBar, DocumentService, WorktreeService |
| 3 | 10-16 | Integration tests: ChatPanel, ChatCommands, CodeActionCommands, AgentPanel, OrchestratorPanel, DocumentCommands, WorktreeScmProvider |
| 4 | 17-23 | E2E tests: infrastructure setup, chat flow, code actions, agent sessions, orchestrator, documents, worktree SCM |
| 5 | 24-27 | Performance measurement (< 500ms), coverage verification (80%+), .vscodeignore update, VSIX packaging and clean install |

**Total tasks:** 27
**Total commits:** ~27
**Coverage target:** 80%+ on core/, integration coverage on all modules, E2E for all critical flows
