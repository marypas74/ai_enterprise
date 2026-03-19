import { create } from 'zustand';
import {
  getPendingApprovals,
  approveRequest as apiApproveRequest,
  rejectRequest as apiRejectRequest,
  type ApprovalRequest,
} from '../services/marketplaceApi';

export interface HookPoint {
  id: string;
  name: string;
  type: 'pre' | 'post';
  hookType: string;
  order: number;
  enabled: boolean;
  installationId: number;
  catalogItemName: string;
}

interface HookPipelineState {
  // Data
  hookPoints: HookPoint[];
  pendingApprovals: ApprovalRequest[];

  // UI State
  loading: boolean;
  error: string | null;

  // Actions
  fetchPendingApprovals: () => Promise<void>;
  approveRequest: (id: number, notes?: string) => Promise<void>;
  rejectRequest: (id: number, notes: string) => Promise<void>;
  clearError: () => void;
}

export const useHookPipelineStore = create<HookPipelineState>((set, get) => ({
  // Initial state
  hookPoints: [],
  pendingApprovals: [],
  loading: false,
  error: null,

  fetchPendingApprovals: async () => {
    set({ loading: true, error: null });
    try {
      const response = await getPendingApprovals();
      const { data: approvals } = response.data;
      set({
        pendingApprovals: approvals ?? [],
        loading: false,
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch pending approvals';
      set({ error: errorMsg, loading: false });
    }
  },

  approveRequest: async (id, notes) => {
    set({ loading: true, error: null });
    try {
      await apiApproveRequest(id, notes);
      set({ loading: false });
      // Refresh approvals list
      await get().fetchPendingApprovals();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to approve request';
      set({ error: errorMsg, loading: false });
    }
  },

  rejectRequest: async (id, notes) => {
    set({ loading: true, error: null });
    try {
      await apiRejectRequest(id, notes);
      set({ loading: false });
      await get().fetchPendingApprovals();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to reject request';
      set({ error: errorMsg, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
