// Message types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

// VS Code API type
export interface VSCodeAPI {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
}

// Message from extension
export interface ExtensionMessage {
  type:
    | 'addMessage'
    | 'streamStart'
    | 'streamChunk'
    | 'streamEnd'
    | 'setLoading'
    | 'clearMessages'
    | 'updateModels'
    | 'setAuthenticated'
    | 'insertCode';
  payload?: any;
}

// Model type
export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
}

// Auth state
export interface AuthState {
  isAuthenticated: boolean;
  user?: {
    name: string;
    email: string;
  };
}

// Playground settings
export interface PlaygroundSettings {
  temperature: number;
  maxTokens: number;
  topP: number;
}

declare global {
  function acquireVsCodeApi(): VSCodeAPI;
}
