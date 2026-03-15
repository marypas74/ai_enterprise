# VS Code Extension Rewrite — Phase 3: Documents + Worktree

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add document generation commands, `@document` autocomplete in chat input, and worktree integration via VS Code Source Control API. Complete the extension's backend feature coverage.

**Architecture:** Documents module has two components: DocumentProvider (React webview autocomplete) and DocumentCommands (VS Code Command Palette). Worktree module implements `vscode.SourceControl` API with polling + EventBus updates. Both modules receive core services via dependency injection from `ModuleContext`.

**Tech Stack:** TypeScript, VS Code Extension API (SourceControl, QuickPick), React 18, esbuild, Axios, EventBus

**Spec:** `docs/superpowers/specs/2026-03-15-vscode-extension-rewrite-design.md`

---

## File Structure

```
vscode-extension/
├── src/
│   ├── extension.ts                              # Updated — register documents + worktree modules
│   ├── core/
│   │   └── types.ts                              # Updated — add document/worktree types + messages
│   ├── modules/
│   │   ├── documents/
│   │   │   ├── DocumentService.ts                # Document list, cache, generation API calls
│   │   │   ├── DocumentCommands.ts               # Generate Document command (Command Palette)
│   │   │   └── DocumentProvider.ts               # Bridges @document requests from webview
│   │   └── worktree/
│   │       ├── WorktreeService.ts                # API calls for worktree CRUD
│   │       ├── WorktreeScmProvider.ts            # vscode.SourceControl implementation
│   │       └── WorktreeCommands.ts               # Merge, discard, review commands
│   └── utils/
│       └── constants.ts                          # Updated — add worktree polling interval
├── webview-ui/
│   ├── shared/
│   │   └── components/
│   │       └── DocumentChip.tsx                  # Chip for selected @document
│   └── chat/
│       ├── ChatInput.tsx                         # Updated — add @document detection + dropdown
│       └── DocumentDropdown.tsx                  # Filtered dropdown for @document autocomplete
├── test/
│   ├── modules/
│   │   ├── documents/
│   │   │   ├── DocumentService.test.ts
│   │   │   └── DocumentCommands.test.ts
│   │   └── worktree/
│   │       ├── WorktreeService.test.ts
│   │       └── WorktreeScmProvider.test.ts
│   └── setup.ts                                  # Existing
└── package.json
```

---

## Chunk 1: Core Types + Constants Update

### Task 1: Add document and worktree types to core

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/utils/constants.ts`

- [ ] **Step 1: Update types.ts with document and worktree types**

```typescript
// Add to src/core/types.ts — append after existing types

// ---- Documents ----
export interface Document {
  id: number;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentGenerateRequest {
  format: 'docx' | 'excel' | 'pptx' | 'pdf';
  content: string;
  fileName?: string;
}

// ---- Worktree ----
export interface WorktreeInfo {
  id: string;
  sessionId: string;
  path: string;
  branch: string;
  targetBranch: string;
  modifiedFiles: WorktreeFile[];
  conflicts: WorktreeFile[];
  status: 'active' | 'ready' | 'merging' | 'merged' | 'discarded';
  agentName?: string;
  createdAt: string;
}

export interface WorktreeFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'conflicted';
}

export interface WorktreeMergeResult {
  success: boolean;
  mergedBranch: string;
  conflicts?: string[];
  error?: string;
}

// ---- Extension <-> Webview Messages (add to existing union types) ----
// Add these to the ExtensionToWebview union:
//   | { type: 'setDocuments'; payload: { documents: Document[] } }
//   | { type: 'documentGenerated'; payload: { fileName: string; filePath: string } }
//
// Add these to the WebviewToExtension union:
//   | { type: 'loadDocuments' }
//   | { type: 'searchDocuments'; payload: { query: string } }
//   | { type: 'generateDocumentFromChat'; payload: DocumentGenerateRequest }
```

The actual union type additions in `types.ts`:

```typescript
// Replace the ExtensionToWebview type — append new members to existing union
export type ExtensionToWebview =
  | { type: 'streamChunk'; payload: StreamChunk }
  | { type: 'streamEnd' }
  | { type: 'streamError'; payload: { message: string } }
  | { type: 'setAuthenticated'; payload: { user: UserInfo; models: AIModel[] } }
  | { type: 'setUnauthenticated' }
  | { type: 'setModels'; payload: { models: AIModel[] } }
  | { type: 'setConversations'; payload: { conversations: Conversation[] } }
  | { type: 'restoreState'; payload: Record<string, unknown> }
  | { type: 'setDocuments'; payload: { documents: Document[] } }
  | { type: 'documentGenerated'; payload: { fileName: string; filePath: string } };

// Replace the WebviewToExtension type — append new members to existing union
export type WebviewToExtension =
  | { type: 'sendMessage'; payload: { message: string; modelId: string; conversationId?: number; documentIds?: number[] } }
  | { type: 'abortRequest' }
  | { type: 'newChat' }
  | { type: 'loadConversations' }
  | { type: 'deleteConversation'; payload: { id: number } }
  | { type: 'renameConversation'; payload: { id: number; title: string } }
  | { type: 'login'; payload: LoginRequest }
  | { type: 'logout' }
  | { type: 'ready' }
  | { type: 'loadDocuments' }
  | { type: 'searchDocuments'; payload: { query: string } }
  | { type: 'generateDocumentFromChat'; payload: DocumentGenerateRequest };
```

- [ ] **Step 2: Update constants.ts with worktree constants**

```typescript
// Add to src/utils/constants.ts — append to existing CONFIG_KEYS object:
// WORKTREE_POLLING: 'worktree.pollingInterval',

// Add to DEFAULTS:
// WORKTREE_POLLING: 15000,

// The API_PATHS already include document and worktree paths from Phase 1.
// Verify these exist:
// DOCUMENTS: '/api/documents',
// TOOLS_GENERATE_DOCX: '/api/tools/generate-docx',
// TOOLS_GENERATE_EXCEL: '/api/tools/generate-excel',
// TOOLS_GENERATE_PPTX: '/api/tools/generate-pptx',
// TOOLS_CONVERT_PDF: '/api/tools/convert-to-pdf',
// ORCHESTRATOR_WORKTREES: '/api/orchestrator/worktrees',

// Add new API_PATHS entries:
// AGENT_SESSION_WORKTREE: '/api/agents/sessions', // + /{id}/worktree
// AGENT_SESSION_WORKTREE_MERGE: '/api/agents/sessions', // + /{id}/worktree/merge
// AGENT_SESSION_WORKTREE_DISCARD: '/api/agents/sessions', // + /{id}/worktree/discard
```

Full updated `constants.ts`:

```typescript
// src/utils/constants.ts
export const CONFIG_SECTION = 'enterprise-ai';

export const CONFIG_KEYS = {
  SERVER_URL: 'serverUrl',
  ALLOW_SELF_SIGNED: 'allowSelfSignedCerts',
  BOT_ICON_STYLE: 'botIconStyle',
  ORCHESTRATOR_POLLING: 'orchestrator.pollingInterval',
  ORCHESTRATOR_SHOW: 'orchestrator.showStatusBar',
  WORKTREE_POLLING: 'worktree.pollingInterval',
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
  WORKTREE_POLLING: 15000,
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

export const WORKTREE_SCM_ID = 'enterprise-ai-worktrees';
export const WORKTREE_SCM_LABEL = 'Enterprise AI Worktrees';
```

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts src/utils/constants.ts
git commit -m "feat(ext): add document and worktree types, constants for Phase 3"
```

---

## Chunk 2: DocumentService + DocumentCommands

### Task 2: DocumentService

**Files:**
- Create: `src/modules/documents/DocumentService.ts`
- Create: `test/modules/documents/DocumentService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/documents/DocumentService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../../../src/modules/documents/DocumentService';
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
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
  },
}));

describe('DocumentService', () => {
  let documentService: DocumentService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    documentService = new DocumentService(apiClient, eventBus, outputChannel);
  });

  it('should fetch documents from backend', async () => {
    const docs = [
      { id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' },
      { id: 2, name: 'Manual.docx', type: 'docx', size: 2048, createdAt: '', updatedAt: '' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    const result = await documentService.loadDocuments();
    expect(result).toEqual(docs);
    expect(apiClient.get).toHaveBeenCalledWith('/api/documents');
  });

  it('should cache documents after first load', async () => {
    const docs = [{ id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await documentService.loadDocuments();
    const cached = await documentService.loadDocuments();
    expect(cached).toEqual(docs);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache on event', async () => {
    const docs = [{ id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await documentService.loadDocuments();
    documentService.invalidateCache();
    await documentService.loadDocuments();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('should fuzzy search documents by name', async () => {
    const docs = [
      { id: 1, name: 'Annual Report 2026.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' },
      { id: 2, name: 'User Manual.docx', type: 'docx', size: 2048, createdAt: '', updatedAt: '' },
      { id: 3, name: 'API Reference.pdf', type: 'pdf', size: 512, createdAt: '', updatedAt: '' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await documentService.loadDocuments();
    const results = documentService.searchDocuments('rep');
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Annual Report 2026.pdf');
    expect(results[1].name).toBe('API Reference.pdf');
  });

  it('should generate DOCX document', async () => {
    const blob = new Uint8Array([1, 2, 3]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'docx',
      content: 'Test content',
      fileName: 'test',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/generate-docx', {
      content: 'Test content',
      fileName: 'test',
    });
    expect(result).toEqual(blob);
  });

  it('should generate Excel document', async () => {
    const blob = new Uint8Array([4, 5, 6]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'excel',
      content: 'Spreadsheet data',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/generate-excel', {
      content: 'Spreadsheet data',
    });
    expect(result).toEqual(blob);
  });

  it('should generate PPTX document', async () => {
    const blob = new Uint8Array([7, 8, 9]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'pptx',
      content: 'Slides content',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/generate-pptx', {
      content: 'Slides content',
    });
    expect(result).toEqual(blob);
  });

  it('should generate PDF document', async () => {
    const blob = new Uint8Array([10, 11, 12]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'pdf',
      content: 'PDF content',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/convert-to-pdf', {
      content: 'PDF content',
    });
    expect(result).toEqual(blob);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/documents/DocumentService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/documents/DocumentService.ts
import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { Document, DocumentGenerateRequest } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

const FORMAT_TO_PATH: Record<DocumentGenerateRequest['format'], string> = {
  docx: API_PATHS.TOOLS_GENERATE_DOCX,
  excel: API_PATHS.TOOLS_GENERATE_EXCEL,
  pptx: API_PATHS.TOOLS_GENERATE_PPTX,
  pdf: API_PATHS.TOOLS_CONVERT_PDF,
};

export class DocumentService {
  private cachedDocuments: Document[] | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async loadDocuments(): Promise<Document[]> {
    if (this.cachedDocuments !== null) {
      return this.cachedDocuments;
    }

    try {
      const documents = await this.apiClient.get<Document[]>(API_PATHS.DOCUMENTS);
      this.cachedDocuments = documents;
      this.outputChannel.appendLine(`[Documents] Loaded ${documents.length} documents`);
      return documents;
    } catch (error) {
      this.outputChannel.appendLine(`[Documents] Failed to load documents: ${error}`);
      return [];
    }
  }

  invalidateCache(): void {
    this.cachedDocuments = null;
    this.outputChannel.appendLine('[Documents] Cache invalidated');
  }

  searchDocuments(query: string): Document[] {
    if (!this.cachedDocuments) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    return this.cachedDocuments.filter((doc) => {
      const lowerName = doc.name.toLowerCase();
      // Fuzzy match: every character in query appears in order in name
      let queryIndex = 0;
      for (let i = 0; i < lowerName.length && queryIndex < lowerQuery.length; i++) {
        if (lowerName[i] === lowerQuery[queryIndex]) {
          queryIndex++;
        }
      }
      return queryIndex === lowerQuery.length;
    }).sort((a, b) => {
      // Prefer matches that start with the query
      const aStartsWith = a.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1;
      const bStartsWith = b.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1;
      if (aStartsWith !== bStartsWith) {
        return aStartsWith - bStartsWith;
      }
      // Then prefer substring matches over fuzzy matches
      const aIncludes = a.name.toLowerCase().includes(lowerQuery) ? 0 : 1;
      const bIncludes = b.name.toLowerCase().includes(lowerQuery) ? 0 : 1;
      return aIncludes - bIncludes;
    });
  }

  async generateDocument(request: DocumentGenerateRequest): Promise<Uint8Array> {
    const path = FORMAT_TO_PATH[request.format];
    const body: Record<string, unknown> = { content: request.content };
    if (request.fileName) {
      body.fileName = request.fileName;
    }

    this.outputChannel.appendLine(`[Documents] Generating ${request.format}: ${request.fileName ?? 'unnamed'}`);
    const result = await this.apiClient.post<Uint8Array>(path, body);
    this.outputChannel.appendLine(`[Documents] Generated ${request.format} successfully`);
    return result;
  }

  dispose(): void {
    this.cachedDocuments = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/documents/DocumentService.test.ts
```
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/documents/DocumentService.ts test/modules/documents/DocumentService.test.ts
git commit -m "feat(ext): add DocumentService with cache, fuzzy search, and generation"
```

---

### Task 3: DocumentCommands

**Files:**
- Create: `src/modules/documents/DocumentCommands.ts`
- Create: `test/modules/documents/DocumentCommands.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/documents/DocumentCommands.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDocumentCommands } from '../../../src/modules/documents/DocumentCommands';
import { DocumentService } from '../../../src/modules/documents/DocumentService';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import { EventBus } from '../../../src/core/EventBus';

const mockShowQuickPick = vi.fn();
const mockShowInputBox = vi.fn();
const mockShowSaveDialog = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockRegisterCommand = vi.fn().mockReturnValue({ dispose: () => {} });

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (...args: unknown[]) => mockRegisterCommand(...args),
  },
  window: {
    showQuickPick: (...args: unknown[]) => mockShowQuickPick(...args),
    showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
    showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args),
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
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
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
  },
}));

describe('DocumentCommands', () => {
  let documentService: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    const eventBus = new EventBus();
    const apiClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    } as unknown as Parameters<typeof DocumentService['prototype']['constructor']>[0];
    const outputChannel = createMockOutputChannel();
    documentService = new DocumentService(apiClient as any, eventBus, outputChannel);
  });

  it('should register generateDocument command', () => {
    const disposables = registerDocumentCommands(documentService);
    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'enterprise-ai.generateDocument',
      expect.any(Function),
    );
    expect(disposables.length).toBeGreaterThan(0);
  });

  it('should show format quick pick when command is invoked', async () => {
    mockShowQuickPick.mockResolvedValue({ label: 'DOCX', format: 'docx' });
    mockShowInputBox.mockResolvedValue('Generate a monthly report');
    mockShowSaveDialog.mockResolvedValue({ fsPath: '/tmp/report.docx' });

    registerDocumentCommands(documentService);
    const commandHandler = mockRegisterCommand.mock.calls[0][1];
    await commandHandler();

    expect(mockShowQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'DOCX' }),
        expect.objectContaining({ label: 'Excel' }),
        expect.objectContaining({ label: 'PowerPoint' }),
        expect.objectContaining({ label: 'PDF' }),
      ]),
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
  });

  it('should abort if user cancels format selection', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    registerDocumentCommands(documentService);
    const commandHandler = mockRegisterCommand.mock.calls[0][1];
    await commandHandler();

    expect(mockShowInputBox).not.toHaveBeenCalled();
  });

  it('should abort if user cancels content input', async () => {
    mockShowQuickPick.mockResolvedValue({ label: 'DOCX', format: 'docx' });
    mockShowInputBox.mockResolvedValue(undefined);

    registerDocumentCommands(documentService);
    const commandHandler = mockRegisterCommand.mock.calls[0][1];
    await commandHandler();

    expect(mockShowSaveDialog).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/documents/DocumentCommands.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/documents/DocumentCommands.ts
import * as vscode from 'vscode';
import type { DocumentService } from './DocumentService';
import type { DocumentGenerateRequest } from '../../core/types';

interface FormatOption {
  label: string;
  description: string;
  format: DocumentGenerateRequest['format'];
  extension: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { label: 'DOCX', description: 'Microsoft Word document', format: 'docx', extension: 'docx' },
  { label: 'Excel', description: 'Microsoft Excel spreadsheet', format: 'excel', extension: 'xlsx' },
  { label: 'PowerPoint', description: 'Microsoft PowerPoint presentation', format: 'pptx', extension: 'pptx' },
  { label: 'PDF', description: 'PDF document', format: 'pdf', extension: 'pdf' },
];

const FILTER_MAP: Record<string, Record<string, string[]>> = {
  docx: { 'Word Documents': ['docx'] },
  xlsx: { 'Excel Spreadsheets': ['xlsx'] },
  pptx: { 'PowerPoint Presentations': ['pptx'] },
  pdf: { 'PDF Documents': ['pdf'] },
};

export function registerDocumentCommands(
  documentService: DocumentService,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.generateDocument', async () => {
      // Step 1: Pick format
      const formatChoice = await vscode.window.showQuickPick(FORMAT_OPTIONS, {
        placeHolder: 'Select document format to generate',
        title: 'Enterprise AI: Generate Document',
      });
      if (!formatChoice) { return; }

      // Step 2: Input content/prompt
      const content = await vscode.window.showInputBox({
        prompt: `Describe the ${formatChoice.label} document to generate`,
        placeHolder: 'e.g., Monthly sales report for March 2026 with charts',
        ignoreFocusOut: true,
      });
      if (!content) { return; }

      // Step 3: Choose save location
      const saveUri = await vscode.window.showSaveDialog({
        filters: FILTER_MAP[formatChoice.extension],
        defaultUri: vscode.Uri.file(`document.${formatChoice.extension}`),
        title: `Save ${formatChoice.label} Document`,
      });
      if (!saveUri) { return; }

      // Step 4: Generate and save
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Generating ${formatChoice.label} document...`,
            cancellable: false,
          },
          async () => {
            const data = await documentService.generateDocument({
              format: formatChoice.format,
              content,
              fileName: saveUri.fsPath.split('/').pop()?.replace(`.${formatChoice.extension}`, ''),
            });

            await vscode.workspace.fs.writeFile(saveUri, data);
          },
        );

        const openAction = await vscode.window.showInformationMessage(
          `Document saved: ${saveUri.fsPath}`,
          'Open File',
        );
        if (openAction === 'Open File') {
          await vscode.commands.executeCommand('vscode.open', saveUri);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to generate document: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/documents/DocumentCommands.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/documents/DocumentCommands.ts test/modules/documents/DocumentCommands.test.ts
git commit -m "feat(ext): add DocumentCommands with format picker, content input, and file save"
```

---

### Task 4: DocumentProvider (extension-side bridge)

**Files:**
- Create: `src/modules/documents/DocumentProvider.ts`

- [ ] **Step 1: Write implementation**

The DocumentProvider bridges webview `@document` requests to the DocumentService. It listens for webview messages and responds with document data.

```typescript
// src/modules/documents/DocumentProvider.ts
import * as vscode from 'vscode';
import type { ModuleContext, Document } from '../../core/types';
import type { DocumentService } from './DocumentService';
import type { ChatPanel } from '../chat/ChatPanel';

export class DocumentProvider {
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly context: ModuleContext,
    private readonly documentService: DocumentService,
    private readonly getPanel: () => ChatPanel,
  ) {
    // Invalidate cache on auth login (documents may differ per user)
    this.disposables.push(
      this.context.eventBus.on('auth:login', () => {
        this.documentService.invalidateCache();
      }),
    );

    // Invalidate on logout
    this.disposables.push(
      this.context.eventBus.on('auth:logout', () => {
        this.documentService.invalidateCache();
      }),
    );
  }

  async handleLoadDocuments(): Promise<void> {
    const documents = await this.documentService.loadDocuments();
    this.getPanel().postMessage({
      type: 'setDocuments',
      payload: { documents },
    });
  }

  handleSearchDocuments(query: string): void {
    const results = this.documentService.searchDocuments(query);
    this.getPanel().postMessage({
      type: 'setDocuments',
      payload: { documents: results },
    });
  }

  async handleGenerateFromChat(
    format: Document['type'],
    content: string,
    fileName?: string,
  ): Promise<void> {
    try {
      const validFormat = format as 'docx' | 'excel' | 'pptx' | 'pdf';
      const data = await this.documentService.generateDocument({
        format: validFormat,
        content,
        fileName,
      });

      const extensionMap: Record<string, string> = {
        docx: 'docx',
        excel: 'xlsx',
        pptx: 'pptx',
        pdf: 'pdf',
      };
      const ext = extensionMap[validFormat] ?? validFormat;
      const finalName = fileName ? `${fileName}.${ext}` : `document.${ext}`;

      // Use VS Code save dialog
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(finalName),
        title: 'Save Generated Document',
      });

      if (saveUri) {
        await vscode.workspace.fs.writeFile(saveUri, data);
        this.getPanel().postMessage({
          type: 'documentGenerated',
          payload: { fileName: finalName, filePath: saveUri.fsPath },
        });
      }
    } catch (error) {
      this.context.outputChannel.appendLine(
        `[DocumentProvider] Generation failed: ${error}`,
      );
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/documents/DocumentProvider.ts
git commit -m "feat(ext): add DocumentProvider bridge for webview @document requests"
```

---

## Chunk 3: Worktree Service + SCM Provider

### Task 5: WorktreeService

**Files:**
- Create: `src/modules/worktree/WorktreeService.ts`
- Create: `test/modules/worktree/WorktreeService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/worktree/WorktreeService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeService } from '../../../src/modules/worktree/WorktreeService';
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
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}));

describe('WorktreeService', () => {
  let worktreeService: WorktreeService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    worktreeService = new WorktreeService(apiClient, eventBus, outputChannel);
  });

  it('should fetch all active worktrees', async () => {
    const worktrees = [
      {
        id: 'wt-1',
        sessionId: 'session-1',
        path: '/tmp/worktree-1',
        branch: 'agent/feature-1',
        targetBranch: 'main',
        modifiedFiles: [{ path: 'src/index.ts', status: 'modified' }],
        conflicts: [],
        status: 'ready',
        agentName: 'Code Agent',
        createdAt: '2026-03-15T10:00:00Z',
      },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(worktrees);

    const result = await worktreeService.listWorktrees();
    expect(result).toEqual(worktrees);
    expect(apiClient.get).toHaveBeenCalledWith('/api/orchestrator/worktrees');
  });

  it('should fetch worktree for specific session', async () => {
    const worktree = {
      id: 'wt-1',
      sessionId: 'session-1',
      path: '/tmp/worktree-1',
      branch: 'agent/feature-1',
      targetBranch: 'main',
      modifiedFiles: [],
      conflicts: [],
      status: 'active',
      createdAt: '2026-03-15T10:00:00Z',
    };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(worktree);

    const result = await worktreeService.getWorktree('session-1');
    expect(result).toEqual(worktree);
    expect(apiClient.get).toHaveBeenCalledWith('/api/agents/sessions/session-1/worktree');
  });

  it('should merge worktree', async () => {
    const mergeResult = { success: true, mergedBranch: 'agent/feature-1' };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mergeResult);

    const result = await worktreeService.mergeWorktree('session-1');
    expect(result).toEqual(mergeResult);
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/session-1/worktree/merge');
  });

  it('should discard worktree', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await worktreeService.discardWorktree('session-1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/agents/sessions/session-1/worktree/discard');
  });

  it('should emit worktree:ready event on EventBus when worktree becomes ready', async () => {
    const listener = vi.fn();
    eventBus.on('worktree:ready', listener);

    worktreeService.notifyWorktreeReady('session-1', 'agent/feature-1');
    expect(listener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      branch: 'agent/feature-1',
    });
  });

  it('should handle merge failure gracefully', async () => {
    const mergeResult = {
      success: false,
      mergedBranch: 'agent/feature-1',
      conflicts: ['src/index.ts', 'src/utils.ts'],
      error: 'Merge conflicts detected',
    };
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mergeResult);

    const result = await worktreeService.mergeWorktree('session-1');
    expect(result.success).toBe(false);
    expect(result.conflicts).toHaveLength(2);
  });

  it('should handle API errors on list', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await worktreeService.listWorktrees();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/worktree/WorktreeService.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/worktree/WorktreeService.ts
import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { WorktreeInfo, WorktreeMergeResult } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class WorktreeService {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async listWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const worktrees = await this.apiClient.get<WorktreeInfo[]>(
        API_PATHS.ORCHESTRATOR_WORKTREES,
      );
      this.outputChannel.appendLine(`[Worktree] Listed ${worktrees.length} worktrees`);
      return worktrees;
    } catch (error) {
      this.outputChannel.appendLine(`[Worktree] Failed to list worktrees: ${error}`);
      return [];
    }
  }

  async getWorktree(sessionId: string): Promise<WorktreeInfo | null> {
    try {
      const worktree = await this.apiClient.get<WorktreeInfo>(
        `${API_PATHS.AGENT_SESSIONS}/${sessionId}/worktree`,
      );
      return worktree;
    } catch (error) {
      this.outputChannel.appendLine(
        `[Worktree] Failed to get worktree for session ${sessionId}: ${error}`,
      );
      return null;
    }
  }

  async mergeWorktree(sessionId: string): Promise<WorktreeMergeResult> {
    try {
      const result = await this.apiClient.post<WorktreeMergeResult>(
        `${API_PATHS.AGENT_SESSIONS}/${sessionId}/worktree/merge`,
      );
      if (result.success) {
        this.outputChannel.appendLine(
          `[Worktree] Merged branch ${result.mergedBranch} for session ${sessionId}`,
        );
      } else {
        this.outputChannel.appendLine(
          `[Worktree] Merge failed for session ${sessionId}: ${result.error}`,
        );
      }
      return result;
    } catch (error) {
      this.outputChannel.appendLine(`[Worktree] Merge error: ${error}`);
      return {
        success: false,
        mergedBranch: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async discardWorktree(sessionId: string): Promise<void> {
    try {
      await this.apiClient.post(
        `${API_PATHS.AGENT_SESSIONS}/${sessionId}/worktree/discard`,
      );
      this.outputChannel.appendLine(`[Worktree] Discarded worktree for session ${sessionId}`);
    } catch (error) {
      this.outputChannel.appendLine(`[Worktree] Discard error: ${error}`);
      throw error;
    }
  }

  notifyWorktreeReady(sessionId: string, branch: string): void {
    this.eventBus.emit('worktree:ready', { sessionId, branch });
  }

  dispose(): void {
    // nothing to clean up
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/worktree/WorktreeService.test.ts
```
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/worktree/WorktreeService.ts test/modules/worktree/WorktreeService.test.ts
git commit -m "feat(ext): add WorktreeService with list, merge, discard, and event notification"
```

---

### Task 6: WorktreeScmProvider

**Files:**
- Create: `src/modules/worktree/WorktreeScmProvider.ts`
- Create: `test/modules/worktree/WorktreeScmProvider.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/modules/worktree/WorktreeScmProvider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorktreeScmProvider } from '../../../src/modules/worktree/WorktreeScmProvider';
import { WorktreeService } from '../../../src/modules/worktree/WorktreeService';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

const mockCreateSourceControl = vi.fn();
const mockExecuteCommand = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowWarningMessage = vi.fn();

vi.mock('vscode', () => {
  const mockResourceGroup = {
    resourceStates: [],
    dispose: vi.fn(),
    label: '',
    id: '',
    hideWhenEmpty: false,
  };
  const mockScm = {
    inputBox: { placeholder: '' },
    createResourceGroup: vi.fn().mockReturnValue(mockResourceGroup),
    dispose: vi.fn(),
    statusBarCommands: undefined,
    count: 0,
  };
  return {
    scm: {
      createSourceControl: (...args: unknown[]) => {
        mockCreateSourceControl(...args);
        return mockScm;
      },
    },
    commands: {
      executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
    },
    window: {
      showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
      showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    },
    Uri: {
      file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p })),
      parse: vi.fn((s: string) => ({ fsPath: s, scheme: 'file', path: s })),
    },
    ThemeColor: vi.fn(),
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((_k: string, d: unknown) => d),
      }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    },
  };
});

describe('WorktreeScmProvider', () => {
  let scmProvider: WorktreeScmProvider;
  let worktreeService: WorktreeService;
  let eventBus: EventBus;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    worktreeService = {
      listWorktrees: vi.fn().mockResolvedValue([]),
      getWorktree: vi.fn(),
      mergeWorktree: vi.fn(),
      discardWorktree: vi.fn(),
    } as unknown as WorktreeService;
    outputChannel = createMockOutputChannel();
    scmProvider = new WorktreeScmProvider(worktreeService, eventBus, outputChannel);
  });

  afterEach(() => {
    scmProvider.dispose();
    vi.useRealTimers();
  });

  it('should create a VS Code SourceControl instance', () => {
    expect(mockCreateSourceControl).toHaveBeenCalledWith(
      'enterprise-ai-worktrees',
      'Enterprise AI Worktrees',
    );
  });

  it('should poll for worktrees on interval', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'wt-1',
        sessionId: 'session-1',
        path: '/tmp/wt-1',
        branch: 'agent/feat-1',
        targetBranch: 'main',
        modifiedFiles: [{ path: 'src/index.ts', status: 'modified' }],
        conflicts: [],
        status: 'ready',
        agentName: 'Agent 1',
        createdAt: '2026-03-15T10:00:00Z',
      },
    ]);

    // Trigger initial poll
    await scmProvider.refresh();
    expect(worktreeService.listWorktrees).toHaveBeenCalledTimes(1);
  });

  it('should create resource groups for each worktree', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'wt-1',
        sessionId: 'session-1',
        path: '/tmp/wt-1',
        branch: 'agent/feat-1',
        targetBranch: 'main',
        modifiedFiles: [
          { path: 'src/index.ts', status: 'modified' },
          { path: 'src/new.ts', status: 'added' },
        ],
        conflicts: [],
        status: 'ready',
        agentName: 'Agent 1',
        createdAt: '2026-03-15T10:00:00Z',
      },
    ]);

    await scmProvider.refresh();
    // The scm mock's createResourceGroup should have been called
    const scm = (await import('vscode')).scm.createSourceControl('', '');
    expect(scm.createResourceGroup).toHaveBeenCalled();
  });

  it('should react to worktree:ready event', async () => {
    const refreshSpy = vi.spyOn(scmProvider, 'refresh');
    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });

    // Should trigger a refresh
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('should show notification on worktree:ready event', () => {
    eventBus.emit('worktree:ready', { sessionId: 'session-1', branch: 'agent/feat-1' });
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('agent/feat-1'),
      'Merge',
      'Review',
      'Dismiss',
    );
  });

  it('should update polling timer on refresh', async () => {
    (worktreeService.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    scmProvider.startPolling(15000);
    vi.advanceTimersByTime(15000);
    await vi.runAllTimersAsync();

    expect(worktreeService.listWorktrees).toHaveBeenCalled();
  });

  it('should dispose timer and SCM on dispose', () => {
    scmProvider.startPolling(15000);
    scmProvider.dispose();
    // Should not throw, timers cleared
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vscode-extension && npx vitest run test/modules/worktree/WorktreeScmProvider.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/worktree/WorktreeScmProvider.ts
import * as vscode from 'vscode';
import type { EventBus } from '../../core/EventBus';
import type { WorktreeInfo, WorktreeFile } from '../../core/types';
import type { WorktreeService } from './WorktreeService';
import { WORKTREE_SCM_ID, WORKTREE_SCM_LABEL } from '../../utils/constants';

interface WorktreeResourceGroup {
  group: vscode.SourceControlResourceGroup;
  worktree: WorktreeInfo;
}

export class WorktreeScmProvider {
  private readonly scm: vscode.SourceControl;
  private resourceGroups: WorktreeResourceGroup[] = [];
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly worktreeService: WorktreeService,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.scm = vscode.scm.createSourceControl(WORKTREE_SCM_ID, WORKTREE_SCM_LABEL);
    this.scm.inputBox.placeholder = 'Enterprise AI Worktrees';

    // Listen for worktree:ready events
    this.disposables.push(
      this.eventBus.on('worktree:ready', (data) => {
        this.handleWorktreeReady(data.sessionId, data.branch);
      }),
    );
  }

  async refresh(): Promise<void> {
    try {
      const worktrees = await this.worktreeService.listWorktrees();
      this.updateResourceGroups(worktrees);
      this.scm.count = worktrees.length;
    } catch (error) {
      this.outputChannel.appendLine(`[WorktreeSCM] Refresh failed: ${error}`);
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.pollingTimer = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private updateResourceGroups(worktrees: WorktreeInfo[]): void {
    // Dispose old resource groups
    for (const { group } of this.resourceGroups) {
      group.dispose();
    }
    this.resourceGroups = [];

    // Create new resource groups
    for (const worktree of worktrees) {
      const label = worktree.agentName
        ? `${worktree.branch} (${worktree.agentName})`
        : worktree.branch;
      const group = this.scm.createResourceGroup(worktree.id, label);
      group.hideWhenEmpty = false;

      const allFiles = [
        ...worktree.modifiedFiles,
        ...worktree.conflicts,
      ];

      group.resourceStates = allFiles.map((file) =>
        this.createResourceState(worktree, file),
      );

      this.resourceGroups.push({ group, worktree });
    }
  }

  private createResourceState(
    worktree: WorktreeInfo,
    file: WorktreeFile,
  ): vscode.SourceControlResourceState {
    const resourceUri = vscode.Uri.file(`${worktree.path}/${file.path}`);

    const decorations = this.getDecorations(file.status);

    // For the left side of the diff, use a custom URI scheme that our
    // TextDocumentContentProvider resolves via `git show <branch>:<path>`.
    // The scheme is registered in extension.ts as 'enterprise-ai-worktree'.
    const leftUri = vscode.Uri.from({
      scheme: 'enterprise-ai-worktree',
      path: file.path,
      query: JSON.stringify({
        worktreePath: worktree.path,
        branch: worktree.targetBranch,
      }),
    });

    const state: vscode.SourceControlResourceState = {
      resourceUri,
      decorations,
      command: {
        title: 'Open Diff',
        command: 'vscode.diff',
        arguments: [
          leftUri,
          resourceUri,
          `${file.path} (${worktree.targetBranch} vs ${worktree.branch})`,
        ],
      },
    };

    return state;
  }

  private getDecorations(
    status: WorktreeFile['status'],
  ): vscode.SourceControlResourceDecorations {
    switch (status) {
      case 'added':
        return {
          iconPath: new vscode.ThemeIcon('diff-added'),
          tooltip: 'Added',
          faded: false,
          strikeThrough: false,
        } as vscode.SourceControlResourceDecorations;
      case 'modified':
        return {
          iconPath: new vscode.ThemeIcon('diff-modified'),
          tooltip: 'Modified',
          faded: false,
          strikeThrough: false,
        } as vscode.SourceControlResourceDecorations;
      case 'deleted':
        return {
          iconPath: new vscode.ThemeIcon('diff-removed'),
          tooltip: 'Deleted',
          faded: false,
          strikeThrough: true,
        } as vscode.SourceControlResourceDecorations;
      case 'conflicted':
        return {
          iconPath: new vscode.ThemeIcon('warning'),
          tooltip: 'Conflict',
          faded: false,
          strikeThrough: false,
        } as vscode.SourceControlResourceDecorations;
      default:
        return {};
    }
  }

  private handleWorktreeReady(sessionId: string, branch: string): void {
    this.refresh();
    this.showWorktreeReadyNotification(sessionId, branch);
  }

  private async showWorktreeReadyNotification(
    sessionId: string,
    branch: string,
  ): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `Worktree ready: ${branch}`,
      'Merge',
      'Review',
      'Dismiss',
    );

    switch (action) {
      case 'Merge':
        await this.mergeWorktree(sessionId);
        break;
      case 'Review':
        // Focus on SCM view to review changes
        await vscode.commands.executeCommand('workbench.view.scm');
        break;
      case 'Dismiss':
      default:
        break;
    }
  }

  async mergeWorktree(sessionId: string): Promise<void> {
    const worktree = this.resourceGroups.find(
      (rg) => rg.worktree.sessionId === sessionId,
    )?.worktree;

    if (!worktree) {
      vscode.window.showWarningMessage(`Worktree for session ${sessionId} not found`);
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Merge branch "${worktree.branch}" into "${worktree.targetBranch}"?`,
      { modal: true },
      'Merge',
    );

    if (confirm !== 'Merge') { return; }

    const result = await this.worktreeService.mergeWorktree(sessionId);

    if (result.success) {
      vscode.window.showInformationMessage(
        `Successfully merged ${worktree.branch} into ${worktree.targetBranch}`,
      );
      await this.refresh();
    } else if (result.conflicts && result.conflicts.length > 0) {
      const openConflicts = await vscode.window.showWarningMessage(
        `Merge conflicts in ${result.conflicts.length} file(s). Resolve manually.`,
        'Open Conflicts',
      );
      if (openConflicts === 'Open Conflicts') {
        for (const conflictPath of result.conflicts) {
          const uri = vscode.Uri.file(`${worktree.path}/${conflictPath}`);
          await vscode.commands.executeCommand('merge-conflict.accept.both', uri);
        }
      }
    } else {
      vscode.window.showErrorMessage(
        `Merge failed: ${result.error ?? 'Unknown error'}`,
      );
    }
  }

  async discardWorktree(sessionId: string): Promise<void> {
    const worktree = this.resourceGroups.find(
      (rg) => rg.worktree.sessionId === sessionId,
    )?.worktree;

    if (!worktree) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Discard worktree "${worktree.branch}"? This cannot be undone.`,
      { modal: true },
      'Discard',
    );

    if (confirm !== 'Discard') { return; }

    try {
      await this.worktreeService.discardWorktree(sessionId);
      vscode.window.showInformationMessage(`Worktree ${worktree.branch} discarded`);
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to discard worktree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getWorktrees(): WorktreeInfo[] {
    return this.resourceGroups.map((rg) => rg.worktree);
  }

  dispose(): void {
    this.stopPolling();
    for (const { group } of this.resourceGroups) {
      group.dispose();
    }
    this.resourceGroups = [];
    this.scm.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * TextDocumentContentProvider for the 'enterprise-ai-worktree' scheme.
 * Resolves file content from a target branch using `git show`.
 * Register in extension.ts:
 *   vscode.workspace.registerTextDocumentContentProvider(
 *     'enterprise-ai-worktree',
 *     new WorktreeContentProvider(),
 *   )
 */
export class WorktreeContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { worktreePath, branch } = JSON.parse(uri.query) as {
      worktreePath: string;
      branch: string;
    };
    const filePath = uri.path;

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(
        `git show ${branch}:${filePath}`,
        { cwd: worktreePath },
      );
      return stdout;
    } catch {
      return '';
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vscode-extension && npx vitest run test/modules/worktree/WorktreeScmProvider.test.ts
```
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/worktree/WorktreeScmProvider.ts test/modules/worktree/WorktreeScmProvider.test.ts
git commit -m "feat(ext): add WorktreeScmProvider with SourceControl API, polling, and notifications"
```

---

### Task 7: WorktreeCommands

**Files:**
- Create: `src/modules/worktree/WorktreeCommands.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/modules/worktree/WorktreeCommands.ts
import * as vscode from 'vscode';
import type { WorktreeScmProvider } from './WorktreeScmProvider';
import type { WorktreeInfo } from '../../core/types';

interface WorktreeQuickPickItem extends vscode.QuickPickItem {
  worktree: WorktreeInfo;
}

export function registerWorktreeCommands(
  getScmProvider: () => WorktreeScmProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('enterprise-ai.manageWorktrees', async () => {
      const provider = getScmProvider();
      await provider.refresh();
      const worktrees = provider.getWorktrees();

      if (worktrees.length === 0) {
        vscode.window.showInformationMessage('No active worktrees');
        return;
      }

      const items: WorktreeQuickPickItem[] = worktrees.map((wt) => ({
        label: wt.branch,
        description: `${wt.status} — ${wt.modifiedFiles.length} file(s)`,
        detail: wt.agentName
          ? `Agent: ${wt.agentName} | Target: ${wt.targetBranch}`
          : `Target: ${wt.targetBranch}`,
        worktree: wt,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a worktree to manage',
        title: 'Enterprise AI Worktrees',
      });

      if (!selected) { return; }

      const action = await vscode.window.showQuickPick(
        [
          { label: 'Merge', description: `Merge into ${selected.worktree.targetBranch}` },
          { label: 'Review', description: 'Open in Source Control view' },
          { label: 'Discard', description: 'Delete worktree (cannot be undone)' },
        ],
        {
          placeHolder: `Action for ${selected.worktree.branch}`,
        },
      );

      if (!action) { return; }

      switch (action.label) {
        case 'Merge':
          await provider.mergeWorktree(selected.worktree.sessionId);
          break;
        case 'Review':
          await vscode.commands.executeCommand('workbench.view.scm');
          break;
        case 'Discard':
          await provider.discardWorktree(selected.worktree.sessionId);
          break;
      }
    }),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.merge',
      async (sessionId: string) => {
        await getScmProvider().mergeWorktree(sessionId);
      },
    ),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.discard',
      async (sessionId: string) => {
        await getScmProvider().discardWorktree(sessionId);
      },
    ),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.openDiff',
      async (leftUri: vscode.Uri, rightUri: vscode.Uri, title: string) => {
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
      },
    ),

    vscode.commands.registerCommand(
      'enterprise-ai.worktree.resolveConflict',
      async (fileUri: vscode.Uri) => {
        await vscode.commands.executeCommand('merge-conflict.accept.both', fileUri);
      },
    ),
  ];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/worktree/WorktreeCommands.ts
git commit -m "feat(ext): add WorktreeCommands with manage, merge, discard, diff, and conflict resolution"
```

---

## Chunk 4: Webview Components (@document autocomplete)

### Task 8: DocumentChip shared component

**Files:**
- Create: `webview-ui/shared/components/DocumentChip.tsx`

- [ ] **Step 1: Write DocumentChip component**

```typescript
// webview-ui/shared/components/DocumentChip.tsx
import React from 'react';

interface DocumentChipProps {
  name: string;
  onRemove: () => void;
}

export const DocumentChip: React.FC<DocumentChipProps> = ({ name, onRemove }) => {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: 'var(--vscode-badge-background)',
        color: 'var(--vscode-badge-foreground)',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        maxWidth: '200px',
      }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={name}
      >
        @{name}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: '0 2px',
          fontSize: '14px',
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
        }}
        title="Remove document"
        aria-label={`Remove ${name}`}
      >
        x
      </button>
    </span>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/shared/components/DocumentChip.tsx
git commit -m "feat(ext): add DocumentChip component for @document tags in chat input"
```

---

### Task 9: DocumentDropdown component

**Files:**
- Create: `webview-ui/chat/DocumentDropdown.tsx`

- [ ] **Step 1: Write DocumentDropdown component**

```typescript
// webview-ui/chat/DocumentDropdown.tsx
import React, { useEffect, useRef, useCallback } from 'react';

interface Document {
  id: number;
  name: string;
  type: string;
  size: number;
}

interface DocumentDropdownProps {
  documents: Document[];
  query: string;
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (doc: Document) => void;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getTypeIcon(type: string): string {
  const iconMap: Record<string, string> = {
    pdf: 'file-pdf',
    docx: 'file-text',
    doc: 'file-text',
    xlsx: 'file-excel',
    xls: 'file-excel',
    pptx: 'file-presentation',
    ppt: 'file-presentation',
    txt: 'file-text',
    md: 'markdown',
    csv: 'file-csv',
  };
  return iconMap[type.toLowerCase()] ?? 'file';
}

export const DocumentDropdown: React.FC<DocumentDropdownProps> = ({
  documents,
  query,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    if (!isVisible) { return; }

    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  const highlightMatch = useCallback(
    (name: string) => {
      if (!query) { return name; }

      const lowerName = name.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const parts: React.ReactNode[] = [];
      let queryIdx = 0;

      for (let i = 0; i < name.length; i++) {
        if (queryIdx < lowerQuery.length && lowerName[i] === lowerQuery[queryIdx]) {
          parts.push(
            <strong key={i} style={{ color: 'var(--vscode-list-highlightForeground)' }}>
              {name[i]}
            </strong>,
          );
          queryIdx++;
        } else {
          parts.push(name[i]);
        }
      }

      return <>{parts}</>;
    },
    [query],
  );

  if (!isVisible || documents.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        maxHeight: '240px',
        overflowY: 'auto',
        background: 'var(--vscode-editorSuggestWidget-background)',
        border: '1px solid var(--vscode-editorSuggestWidget-border)',
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        zIndex: 1000,
      }}
      role="listbox"
      aria-label="Document suggestions"
    >
      {documents.map((doc, index) => (
        <div
          key={doc.id}
          ref={index === selectedIndex ? selectedRef : undefined}
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => onSelect(doc)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            background:
              index === selectedIndex
                ? 'var(--vscode-list-activeSelectionBackground)'
                : 'transparent',
            color:
              index === selectedIndex
                ? 'var(--vscode-list-activeSelectionForeground)'
                : 'var(--vscode-editorSuggestWidget-foreground)',
          }}
          onMouseEnter={(e) => {
            if (index !== selectedIndex) {
              e.currentTarget.style.background =
                'var(--vscode-list-hoverBackground)';
            }
          }}
          onMouseLeave={(e) => {
            if (index !== selectedIndex) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <span
            className={`codicon codicon-${getTypeIcon(doc.type)}`}
            style={{ fontSize: '16px', flexShrink: 0 }}
          />
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {highlightMatch(doc.name)}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--vscode-descriptionForeground)',
              flexShrink: 0,
            }}
          >
            {formatSize(doc.size)}
          </span>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/chat/DocumentDropdown.tsx
git commit -m "feat(ext): add DocumentDropdown with fuzzy highlight, keyboard nav, and file type icons"
```

---

### Task 10: Update ChatInput.tsx with @document support

**Files:**
- Modify: `webview-ui/chat/ChatInput.tsx`

- [ ] **Step 1: Write the updated ChatInput with @document autocomplete**

This replaces the Phase 1 ChatInput. The key additions are:
- Detection of `@document` trigger in textarea
- Managing dropdown visibility and keyboard navigation
- Requesting document list from extension host
- Rendering selected documents as chips

```typescript
// webview-ui/chat/ChatInput.tsx
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getVsCodeApi } from '../shared/hooks/useVsCodeApi';
import { DocumentChip } from '../shared/components/DocumentChip';
import { DocumentDropdown } from './DocumentDropdown';

interface Document {
  id: number;
  name: string;
  type: string;
  size: number;
}

interface AIModel {
  id: string;
  name: string;
  provider: string;
}

interface ChatInputProps {
  models: AIModel[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  isStreaming: boolean;
  documents: Document[];
  onSend: (message: string, documentIds: number[]) => void;
  onAbort: () => void;
}

interface DocumentMention {
  doc: Document;
  startIndex: number;
  endIndex: number;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  models,
  selectedModel,
  onModelChange,
  isStreaming,
  documents,
  onSend,
  onAbort,
}) => {
  const [message, setMessage] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<Document[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownQuery, setDropdownQuery] = useState('');
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter documents based on dropdown query
  const filteredDocs = useMemo(() => {
    if (!dropdownQuery) { return documents; }
    const lower = dropdownQuery.toLowerCase();
    return documents.filter((doc) => {
      const lowerName = doc.name.toLowerCase();
      let qi = 0;
      for (let i = 0; i < lowerName.length && qi < lower.length; i++) {
        if (lowerName[i] === lower[qi]) { qi++; }
      }
      return qi === lower.length;
    });
  }, [documents, dropdownQuery]);

  // Request documents from extension when dropdown opens
  useEffect(() => {
    if (showDropdown && documents.length === 0) {
      getVsCodeApi().postMessage({ type: 'loadDocuments' });
    }
  }, [showDropdown, documents.length]);

  // Detect @document trigger
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setMessage(value);

      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = value.slice(0, cursorPos);

      // Look for @ trigger
      const atIndex = textBeforeCursor.lastIndexOf('@');
      if (atIndex >= 0) {
        const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' ';
        // Only trigger if @ is at start or preceded by whitespace
        if (atIndex === 0 || /\s/.test(charBefore)) {
          const query = textBeforeCursor.slice(atIndex + 1);
          // Don't trigger if there's a space in the query (user moved on)
          if (!query.includes(' ') && !query.includes('\n')) {
            setShowDropdown(true);
            setDropdownQuery(query);
            setTriggerPosition(atIndex);
            setDropdownIndex(0);

            // Request search if we have a query
            if (query.length > 0) {
              getVsCodeApi().postMessage({
                type: 'searchDocuments',
                payload: { query },
              });
            }
            return;
          }
        }
      }

      // No valid trigger found
      if (showDropdown) {
        setShowDropdown(false);
        setDropdownQuery('');
        setTriggerPosition(-1);
      }
    },
    [showDropdown],
  );

  // Handle document selection from dropdown
  const handleDocumentSelect = useCallback(
    (doc: Document) => {
      // Replace the @query with empty string (document shown as chip)
      const before = message.slice(0, triggerPosition);
      const cursorPos = textareaRef.current?.selectionStart ?? message.length;
      const after = message.slice(cursorPos);
      const newMessage = before + after;

      setMessage(newMessage);
      setSelectedDocs((prev) => {
        if (prev.some((d) => d.id === doc.id)) { return prev; }
        return [...prev, doc];
      });
      setShowDropdown(false);
      setDropdownQuery('');
      setTriggerPosition(-1);

      // Focus back on textarea
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [message, triggerPosition],
  );

  // Remove selected document
  const handleRemoveDoc = useCallback((docId: number) => {
    setSelectedDocs((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  // Close dropdown
  const handleCloseDropdown = useCallback(() => {
    setShowDropdown(false);
    setDropdownQuery('');
    setTriggerPosition(-1);
  }, []);

  // Send message
  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed && selectedDocs.length === 0) { return; }
    if (isStreaming) { return; }

    onSend(trimmed, selectedDocs.map((d) => d.id));
    setMessage('');
    setSelectedDocs([]);
  }, [message, selectedDocs, isStreaming, onSend]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown) {
        const filtered = filteredDocs;
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setDropdownIndex((prev) =>
              prev < filtered.length - 1 ? prev + 1 : 0,
            );
            return;
          case 'ArrowUp':
            e.preventDefault();
            setDropdownIndex((prev) =>
              prev > 0 ? prev - 1 : filtered.length - 1,
            );
            return;
          case 'Enter':
          case 'Tab':
            e.preventDefault();
            if (filtered[dropdownIndex]) {
              handleDocumentSelect(filtered[dropdownIndex]);
            }
            return;
          case 'Escape':
            e.preventDefault();
            handleCloseDropdown();
            return;
        }
      }

      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showDropdown, dropdownIndex, filteredDocs, handleDocumentSelect, handleCloseDropdown, handleSend],
  );

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Selected documents chips */}
      {selectedDocs.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
          }}
        >
          {selectedDocs.map((doc) => (
            <DocumentChip
              key={doc.id}
              name={doc.name}
              onRemove={() => handleRemoveDoc(doc.id)}
            />
          ))}
        </div>
      )}

      {/* Model picker row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          style={{
            background: 'var(--input-bg)',
            color: 'var(--input-text)',
            border: '1px solid var(--input-border)',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
          }}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name} ({model.provider})
            </option>
          ))}
        </select>
      </div>

      {/* Input area with dropdown */}
      <div style={{ position: 'relative' }}>
        <DocumentDropdown
          documents={filteredDocs}
          query={dropdownQuery}
          isVisible={showDropdown}
          selectedIndex={dropdownIndex}
          onSelect={handleDocumentSelect}
          onClose={handleCloseDropdown}
        />

        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
          }}
        >
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (@ for documents)"
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              minHeight: '36px',
              maxHeight: '200px',
              overflowY: 'auto',
              background: 'var(--input-bg)',
              color: 'var(--input-text)',
              border: '1px solid var(--input-border)',
              borderRadius: '4px',
              padding: '8px 10px',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: '1.4',
            }}
            disabled={isStreaming}
          />

          {isStreaming ? (
            <button
              onClick={onAbort}
              style={{
                background: 'var(--vscode-errorForeground)',
                color: 'var(--accent-text)',
                padding: '8px 16px',
                flexShrink: 0,
              }}
              title="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!message.trim() && selectedDocs.length === 0}
              style={{
                padding: '8px 16px',
                flexShrink: 0,
              }}
              title="Send message (Enter)"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/chat/ChatInput.tsx
git commit -m "feat(ext): update ChatInput with @document autocomplete, dropdown, and document chips"
```

---

## Chunk 5: Integration — Extension Entry Point + ChatPanel Update

### Task 11: Update ChatPanel to handle document messages

**Files:**
- Modify: `src/modules/chat/ChatPanel.ts`

- [ ] **Step 1: Update ChatPanel handleMessage for document-related messages**

Add these cases to the `handleMessage` switch in `ChatPanel.ts`:

```typescript
// Add to ChatPanel.ts — inside handleMessage switch statement

      case 'loadDocuments': {
        if (this.documentProvider) {
          await this.documentProvider.handleLoadDocuments();
        }
        break;
      }
      case 'searchDocuments': {
        if (this.documentProvider) {
          this.documentProvider.handleSearchDocuments(message.payload.query);
        }
        break;
      }
      case 'generateDocumentFromChat': {
        if (this.documentProvider) {
          const { format, content, fileName } = message.payload;
          await this.documentProvider.handleGenerateFromChat(format, content, fileName);
        }
        break;
      }
```

Add a setter for the DocumentProvider reference:

```typescript
// Add to ChatPanel class body

  private documentProvider: import('../documents/DocumentProvider').DocumentProvider | null = null;

  setDocumentProvider(provider: import('../documents/DocumentProvider').DocumentProvider): void {
    this.documentProvider = provider;
  }
```

Also update the `sendMessage` case to include `documentIds`:

```typescript
      case 'sendMessage': {
        const { message: text, modelId, conversationId, documentIds } = message.payload;
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
          documentIds,
        );
        break;
      }
```

- [ ] **Step 2: Update ChatService.sendMessage to accept documentIds**

```typescript
// In src/modules/chat/ChatService.ts — update sendMessage signature

  sendMessage(
    message: string,
    modelId: string,
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    conversationId?: number,
    documentIds?: number[],
  ): void {
    this.abortCurrentRequest();

    this.currentController = this.apiClient.stream(
      API_PATHS.COMPLETIONS,
      {
        message,
        model: modelId,
        ...(conversationId ? { conversationId } : {}),
        ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
        stream: true,
      },
      onChunk,
      onError,
    );
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/chat/ChatPanel.ts src/modules/chat/ChatService.ts
git commit -m "feat(ext): integrate document provider into ChatPanel with message routing"
```

---

### Task 12: Update ChatApp.tsx to pass documents to ChatInput

**Files:**
- Modify: `webview-ui/chat/ChatApp.tsx`

- [ ] **Step 1: Update ChatApp to manage document state**

Add document state management and pass documents to ChatInput:

```typescript
// Add to webview-ui/chat/ChatApp.tsx — inside ChatApp component

  // Document state
  const [documents, setDocuments] = useState<Document[]>([]);

  // Add to the message handler switch:
  //   case 'setDocuments':
  //     setDocuments(message.payload.documents);
  //     break;
  //   case 'documentGenerated':
  //     // Show success indicator in chat
  //     break;

  // Update the ChatInput JSX to include documents prop:
  // <ChatInput
  //   models={models}
  //   selectedModel={selectedModel}
  //   onModelChange={setSelectedModel}
  //   isStreaming={isStreaming}
  //   documents={documents}
  //   onSend={handleSend}
  //   onAbort={handleAbort}
  // />
```

Full updated ChatApp with documents:

```typescript
// webview-ui/chat/ChatApp.tsx
import React, { useState, useCallback } from 'react';
import { useVsCodeMessage, usePostMessage } from '../shared/hooks/useVsCodeApi';
import { useAuth } from '../shared/hooks/useAuth';
import { useModels } from '../shared/hooks/useModels';
import { useStreaming } from '../shared/hooks/useStreaming';
import { MessageArea } from './MessageArea';
import { ChatInput } from './ChatInput';
import { ConversationList } from './ConversationList';
import { ErrorBanner } from '../shared/components/ErrorBanner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Document {
  id: number;
  name: string;
  type: string;
  size: number;
}

interface Conversation {
  id: number;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
}

export const ChatApp: React.FC = () => {
  const postMessage = usePostMessage();
  const { isAuthenticated, user, setAuthenticated, setUnauthenticated } = useAuth();
  const { models, selectedModel, setSelectedModel, updateModels } = useModels();
  const stream = useStreaming();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  useVsCodeMessage((msg: any) => {
    switch (msg.type) {
      case 'setAuthenticated':
        setAuthenticated(msg.payload.user);
        updateModels(msg.payload.models);
        break;
      case 'setUnauthenticated':
        setUnauthenticated();
        break;
      case 'setModels':
        updateModels(msg.payload.models);
        break;
      case 'setConversations':
        setConversations(msg.payload.conversations);
        break;
      case 'streamChunk':
        if (msg.payload.content) {
          stream.appendChunk(msg.payload.content);
        }
        if (msg.payload.conversationId && !currentConversationId) {
          setCurrentConversationId(msg.payload.conversationId);
        }
        break;
      case 'streamEnd': {
        const finalContent = stream.content;
        stream.endStream();
        if (finalContent) {
          setMessages((prev) => [...prev, { role: 'assistant', content: finalContent }]);
        }
        break;
      }
      case 'streamError':
        stream.setError(msg.payload.message);
        setError(msg.payload.message);
        break;
      case 'setDocuments':
        setDocuments(msg.payload.documents);
        break;
      case 'documentGenerated':
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Document generated: **${msg.payload.fileName}**\nSaved to: ${msg.payload.filePath}`,
          },
        ]);
        break;
      case 'prefillMessage':
        // From code actions — add as context
        break;
      case 'addContext':
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: `[Context from ${msg.payload.fileName}]\n${msg.payload.text}` },
        ]);
        break;
    }
  });

  const handleSend = useCallback(
    (text: string, documentIds: number[]) => {
      if (!text.trim() && documentIds.length === 0) { return; }

      setMessages((prev) => [...prev, { role: 'user', content: text }]);
      stream.startStream();
      setError(null);

      postMessage({
        type: 'sendMessage',
        payload: {
          message: text,
          modelId: selectedModel,
          conversationId: currentConversationId,
          documentIds: documentIds.length > 0 ? documentIds : undefined,
        },
      });
    },
    [selectedModel, currentConversationId, postMessage, stream],
  );

  const handleAbort = useCallback(() => {
    postMessage({ type: 'abortRequest' });
    stream.endStream();
  }, [postMessage, stream]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setCurrentConversationId(undefined);
    setError(null);
    setDocuments([]);
  }, []);

  // Send ready signal on mount
  React.useEffect(() => {
    postMessage({ type: 'ready' });
    postMessage({ type: 'loadConversations' });
  }, [postMessage]);

  if (!isAuthenticated) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>Please login to use Enterprise AI Chat.</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '8px' }}>
          Use Command Palette: Enterprise AI: Login
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <ConversationList
        conversations={conversations}
        currentId={currentConversationId}
        onSelect={(id) => setCurrentConversationId(id)}
        onNew={handleNewChat}
        onDelete={(id) => postMessage({ type: 'deleteConversation', payload: { id } })}
      />

      <MessageArea
        messages={messages}
        streamingContent={stream.isStreaming ? stream.content : null}
      />

      <ChatInput
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        isStreaming={stream.isStreaming}
        documents={documents}
        onSend={handleSend}
        onAbort={handleAbort}
      />
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/chat/ChatApp.tsx
git commit -m "feat(ext): update ChatApp with document state, setDocuments handler, and ChatInput integration"
```

---

### Task 13: Update extension.ts to register document and worktree modules

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Write updated extension.ts**

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
import { DocumentService } from './modules/documents/DocumentService';
import { DocumentProvider } from './modules/documents/DocumentProvider';
import { registerDocumentCommands } from './modules/documents/DocumentCommands';
import { WorktreeService } from './modules/worktree/WorktreeService';
import { WorktreeScmProvider } from './modules/worktree/WorktreeScmProvider';
import { registerWorktreeCommands } from './modules/worktree/WorktreeCommands';
import { OUTPUT_CHANNEL_NAME, DEFAULTS } from './utils/constants';
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
      // Wire up document provider if available
      if (documentProvider) {
        chatPanel.setDocumentProvider(documentProvider);
      }
    }
    return chatPanel;
  };

  // Documents module
  const documentService = new DocumentService(apiClient, eventBus, outputChannel);
  let documentProvider: DocumentProvider | null = null;
  documentProvider = new DocumentProvider(moduleContext, documentService, getPanel);

  // Worktree module
  const worktreeService = new WorktreeService(apiClient, eventBus, outputChannel);
  let worktreeScmProvider: WorktreeScmProvider | null = null;
  const getScmProvider = (): WorktreeScmProvider => {
    if (!worktreeScmProvider) {
      worktreeScmProvider = new WorktreeScmProvider(worktreeService, eventBus, outputChannel);
      worktreeScmProvider.startPolling(DEFAULTS.WORKTREE_POLLING);
      worktreeScmProvider.refresh();
    }
    return worktreeScmProvider;
  };

  // Register commands
  const disposables = [
    ...registerChatCommands(moduleContext, getPanel),
    ...registerCodeActionCommands(getPanel),
    ...registerDocumentCommands(documentService),
    ...registerWorktreeCommands(getScmProvider),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new EnterpriseAICodeActionProvider(),
      { providedCodeActionKinds: EnterpriseAICodeActionProvider.providedCodeActionKinds },
    ),
  ];

  context.subscriptions.push(...disposables, outputChannel);

  // Restore session
  authService.tryRestoreSession();

  // Initialize worktree SCM if already authenticated
  if (authService.isAuthenticated()) {
    getScmProvider();
  }

  // Start worktree SCM on login, stop on logout
  eventBus.on('auth:login', () => {
    getScmProvider();
  });

  eventBus.on('auth:logout', () => {
    if (worktreeScmProvider) {
      worktreeScmProvider.stopPolling();
    }
  });

  outputChannel.appendLine('[Extension] Activated (Phase 3: Documents + Worktree)');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
```

- [ ] **Step 2: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ext): register documents and worktree modules in extension entry point"
```

---

## Chunk 6: esbuild Update + Build Verification

### Task 14: Update esbuild config for new webview entries

**Files:**
- Modify: `webview-ui/build.mjs`

- [ ] **Step 1: Verify build.mjs includes all entries**

The `build.mjs` from Phase 1 only has the chat entry. Phase 2 added agents and orchestrator. No new webview entries are needed for Phase 3 — DocumentDropdown and DocumentChip are imported by the chat bundle. Verify the entries list includes all bundles:

```javascript
// webview-ui/build.mjs — entries array should contain:
const entries = [
  { in: 'chat/index.tsx', out: '../out/chatWebview' },
  { in: 'agents/index.tsx', out: '../out/agentsWebview' },
  { in: 'orchestrator/index.tsx', out: '../out/orchestratorWebview' },
];
```

No changes needed if Phase 2 already added agents and orchestrator entries. The chat bundle will automatically include DocumentDropdown and DocumentChip via imports.

- [ ] **Step 2: Build and verify**

```bash
cd vscode-extension && npm run build:all
```
Expected: `out/extension.js`, `out/chatWebview.js`, `out/theme.css` all created without errors.

- [ ] **Step 3: Run all tests**

```bash
cd vscode-extension && npx vitest run
```
Expected: All tests pass (Phase 1 + Phase 2 + Phase 3 tests).

- [ ] **Step 4: Commit**

```bash
git add webview-ui/build.mjs
git commit -m "chore(ext): verify build config includes all Phase 3 webview components"
```

---

### Task 15: Update package.json with worktree SCM contribution

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add worktree SCM contributions to package.json**

Add `onStartupFinished` to the `activationEvents` array to ensure the worktree SCM provider initializes when VS Code finishes loading:

```json
"activationEvents": [
  "onStartupFinished"
]
```

Add the following to the `contributes` section:

```json
"contributes": {
  "configuration": {
    "properties": {
      "enterprise-ai.worktree.pollingInterval": {
        "type": "number",
        "default": 15000,
        "description": "Worktree polling interval in milliseconds"
      }
    }
  }
}
```

Verify that the worktree-related commands are already present from Phase 1:

```json
{ "command": "enterprise-ai.manageWorktrees", "title": "Manage Worktrees", "category": "Enterprise AI" },
{ "command": "enterprise-ai.generateDocument", "title": "Generate Document", "category": "Enterprise AI" }
```

Add internal worktree commands (no palette visibility):

```json
"commands": [
  { "command": "enterprise-ai.worktree.merge", "title": "Merge Worktree", "category": "Enterprise AI" },
  { "command": "enterprise-ai.worktree.discard", "title": "Discard Worktree", "category": "Enterprise AI" },
  { "command": "enterprise-ai.worktree.openDiff", "title": "Open Diff", "category": "Enterprise AI" },
  { "command": "enterprise-ai.worktree.resolveConflict", "title": "Resolve Conflict", "category": "Enterprise AI" }
]
```

Hide internal commands from Command Palette:

```json
"menus": {
  "commandPalette": [
    { "command": "enterprise-ai.worktree.merge", "when": "false" },
    { "command": "enterprise-ai.worktree.discard", "when": "false" },
    { "command": "enterprise-ai.worktree.openDiff", "when": "false" },
    { "command": "enterprise-ai.worktree.resolveConflict", "when": "false" }
  ],
  "scm/resourceGroup/context": [
    {
      "command": "enterprise-ai.worktree.merge",
      "when": "scmProvider == enterprise-ai-worktrees",
      "group": "inline"
    },
    {
      "command": "enterprise-ai.worktree.discard",
      "when": "scmProvider == enterprise-ai-worktrees",
      "group": "1_actions"
    }
  ],
  "scm/resourceState/context": [
    {
      "command": "enterprise-ai.worktree.openDiff",
      "when": "scmProvider == enterprise-ai-worktrees",
      "group": "inline"
    },
    {
      "command": "enterprise-ai.worktree.resolveConflict",
      "when": "scmProvider == enterprise-ai-worktrees",
      "group": "1_actions"
    }
  ]
}
```

- [ ] **Step 2: Full build + package test**

```bash
cd vscode-extension && npm run build:all && npm run package
```
Expected: VSIX created successfully.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(ext): add worktree SCM contributions, document settings, and internal commands to package.json"
```

---

### Task 16: Final integration test

- [ ] **Step 1: Run full test suite**

```bash
cd vscode-extension && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 2: Verify test coverage**

```bash
cd vscode-extension && npx vitest run --coverage
```
Expected: 80%+ coverage on `src/modules/documents/` and `src/modules/worktree/`.

- [ ] **Step 3: Build verification**

```bash
cd vscode-extension && npm run build:all
ls -la out/
```
Expected: `extension.js`, `chatWebview.js`, `agentsWebview.js`, `orchestratorWebview.js`, `theme.css` all present.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(ext): Phase 3 complete — documents module + worktree SCM integration"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1 | Core types (Document, WorktreeInfo, WorktreeMergeResult), updated message protocol, constants |
| 2 | 2-4 | DocumentService (cache, fuzzy search, generation), DocumentCommands (Command Palette), DocumentProvider (bridge) |
| 3 | 5-7 | WorktreeService (list, merge, discard), WorktreeScmProvider (SourceControl API, polling, notifications), WorktreeCommands |
| 4 | 8-10 | DocumentChip component, DocumentDropdown component, ChatInput with @document autocomplete |
| 5 | 11-13 | ChatPanel + ChatService document integration, ChatApp document state, extension.ts module registration |
| 6 | 14-16 | Build verification, package.json SCM contributions, full test suite + coverage |

**Total tasks:** 16
**Total commits:** ~16
**Coverage target:** 80%+ on modules/documents/ and modules/worktree/
