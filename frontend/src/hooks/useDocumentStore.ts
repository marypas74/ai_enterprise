import { create } from 'zustand';
import { api } from '../services/api';

export interface UserDocument {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    status: 'processing' | 'ready' | 'failed';
    error?: string;
    chunksCount: number;
    createdAt: string;
}

export type ChatMode = 'free' | 'rag';

interface DocumentStore {
    documents: UserDocument[];
    isLoading: boolean;
    isUploading: boolean;
    uploadError: string | null;
    chatMode: ChatMode;
    selectedDocumentIds: number[];

    fetchDocuments: () => Promise<void>;
    uploadDocument: (file: File) => Promise<UserDocument | null>;
    deleteDocument: (id: number) => Promise<void>;
    refreshDocumentStatus: (id: number) => Promise<void>;
    setChatMode: (mode: ChatMode) => void;
    toggleDocumentId: (id: number) => void;
    selectAllDocuments: () => void;
    clearSelection: () => void;
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
    documents: [],
    isLoading: false,
    isUploading: false,
    uploadError: null,
    chatMode: 'free',
    selectedDocumentIds: [],

    fetchDocuments: async () => {
        set({ isLoading: true });
        try {
            const res = await api.get('/documents');
            set({ documents: res.data.documents || [], isLoading: false });
        } catch {
            set({ isLoading: false });
        }
    },

    uploadDocument: async (file: File) => {
        set({ isUploading: true, uploadError: null });
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await api.post('/documents/upload', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const doc: UserDocument = res.data.document;
            set(state => ({ documents: [doc, ...state.documents], isUploading: false }));

            // Poll for status until it leaves 'processing'
            pollDocumentStatus(get, set, doc.id, 0);

            return doc;
        } catch (err: any) {
            const msg = err.response?.data?.error || 'Upload failed';
            set({ isUploading: false, uploadError: msg });
            return null;
        }
    },

    deleteDocument: async (id: number) => {
        try {
            await api.delete(`/documents/${id}`);
            set(state => ({
                documents: state.documents.filter(d => d.id !== id),
                selectedDocumentIds: state.selectedDocumentIds.filter(x => x !== id),
            }));
        } catch (err: any) {
            console.error('[DocumentStore] Delete error:', err.message);
        }
    },

    refreshDocumentStatus: async (id: number) => {
        try {
            const res = await api.get(`/documents/${id}`);
            const updated: UserDocument = res.data.document;
            set(state => ({
                documents: state.documents.map(d => d.id === id ? { ...d, ...updated } : d),
            }));
        } catch { /* ignore */ }
    },

    setChatMode: (mode: ChatMode) => set({ chatMode: mode }),

    toggleDocumentId: (id: number) =>
        set(state => ({
            selectedDocumentIds: state.selectedDocumentIds.includes(id)
                ? state.selectedDocumentIds.filter(x => x !== id)
                : [...state.selectedDocumentIds, id],
        })),

    selectAllDocuments: () =>
        set(state => ({
            selectedDocumentIds: state.documents.filter(d => d.status === 'ready').map(d => d.id),
        })),

    clearSelection: () => set({ selectedDocumentIds: [] }),
}));

// Internal polling helper — outside the store interface to avoid type pollution
function pollDocumentStatus(
    get: () => DocumentStore,
    set: (partial: Partial<DocumentStore>) => void,
    id: number,
    attempts: number
) {
    if (attempts > 60) return;
    setTimeout(async () => {
        try {
            const res = await api.get(`/documents/${id}`);
            const updated: UserDocument = res.data.document;
            set({
                documents: get().documents.map(d => d.id === id ? { ...d, ...updated } : d),
            });
            if (updated.status === 'processing') {
                pollDocumentStatus(get, set, id, attempts + 1);
            }
        } catch { /* ignore */ }
    }, 2000);
}
