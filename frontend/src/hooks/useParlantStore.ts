import { create } from 'zustand';
import { api } from '../services/api';

// Types
export interface ParlantAgent {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface ParlantGuideline {
  id: string;
  agentId: string;
  condition: string;
  action: string;
  priority?: number;
  enabled: boolean;
  createdAt?: string;
}

export interface ParlantSession {
  id: string;
  agentId: string;
  customerId?: string;
  status?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
}

export interface ParlantEvent {
  id: string;
  sessionId: string;
  kind: string;
  source: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt?: string;
}

export interface ParlantEvaluation {
  id: string;
  sessionId: string;
  guidelineId: string;
  applied: boolean;
  rationale?: string;
}

interface ParlantState {
  // State
  agents: ParlantAgent[];
  currentAgent: ParlantAgent | null;
  guidelines: ParlantGuideline[];
  sessions: ParlantSession[];
  currentSession: ParlantSession | null;
  events: ParlantEvent[];
  evaluations: ParlantEvaluation[];
  isLoading: boolean;
  error: string | null;
  serviceHealth: 'healthy' | 'unhealthy' | 'unknown';

  // Actions
  checkHealth: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchAgent: (agentId: string) => Promise<void>;
  createAgent: (name: string, description?: string) => Promise<ParlantAgent | null>;
  deleteAgent: (agentId: string) => Promise<boolean>;
  fetchGuidelines: (agentId: string) => Promise<void>;
  createGuideline: (agentId: string, condition: string, action: string, priority?: number) => Promise<ParlantGuideline | null>;
  updateGuideline: (agentId: string, guidelineId: string, updates: Partial<ParlantGuideline>) => Promise<boolean>;
  deleteGuideline: (agentId: string, guidelineId: string) => Promise<boolean>;
  fetchSessions: (agentId?: string) => Promise<void>;
  createSession: (agentId: string, customerId?: string, metadata?: Record<string, any>) => Promise<ParlantSession | null>;
  fetchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  fetchEvents: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<ParlantEvent | null>;
  fetchEvaluations: (sessionId: string) => Promise<void>;
  clearError: () => void;
}

export const useParlantStore = create<ParlantState>((set, get) => ({
  // Initial state
  agents: [],
  currentAgent: null,
  guidelines: [],
  sessions: [],
  currentSession: null,
  events: [],
  evaluations: [],
  isLoading: false,
  error: null,
  serviceHealth: 'unknown',

  // Actions
  checkHealth: async () => {
    try {
      const response = await api.get('/parlant/health');
      set({ serviceHealth: response.data?.status === 'ok' ? 'healthy' : 'unhealthy' });
    } catch {
      set({ serviceHealth: 'unhealthy' });
    }
  },

  fetchAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get('/parlant/agents');
      set({ agents: response.data || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch agents', isLoading: false });
    }
  },

  fetchAgent: async (agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get(`/parlant/agents/${agentId}`);
      set({ currentAgent: response.data, isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch agent', isLoading: false });
    }
  },

  createAgent: async (name: string, description?: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/parlant/agents', { name, description });
      const newAgent = response.data;
      set((state) => ({ agents: [...state.agents, newAgent], isLoading: false }));
      return newAgent;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to create agent', isLoading: false });
      return null;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete(`/parlant/agents/${agentId}`);
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== agentId),
        currentAgent: state.currentAgent?.id === agentId ? null : state.currentAgent,
        isLoading: false
      }));
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete agent', isLoading: false });
      return false;
    }
  },

  fetchGuidelines: async (agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get(`/parlant/agents/${agentId}/guidelines`);
      set({ guidelines: response.data || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch guidelines', isLoading: false });
    }
  },

  createGuideline: async (agentId: string, condition: string, action: string, priority?: number) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post(`/parlant/agents/${agentId}/guidelines`, { condition, action, priority });
      const newGuideline = response.data;
      set((state) => ({ guidelines: [...state.guidelines, newGuideline], isLoading: false }));
      return newGuideline;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to create guideline', isLoading: false });
      return null;
    }
  },

  updateGuideline: async (agentId: string, guidelineId: string, updates: Partial<ParlantGuideline>) => {
    set({ isLoading: true, error: null });
    try {
      await api.patch(`/parlant/agents/${agentId}/guidelines/${guidelineId}`, updates);
      set((state) => ({
        guidelines: state.guidelines.map((g) =>
          g.id === guidelineId ? { ...g, ...updates } : g
        ),
        isLoading: false
      }));
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to update guideline', isLoading: false });
      return false;
    }
  },

  deleteGuideline: async (agentId: string, guidelineId: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete(`/parlant/agents/${agentId}/guidelines/${guidelineId}`);
      set((state) => ({
        guidelines: state.guidelines.filter((g) => g.id !== guidelineId),
        isLoading: false
      }));
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete guideline', isLoading: false });
      return false;
    }
  },

  fetchSessions: async (agentId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const params = agentId ? `?agentId=${agentId}` : '';
      const response = await api.get(`/parlant/sessions${params}`);
      set({ sessions: response.data || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch sessions', isLoading: false });
    }
  },

  createSession: async (agentId: string, customerId?: string, metadata?: Record<string, any>) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/parlant/sessions', { agentId, customerId, metadata });
      const newSession = response.data;
      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSession: newSession,
        isLoading: false
      }));
      return newSession;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to create session', isLoading: false });
      return null;
    }
  },

  fetchSession: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get(`/parlant/sessions/${sessionId}`);
      set({ currentSession: response.data, isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch session', isLoading: false });
    }
  },

  deleteSession: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete(`/parlant/sessions/${sessionId}`);
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        currentSession: state.currentSession?.id === sessionId ? null : state.currentSession,
        isLoading: false
      }));
      return true;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete session', isLoading: false });
      return false;
    }
  },

  fetchEvents: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get(`/parlant/sessions/${sessionId}/events`);
      set({ events: response.data || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch events', isLoading: false });
    }
  },

  sendMessage: async (sessionId: string, content: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post(`/parlant/sessions/${sessionId}/events`, { content });
      const newEvent = response.data;
      set((state) => ({
        events: [...state.events, newEvent],
        isLoading: false
      }));
      return newEvent;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to send message', isLoading: false });
      return null;
    }
  },

  fetchEvaluations: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get(`/parlant/sessions/${sessionId}/evaluations`);
      set({ evaluations: response.data || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch evaluations', isLoading: false });
    }
  },

  clearError: () => set({ error: null })
}));
