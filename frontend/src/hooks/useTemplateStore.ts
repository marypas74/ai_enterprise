import { create } from 'zustand';
import { api } from '../services/api';
import type { AgentTemplate } from '../types/index.js';

interface TemplateState {
  templates: AgentTemplate[];
  isLoading: boolean;
  error: string | null;

  fetchTemplates: (category?: string) => Promise<void>;
  createTemplate: (data: Partial<AgentTemplate>) => Promise<void>;
  deleteTemplate: (templateId: number) => Promise<void>;
  clearError: () => void;
}

const templateApi = {
  list: (params?: { category?: string }) => api.get('/agents/templates', { params }),
  create: (data: any) => api.post('/agents/templates', data),
  delete: (id: number) => api.delete(`/agents/templates/${id}`),
};

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  isLoading: false,
  error: null,

  fetchTemplates: async (category) => {
    try {
      const response = await templateApi.list(category ? { category } : undefined);
      set({ templates: response.data });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch templates' });
    }
  },

  createTemplate: async (data) => {
    try {
      await templateApi.create(data);
      await get().fetchTemplates();
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to create template' });
      throw err;
    }
  },

  deleteTemplate: async (templateId) => {
    try {
      await templateApi.delete(templateId);
      set(state => ({
        templates: state.templates.filter(t => t.id !== templateId),
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to delete template' });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
