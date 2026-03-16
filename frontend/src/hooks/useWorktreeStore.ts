import { create } from 'zustand';
import { api } from '../services/api';
import type { WorktreeStatus } from '../types/index.js';

interface WorktreeState {
  worktreeStatus: WorktreeStatus | null;
  isLoading: boolean;
  error: string | null;

  fetchWorktreeStatus: (sessionId: number) => Promise<void>;
  mergeWorktree: (sessionId: number) => Promise<any>;
  resolveConflict: (sessionId: number, filePath: string, resolvedContent: string, tier: 'automated' | 'ai_assisted' | 'manual', rationale?: string) => Promise<void>;
  clearError: () => void;
}

const worktreeApi = {
  status: (sessionId: number) => api.get(`/agents/sessions/${sessionId}/worktree`),
  merge: (sessionId: number) => api.post(`/agents/sessions/${sessionId}/worktree/merge`),
  conflicts: (sessionId: number) => api.get(`/agents/sessions/${sessionId}/conflicts`),
  resolve: (sessionId: number, data: any) => api.post(`/agents/sessions/${sessionId}/conflicts/resolve`, data),
};

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  worktreeStatus: null,
  isLoading: false,
  error: null,

  fetchWorktreeStatus: async (sessionId) => {
    try {
      const response = await worktreeApi.status(sessionId);
      set({ worktreeStatus: response.data });
    } catch (err: any) {
      set({ worktreeStatus: null });
    }
  },

  mergeWorktree: async (sessionId) => {
    try {
      const response = await worktreeApi.merge(sessionId);
      await get().fetchWorktreeStatus(sessionId);
      return response.data;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to merge worktree' });
      throw err;
    }
  },

  resolveConflict: async (sessionId, filePath, resolvedContent, tier, rationale) => {
    try {
      await worktreeApi.resolve(sessionId, { filePath, resolvedContent, tier, rationale });
      await get().fetchWorktreeStatus(sessionId);
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to resolve conflict' });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
