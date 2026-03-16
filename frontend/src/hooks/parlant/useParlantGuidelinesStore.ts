import { create } from 'zustand';
import { api } from '../../services/api';
import type { ParlantGuideline } from '../../types/parlant.js';

interface ParlantGuidelinesState {
  // State
  guidelines: ParlantGuideline[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchGuidelines: (agentId: string) => Promise<void>;
  createGuideline: (agentId: string, condition: string, action: string, priority?: number) => Promise<ParlantGuideline | null>;
  updateGuideline: (agentId: string, guidelineId: string, updates: Partial<ParlantGuideline>) => Promise<boolean>;
  deleteGuideline: (agentId: string, guidelineId: string) => Promise<boolean>;
  clearError: () => void;
}

export const useParlantGuidelinesStore = create<ParlantGuidelinesState>((set) => ({
  // Initial state
  guidelines: [],
  isLoading: false,
  error: null,

  // Actions
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

  clearError: () => set({ error: null })
}));
