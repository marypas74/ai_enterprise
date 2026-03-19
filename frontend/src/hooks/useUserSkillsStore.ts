import { create } from 'zustand';
import {
  getMyInstallations,
  type Installation,
} from '../services/marketplaceApi';

interface UserSkillsState {
  // Data
  installedSkills: Installation[];

  // UI State
  loading: boolean;
  error: string | null;

  // Actions
  fetchMySkills: () => Promise<void>;
  clearError: () => void;
}

export const useUserSkillsStore = create<UserSkillsState>((set) => ({
  // Initial state
  installedSkills: [],
  loading: false,
  error: null,

  fetchMySkills: async () => {
    set({ loading: true, error: null });
    try {
      const response = await getMyInstallations();
      const { data: installations } = response.data;
      set({
        installedSkills: installations ?? [],
        loading: false,
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch installed skills';
      set({ error: errorMsg, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
