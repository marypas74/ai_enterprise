import { create } from 'zustand';
import {
  fetchCatalog as apiFetchCatalog,
  triggerSync as apiTriggerSync,
  installItem as apiInstallItem,
  uninstallItem as apiUninstallItem,
  getNotifications as apiGetNotifications,
  getSyncStatus as apiGetSyncStatus,
  type CatalogItem,
  type CatalogFilters,
  type SyncStatus,
} from '../services/marketplaceApi';

interface MarketplaceFilters {
  type?: string;
  tier?: string;
  category?: string;
  search?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

interface MarketplaceState {
  // Data
  catalogItems: CatalogItem[];
  syncStatus: SyncStatus | null;
  notificationCount: number;
  filters: MarketplaceFilters;
  pagination: Pagination;

  // UI State
  loading: boolean;
  error: string | null;

  // Actions
  fetchCatalog: () => Promise<void>;
  setFilters: (filters: MarketplaceFilters) => void;
  setPage: (page: number) => void;
  triggerSync: () => Promise<void>;
  installItem: (catalogItemId: number) => Promise<void>;
  uninstallItem: (installationId: number) => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchSyncStatus: () => Promise<void>;
  clearError: () => void;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  // Initial state
  catalogItems: [],
  syncStatus: null,
  notificationCount: 0,
  filters: {},
  pagination: { page: 1, limit: 20, total: 0 },
  loading: false,
  error: null,

  fetchCatalog: async () => {
    const { filters, pagination } = get();
    set({ loading: true, error: null });
    try {
      const params: CatalogFilters = {
        ...filters,
        page: pagination.page,
        limit: pagination.limit,
      };
      const response = await apiFetchCatalog(params);
      const { data: items, meta } = response.data;
      set({
        catalogItems: items ?? [],
        pagination: {
          page: meta?.page ?? pagination.page,
          limit: meta?.limit ?? pagination.limit,
          total: meta?.total ?? 0,
        },
        loading: false,
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch catalog';
      set({ error: errorMsg, loading: false });
    }
  },

  setFilters: (filters) => {
    set({ filters, pagination: { ...get().pagination, page: 1 } });
  },

  setPage: (page) => {
    set({ pagination: { ...get().pagination, page } });
  },

  triggerSync: async () => {
    set({ loading: true, error: null });
    try {
      await apiTriggerSync();
      set({ loading: false });
      // Refresh status after triggering
      await get().fetchSyncStatus();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to trigger sync';
      set({ error: errorMsg, loading: false });
    }
  },

  installItem: async (catalogItemId) => {
    set({ loading: true, error: null });
    try {
      await apiInstallItem(catalogItemId);
      set({ loading: false });
      // Refresh catalog to update installation status
      await get().fetchCatalog();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to install item';
      set({ error: errorMsg, loading: false });
    }
  },

  uninstallItem: async (installationId) => {
    set({ loading: true, error: null });
    try {
      await apiUninstallItem(installationId);
      set({ loading: false });
      await get().fetchCatalog();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to uninstall item';
      set({ error: errorMsg, loading: false });
    }
  },

  fetchNotifications: async () => {
    try {
      const response = await apiGetNotifications();
      const { data } = response.data;
      set({ notificationCount: data?.count ?? 0 });
    } catch (err: any) {
      // Non-critical: don't set error state for notification fetch failures
      console.warn('[MarketplaceStore] Failed to fetch notifications:', err.message);
    }
  },

  fetchSyncStatus: async () => {
    try {
      const response = await apiGetSyncStatus();
      set({ syncStatus: response.data.data ?? null });
    } catch (err: any) {
      console.warn('[MarketplaceStore] Failed to fetch sync status:', err.message);
    }
  },

  clearError: () => set({ error: null }),
}));
