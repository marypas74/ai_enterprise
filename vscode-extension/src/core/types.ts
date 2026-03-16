// ---- Event Bus ----
export interface EventMap {
  'auth:login': { userId: string; email: string };
  'auth:logout': void;
  'config:changed': { key: string; value: unknown };
  'models:loaded': { models: AIModel[] };
  'agent:started': { sessionId: string };
  'agent:completed': { sessionId: string; status: string };
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
  | { type: 'restoreState'; payload: Record<string, unknown> }
  | { type: 'setDocuments'; payload: { documents: Document[] } }
  | { type: 'documentGenerated'; payload: { fileName: string; filePath: string } };

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

// Extension internal messages (not in protocol, used by ChatCommands -> ChatPanel)
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
