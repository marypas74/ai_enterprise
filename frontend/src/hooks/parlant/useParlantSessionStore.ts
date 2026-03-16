import { create } from 'zustand';
import { api } from '../../services/api';
import type { ParlantSession, ParlantEvent, ParlantEvaluation } from '../../types/parlant.js';

interface ParlantSessionState {
  // State
  sessions: ParlantSession[];
  currentSession: ParlantSession | null;
  events: ParlantEvent[];
  evaluations: ParlantEvaluation[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSessions: (agentId?: string) => Promise<void>;
  createSession: (agentId: string, customerId?: string, metadata?: Record<string, any>) => Promise<ParlantSession | null>;
  fetchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  fetchEvents: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<ParlantEvent | null>;
  fetchEvaluations: (sessionId: string) => Promise<void>;
  clearError: () => void;
}

export const useParlantSessionStore = create<ParlantSessionState>((set) => ({
  // Initial state
  sessions: [],
  currentSession: null,
  events: [],
  evaluations: [],
  isLoading: false,
  error: null,

  // Actions
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
