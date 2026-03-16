import { create } from 'zustand';
import { api } from '../../services/api';
import type { ParlantAgent } from '../../types/parlant.js';

interface ParlantAgentState {
  // State
  agents: ParlantAgent[];
  currentAgent: ParlantAgent | null;
  serviceHealth: 'healthy' | 'unhealthy' | 'unknown';
  isLoading: boolean;
  error: string | null;

  // Actions
  checkHealth: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchAgent: (agentId: string) => Promise<void>;
  createAgent: (name: string, description?: string) => Promise<ParlantAgent | null>;
  deleteAgent: (agentId: string) => Promise<boolean>;
  clearError: () => void;
}

export const useParlantAgentStore = create<ParlantAgentState>((set) => ({
  // Initial state
  agents: [],
  currentAgent: null,
  serviceHealth: 'unknown',
  isLoading: false,
  error: null,

  // Actions
  checkHealth: async () => {
    try {
      const response = await api.get('/parlant/health');
      // Backend returns { status: 'healthy', service: 'parlant', data: ... }
      const isHealthy = response.data?.status === 'healthy' || response.data?.status === 'ok';
      set({ serviceHealth: isHealthy ? 'healthy' : 'unhealthy' });
    } catch (err) {
      console.error('[Parlant] Health check failed:', err);
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

  clearError: () => set({ error: null })
}));
