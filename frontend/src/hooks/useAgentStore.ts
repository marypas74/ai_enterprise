import { create } from 'zustand';
import { api } from '../services/api';

// Types
export interface AgentSession {
  id: number;
  agentId: number | null;
  userId: number;
  name: string;
  status: 'pending' | 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  modelId: number;
  modelName?: string;
  modelDisplayName?: string;
  systemPrompt: string | null;
  taskSpecification: string;
  worktreePath: string | null;
  worktreeBranch: string | null;
  terminalSlot: number;
  iterationCount: number;
  maxIterations: number;
  timeoutSeconds: number;
  parentSessionId: number | null;
  config: SessionConfig;
  metrics: any;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConfig {
  maxIterations?: number;
  timeoutSeconds?: number;
  autoCommit?: boolean;
  runTests?: boolean;
  createWorktree?: boolean;
  baseBranch?: string;
}

export interface SessionLog {
  id: number;
  sessionId: number;
  logType: 'info' | 'warning' | 'error' | 'stdout' | 'stderr';
  content: string;
  metadata: any;
  timestamp: string;
}

export interface AgentTemplate {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  modelId: number;
  modelName: string;
  modelDisplayName: string;
  systemPrompt: string;
  defaultConfig: Record<string, any>;
  tools: string[];
  maxIterations: number;
  timeoutSeconds: number;
  category: string;
  isPublic: boolean;
  createdAt: string;
}

export interface TerminalSlot {
  slot: number;
  status: 'available' | 'occupied' | 'reserved';
  sessionId: number | null;
  sessionName: string | null;
  assignedAt: string | null;
}

export interface OrchestratorMetrics {
  terminals: {
    total: number;
    available: number;
    occupied: number;
    reserved: number;
  };
  sessions: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  performance: {
    totalIterations: number;
    avgDurationSeconds: number;
  };
}

export interface WorktreeStatus {
  id: number;
  sessionId: number;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  status: 'active' | 'merged' | 'conflict' | 'deleted';
  conflictFiles: string[];
  createdAt: string;
  mergedAt: string | null;
}

export interface ConflictContent {
  path: string;
  ourContent: string;
  theirContent: string;
  baseContent: string;
}

export interface CreateSessionData {
  name: string;
  taskSpecification: string;
  modelId: number;
  systemPrompt?: string;
  templateId?: number;
  cardId?: number;
  config?: SessionConfig;
}

// Store State
interface AgentState {
  // Data
  sessions: AgentSession[];
  activeSessions: AgentSession[];
  selectedSession: AgentSession | null;
  sessionLogs: SessionLog[];
  templates: AgentTemplate[];
  terminalSlots: TerminalSlot[];
  orchestratorMetrics: OrchestratorMetrics | null;
  worktreeStatus: WorktreeStatus | null;

  // UI State
  isLoading: boolean;
  error: string | null;

  // WebSocket connection
  wsConnection: WebSocket | null;

  // Actions
  fetchSessions: (options?: { status?: string; limit?: number; offset?: number }) => Promise<void>;
  fetchSession: (sessionId: number) => Promise<AgentSession | null>;
  createSession: (data: CreateSessionData) => Promise<AgentSession>;
  updateSession: (sessionId: number, data: Partial<{ name: string; config: SessionConfig }>) => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
  startSession: (sessionId: number) => Promise<void>;
  pauseSession: (sessionId: number) => Promise<void>;
  resumeSession: (sessionId: number) => Promise<void>;
  cancelSession: (sessionId: number) => Promise<void>;

  fetchSessionLogs: (sessionId: number, options?: { limit?: number; offset?: number; logType?: string }) => Promise<void>;

  fetchTemplates: (category?: string) => Promise<void>;
  createTemplate: (data: Partial<AgentTemplate>) => Promise<void>;
  deleteTemplate: (templateId: number) => Promise<void>;

  fetchTerminalSlots: () => Promise<void>;
  fetchOrchestratorMetrics: () => Promise<void>;
  fetchDashboard: () => Promise<any>;

  fetchWorktreeStatus: (sessionId: number) => Promise<void>;
  mergeWorktree: (sessionId: number) => Promise<any>;
  resolveConflict: (sessionId: number, filePath: string, resolvedContent: string, tier: 'automated' | 'ai_assisted' | 'manual', rationale?: string) => Promise<void>;

  connectWebSocket: (sessionId?: number) => void;
  disconnectWebSocket: () => void;

  setSelectedSession: (session: AgentSession | null) => void;
  clearError: () => void;
}

// API helper
const agentApi = {
  sessions: {
    list: (params?: { status?: string; limit?: number; offset?: number }) =>
      api.get('/agents/sessions', { params }),
    get: (id: number) => api.get(`/agents/sessions/${id}`),
    create: (data: CreateSessionData) => api.post('/agents/sessions', data),
    update: (id: number, data: any) => api.patch(`/agents/sessions/${id}`, data),
    delete: (id: number) => api.delete(`/agents/sessions/${id}`),
    start: (id: number) => api.post(`/agents/sessions/${id}/start`),
    pause: (id: number) => api.post(`/agents/sessions/${id}/pause`),
    resume: (id: number) => api.post(`/agents/sessions/${id}/resume`),
    cancel: (id: number) => api.post(`/agents/sessions/${id}/cancel`),
    logs: (id: number, params?: { limit?: number; offset?: number; logType?: string }) =>
      api.get(`/agents/sessions/${id}/logs`, { params })
  },
  templates: {
    list: (params?: { category?: string }) => api.get('/agents/templates', { params }),
    create: (data: any) => api.post('/agents/templates', data),
    delete: (id: number) => api.delete(`/agents/templates/${id}`)
  },
  worktree: {
    status: (sessionId: number) => api.get(`/agents/sessions/${sessionId}/worktree`),
    merge: (sessionId: number) => api.post(`/agents/sessions/${sessionId}/worktree/merge`),
    conflicts: (sessionId: number) => api.get(`/agents/sessions/${sessionId}/conflicts`),
    resolve: (sessionId: number, data: any) => api.post(`/agents/sessions/${sessionId}/conflicts/resolve`, data)
  },
  orchestrator: {
    status: () => api.get('/orchestrator/status'),
    terminals: () => api.get('/orchestrator/terminals'),
    dashboard: () => api.get('/orchestrator/dashboard'),
    health: () => api.get('/orchestrator/health')
  }
};

export const useAgentStore = create<AgentState>((set, get) => ({
  // Initial state
  sessions: [],
  activeSessions: [],
  selectedSession: null,
  sessionLogs: [],
  templates: [],
  terminalSlots: [],
  orchestratorMetrics: null,
  worktreeStatus: null,
  isLoading: false,
  error: null,
  wsConnection: null,

  // Session actions
  fetchSessions: async (options) => {
    set({ isLoading: true, error: null });
    try {
      const response = await agentApi.sessions.list(options);
      const { sessions, total } = response.data;
      set({
        sessions,
        activeSessions: sessions.filter((s: AgentSession) =>
          s.status === 'running' || s.status === 'paused' || s.status === 'initializing'
        ),
        isLoading: false
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to fetch sessions';
      const details = err.response?.data?.details;
      const fullError = details ? `${errorMsg}: ${JSON.stringify(details)}` : errorMsg;
      console.error('[AgentStore] fetchSessions error:', fullError);
      set({ error: fullError, isLoading: false });
    }
  },

  fetchSession: async (sessionId) => {
    try {
      const response = await agentApi.sessions.get(sessionId);
      const session = response.data;
      set({ selectedSession: session });
      return session;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch session' });
      return null;
    }
  },

  createSession: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await agentApi.sessions.create(data);
      const session = response.data;
      set(state => ({
        sessions: [session, ...state.sessions],
        isLoading: false
      }));
      return session;
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to create session';
      const details = err.response?.data?.details;
      const fullError = details ? `${errorMsg}: ${JSON.stringify(details)}` : errorMsg;
      console.error('[AgentStore] createSession error:', fullError);
      set({ error: fullError, isLoading: false });
      throw err;
    }
  },

  updateSession: async (sessionId, data) => {
    try {
      const response = await agentApi.sessions.update(sessionId, data);
      const updated = response.data;
      set(state => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updated : s),
        selectedSession: state.selectedSession?.id === sessionId ? updated : state.selectedSession
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to update session' });
      throw err;
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await agentApi.sessions.delete(sessionId);
      set(state => ({
        sessions: state.sessions.filter(s => s.id !== sessionId),
        activeSessions: state.activeSessions.filter(s => s.id !== sessionId),
        selectedSession: state.selectedSession?.id === sessionId ? null : state.selectedSession
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete session' });
      throw err;
    }
  },

  startSession: async (sessionId) => {
    try {
      await agentApi.sessions.start(sessionId);
      await get().fetchSession(sessionId);
      await get().fetchSessions();
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to start session' });
      throw err;
    }
  },

  pauseSession: async (sessionId) => {
    try {
      await agentApi.sessions.pause(sessionId);
      await get().fetchSession(sessionId);
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to pause session' });
      throw err;
    }
  },

  resumeSession: async (sessionId) => {
    try {
      await agentApi.sessions.resume(sessionId);
      await get().fetchSession(sessionId);
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to resume session' });
      throw err;
    }
  },

  cancelSession: async (sessionId) => {
    try {
      await agentApi.sessions.cancel(sessionId);
      await get().fetchSession(sessionId);
      await get().fetchSessions();
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to cancel session' });
      throw err;
    }
  },

  // Logs
  fetchSessionLogs: async (sessionId, options) => {
    try {
      const response = await agentApi.sessions.logs(sessionId, options);
      set({ sessionLogs: response.data.logs });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch logs' });
    }
  },

  // Templates
  fetchTemplates: async (category) => {
    try {
      const response = await agentApi.templates.list(category ? { category } : undefined);
      set({ templates: response.data });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch templates' });
    }
  },

  createTemplate: async (data) => {
    try {
      await agentApi.templates.create(data);
      await get().fetchTemplates();
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to create template' });
      throw err;
    }
  },

  deleteTemplate: async (templateId) => {
    try {
      await agentApi.templates.delete(templateId);
      set(state => ({
        templates: state.templates.filter(t => t.id !== templateId)
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete template' });
      throw err;
    }
  },

  // Orchestrator
  fetchTerminalSlots: async () => {
    try {
      const response = await agentApi.orchestrator.terminals();
      set({ terminalSlots: response.data.slots });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch terminal slots' });
    }
  },

  fetchOrchestratorMetrics: async () => {
    try {
      const response = await agentApi.orchestrator.status();
      set({ orchestratorMetrics: response.data });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to fetch metrics';
      const details = err.response?.data?.details;
      const fullError = details ? `${errorMsg}: ${JSON.stringify(details)}` : errorMsg;
      console.error('[AgentStore] fetchOrchestratorMetrics error:', fullError);
      set({ error: fullError });
    }
  },

  fetchDashboard: async () => {
    try {
      const response = await agentApi.orchestrator.dashboard();
      const { orchestrator, user, templates } = response.data;
      set({
        orchestratorMetrics: orchestrator,
        activeSessions: user.activeSessions,
        sessions: user.recentSessions,
        templates
      });
      return response.data;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch dashboard' });
      return null;
    }
  },

  // Worktree
  fetchWorktreeStatus: async (sessionId) => {
    try {
      const response = await agentApi.worktree.status(sessionId);
      set({ worktreeStatus: response.data });
    } catch (err: any) {
      set({ worktreeStatus: null });
    }
  },

  mergeWorktree: async (sessionId) => {
    try {
      const response = await agentApi.worktree.merge(sessionId);
      await get().fetchWorktreeStatus(sessionId);
      return response.data;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to merge worktree' });
      throw err;
    }
  },

  resolveConflict: async (sessionId, filePath, resolvedContent, tier, rationale) => {
    try {
      await agentApi.worktree.resolve(sessionId, { filePath, resolvedContent, tier, rationale });
      await get().fetchWorktreeStatus(sessionId);
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to resolve conflict' });
      throw err;
    }
  },

  // WebSocket
  connectWebSocket: (sessionId) => {
    const wsUrl = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const path = sessionId ? `/ws/agents/${sessionId}` : '/ws/orchestrator';

    const ws = new WebSocket(`${wsUrl}${path}`);

    ws.onopen = () => {
      console.log('[WS] Connected to', path);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle different event types
        switch (data.type) {
          case 'log_added':
            set(state => ({
              sessionLogs: [...state.sessionLogs, data.log]
            }));
            break;
          case 'session_updated':
          case 'session_completed':
          case 'session_failed':
            // Refresh session data
            if (sessionId) {
              get().fetchSession(sessionId);
            }
            get().fetchSessions();
            break;
          case 'terminal_assigned':
          case 'terminal_released':
            get().fetchTerminalSlots();
            break;
          case 'initial':
            set({ orchestratorMetrics: data });
            break;
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      set({ wsConnection: null });
    };

    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    set({ wsConnection: ws });
  },

  disconnectWebSocket: () => {
    const { wsConnection } = get();
    if (wsConnection) {
      wsConnection.close();
      set({ wsConnection: null });
    }
  },

  // UI
  setSelectedSession: (session) => set({ selectedSession: session }),
  clearError: () => set({ error: null })
}));
