import { create } from 'zustand';
import { api } from '../services/api';
import type { AgentSession, SessionConfig, SessionLog, CreateSessionData } from '../types/index.js';

interface SessionState {
  sessions: AgentSession[];
  activeSessions: AgentSession[];
  selectedSession: AgentSession | null;
  sessionLogs: SessionLog[];
  isLoading: boolean;
  error: string | null;

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
  setSelectedSession: (session: AgentSession | null) => void;
  clearError: () => void;
}

const sessionApi = {
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
    api.get(`/agents/sessions/${id}/logs`, { params }),
};

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessions: [],
  selectedSession: null,
  sessionLogs: [],
  isLoading: false,
  error: null,

  fetchSessions: async (options) => {
    set({ isLoading: true, error: null });
    try {
      const response = await sessionApi.list(options);
      const { sessions } = response.data;
      set({
        sessions,
        activeSessions: sessions.filter((s: AgentSession) =>
          s.status === 'running' || s.status === 'paused' || s.status === 'initializing'
        ),
        isLoading: false,
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to fetch sessions';
      const details = err.response?.data?.details;
      const fullError = details ? `${errorMsg}: ${JSON.stringify(details)}` : errorMsg;
      console.error('[SessionStore] fetchSessions error:', fullError);
      set({ error: fullError, isLoading: false });
    }
  },

  fetchSession: async (sessionId) => {
    try {
      const response = await sessionApi.get(sessionId);
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
      const response = await sessionApi.create(data);
      const session = response.data;
      set(state => ({
        sessions: [session, ...state.sessions],
        isLoading: false,
      }));
      return session;
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to create session';
      const details = err.response?.data?.details;
      const fullError = details ? `${errorMsg}: ${JSON.stringify(details)}` : errorMsg;
      console.error('[SessionStore] createSession error:', fullError);
      set({ error: fullError, isLoading: false });
      throw err;
    }
  },

  updateSession: async (sessionId, data) => {
    try {
      const response = await sessionApi.update(sessionId, data);
      const updated = response.data;
      set(state => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updated : s),
        selectedSession: state.selectedSession?.id === sessionId ? updated : state.selectedSession,
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to update session' });
      throw err;
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await sessionApi.delete(sessionId);
      set(state => ({
        sessions: state.sessions.filter(s => s.id !== sessionId),
        activeSessions: state.activeSessions.filter(s => s.id !== sessionId),
        selectedSession: state.selectedSession?.id === sessionId ? null : state.selectedSession,
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete session' });
      throw err;
    }
  },

  startSession: async (sessionId) => {
    try {
      await sessionApi.start(sessionId);
      await get().fetchSession(sessionId);
      await get().fetchSessions();
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to start session' });
      throw err;
    }
  },

  pauseSession: async (sessionId) => {
    try {
      await sessionApi.pause(sessionId);
      await get().fetchSession(sessionId);
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to pause session' });
      throw err;
    }
  },

  resumeSession: async (sessionId) => {
    try {
      await sessionApi.resume(sessionId);
      await get().fetchSession(sessionId);
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to resume session' });
      throw err;
    }
  },

  cancelSession: async (sessionId) => {
    try {
      await sessionApi.cancel(sessionId);
      await get().fetchSession(sessionId);
      await get().fetchSessions();
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to cancel session' });
      throw err;
    }
  },

  fetchSessionLogs: async (sessionId, options) => {
    try {
      const response = await sessionApi.logs(sessionId, options);
      set({ sessionLogs: response.data.logs });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch logs' });
    }
  },

  setSelectedSession: (session) => set({ selectedSession: session }),
  clearError: () => set({ error: null }),
}));
