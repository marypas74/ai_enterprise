import { api } from './api';

// --- Types ---

export interface CatalogItem {
  id: number;
  sourceId: string;
  type: 'skill' | 'agent' | 'mcp' | 'hook';
  tier: 'tier1' | 'tier2' | 'tier3';
  name: string;
  description: string | null;
  readme: string | null;
  category: string | null;
  author: string | null;
  repositoryUrl: string | null;
  version: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  isActive: boolean;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Installation {
  id: number;
  userId: number;
  catalogItemId: number;
  status: 'pending_approval' | 'approved' | 'installed' | 'rejected' | 'failed';
  installedVersion: string | null;
  config: Record<string, unknown>;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
  catalogItem?: CatalogItem;
}

export interface ApprovalRequest {
  id: number;
  installationId: number;
  userId: number;
  username?: string;
  catalogItemName?: string;
  catalogItemType?: string;
  catalogItemTier?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: number | null;
  reviewNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface SyncStatus {
  status: 'idle' | 'running' | 'paused' | 'failed';
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  itemsSynced: number;
  errors: string[];
}

export interface KBDocument {
  id: number;
  installationId: number;
  documentName: string;
  chunkCount: number;
  createdAt: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
  meta?: PaginationMeta;
}

// --- Catalog ---

export interface CatalogFilters {
  type?: string;
  tier?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const fetchCatalog = (params?: CatalogFilters) =>
  api.get<ApiResponse<CatalogItem[]>>('/marketplace/catalog', { params });

export const getCatalogItem = (id: number) =>
  api.get<ApiResponse<CatalogItem>>(`/marketplace/catalog/${id}`);

export const searchCatalog = (query: string) =>
  api.get<ApiResponse<CatalogItem[]>>('/marketplace/catalog/search', { params: { q: query } });

// --- Sync (admin) ---

export const triggerSync = () =>
  api.post<ApiResponse<{ message: string }>>('/marketplace/sync');

export const getSyncStatus = () =>
  api.get<ApiResponse<SyncStatus>>('/marketplace/sync/status');

export const resumeSync = () =>
  api.patch<ApiResponse<{ message: string }>>('/marketplace/sync/resume');

export const getNotifications = (since?: string) =>
  api.get<ApiResponse<{ count: number; notifications: unknown[] }>>('/marketplace/sync/notifications', { params: { since } });

// --- Install ---

export const installItem = (catalogItemId: number) =>
  api.post<ApiResponse<Installation>>('/marketplace/install', { catalogItemId });

export const uninstallItem = (id: number) =>
  api.delete<ApiResponse<null>>(`/marketplace/install/${id}`);

export const getMyInstallations = (params?: { page?: number; limit?: number }) =>
  api.get<ApiResponse<Installation[]>>('/marketplace/install', { params });

export const getInstallation = (id: number) =>
  api.get<ApiResponse<Installation>>(`/marketplace/install/${id}`);

// --- Approvals (admin) ---

export const getPendingApprovals = (params?: { page?: number; limit?: number }) =>
  api.get<ApiResponse<ApprovalRequest[]>>('/marketplace/approvals', { params });

export const approveRequest = (id: number, notes?: string) =>
  api.post<ApiResponse<ApprovalRequest>>(`/marketplace/approvals/${id}/approve`, { notes });

export const rejectRequest = (id: number, notes: string) =>
  api.post<ApiResponse<ApprovalRequest>>(`/marketplace/approvals/${id}/reject`, { notes });

// --- KB ---

export const indexDocument = (installationId: number, documentName: string, content: string) =>
  api.post<ApiResponse<KBDocument>>(`/marketplace/kb/${installationId}/documents`, { documentName, content });

export const listDocuments = (installationId: number) =>
  api.get<ApiResponse<KBDocument[]>>(`/marketplace/kb/${installationId}/documents`);

export const removeDocument = (docId: number) =>
  api.delete<ApiResponse<null>>(`/marketplace/kb/documents/${docId}`);

export const searchKB = (installationId: number, query: string, limit?: number) =>
  api.post<ApiResponse<unknown[]>>(`/marketplace/kb/${installationId}/search`, { query, limit });
