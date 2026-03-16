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
