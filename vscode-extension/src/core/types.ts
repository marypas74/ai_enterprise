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
