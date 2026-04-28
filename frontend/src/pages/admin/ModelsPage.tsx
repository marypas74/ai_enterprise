import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  Zap,
  Eye,
  MessageSquare,
  DollarSign
} from 'lucide-react';
import clsx from 'clsx';
import {
  ModelExistsWarning,
  isModelNotFoundOnProvider,
  type ModelNotFoundOnProvider,
} from '../../components/admin/ModelExistsWarning';

interface Model {
  id: number;
  provider_id: number;
  model_id: string;
  display_name: string;
  description: string;
  model_type: string;
  context_window: number;
  max_output_tokens: number;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  supports_streaming: boolean;
  supports_functions: boolean;
  supports_vision: boolean;
  is_enabled: boolean;
  is_default: boolean;
  provider_name: string;
  provider_display_name: string;
  provider_enabled: boolean;
}

interface Provider {
  id: number;
  name: string;
  display_name: string;
  is_enabled: boolean;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [modelExistsWarning, setModelExistsWarning] = useState<{
    payload: ModelNotFoundOnProvider;
    pendingPatch: { id: number; body: Partial<Model> };
  } | null>(null);
  const [forceSave, setForceSave] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [modelsRes, providersRes] = await Promise.all([
        api.get('/admin/models'),
        api.get('/admin/providers')
      ]);
      setModels(modelsRes.data);
      setProviders(providersRes.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleModel = async (id: number, enabled: boolean) => {
    try {
      await api.patch(`/admin/models/${id}`, { is_enabled: enabled });
      setModels(prev =>
        prev.map(m => m.id === id ? { ...m, is_enabled: enabled } : m)
      );
    } catch (err) {
      console.error('Failed to toggle model:', err);
    }
  };

  /**
   * Patch a model with backend-side existence verification.
   * On 422 with MODEL_NOT_FOUND_ON_PROVIDER the warning UI is surfaced and the
   * admin can opt-in to retry with `?force=true`.
   */
  const patchModelSafely = async (
    id: number,
    body: Partial<Model>,
    options: { force?: boolean } = {},
  ): Promise<boolean> => {
    try {
      const url = options.force ? `/admin/models/${id}?force=true` : `/admin/models/${id}`;
      await api.patch(url, body);
      setModels(prev => prev.map(m => (m.id === id ? { ...m, ...body } : m)));
      setModelExistsWarning(null);
      setForceSave(false);
      return true;
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 422 && isModelNotFoundOnProvider(data)) {
        setModelExistsWarning({ payload: data, pendingPatch: { id, body } });
        return false;
      }
      console.error('Failed to update model:', err);
      return false;
    }
  };

  const handleConfirmForce = () => {
    if (!modelExistsWarning) return;
    const { id, body } = modelExistsWarning.pendingPatch;
    void patchModelSafely(id, body, { force: true });
  };

  const deleteModel = async (id: number) => {
    if (!confirm('Are you sure you want to delete this model?')) return;
    try {
      await api.delete(`/admin/models/${id}`);
      setModels(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error('Failed to delete model:', err);
    }
  };

  const filteredModels = models.filter(m => {
    const matchesProvider = selectedProvider === 'all' || m.provider_name === selectedProvider;
    const matchesSearch = m.display_name.toLowerCase().includes(search.toLowerCase()) ||
                          m.model_id.toLowerCase().includes(search.toLowerCase());
    return matchesProvider && matchesSearch;
  });

  const groupedModels = filteredModels.reduce((acc, model) => {
    if (!acc[model.provider_display_name]) {
      acc[model.provider_display_name] = [];
    }
    acc[model.provider_display_name].push(model);
    return acc;
  }, {} as Record<string, Model[]>);

  const getProviderIcon = (name: string) => {
    switch (name) {
      case 'openai': return '🤖';
      case 'anthropic': return '🧠';
      case 'google': return '✨';
      case 'ollama': return '🦙';
      default: return '⚙️';
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold">AI Models</h1>
          <p className="text-surface-500 mt-1">Manage available models and their settings</p>
        </div>
      </div>

      {modelExistsWarning && (
        <div className="mb-4 flex-shrink-0">
          <ModelExistsWarning
            payload={modelExistsWarning.payload}
            forceSave={forceSave}
            onForceSaveChange={setForceSave}
            onConfirm={handleConfirmForce}
            onCancel={() => {
              setModelExistsWarning(null);
              setForceSave(false);
            }}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="input pl-11"
          />
        </div>
        <select
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
          className="input w-48"
        >
          <option value="all">All Providers</option>
          {providers.map(p => (
            <option key={p.id} value={p.name}>{p.display_name}</option>
          ))}
        </select>
      </div>

      {/* Models by Provider */}
      <div className="space-y-8 flex-1 min-h-0 overflow-y-auto">
        {Object.entries(groupedModels).map(([providerName, providerModels]) => (
          <div key={providerName}>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span>{getProviderIcon(providerModels[0]?.provider_name)}</span>
              {providerName}
              <span className="text-sm font-normal text-surface-500">
                ({providerModels.length} models)
              </span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {providerModels.map(model => (
                <div
                  key={model.id}
                  className={clsx(
                    'card p-4 transition-opacity',
                    !model.is_enabled && 'opacity-60'
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{model.display_name}</h3>
                      <p className="text-xs text-surface-500 font-mono">{model.model_id}</p>
                    </div>
                    <button
                      onClick={() => toggleModel(model.id, !model.is_enabled)}
                      className={clsx(
                        'p-1.5 rounded-full transition-colors',
                        model.is_enabled
                          ? 'bg-green-100 text-green-600 dark:bg-green-900/30'
                          : 'bg-surface-100 text-surface-400 dark:bg-surface-800'
                      )}
                    >
                      {model.is_enabled ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {model.description && (
                    <p className="text-sm text-surface-500 mb-3 line-clamp-2">
                      {model.description}
                    </p>
                  )}

                  {/* Capabilities */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {model.supports_streaming && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        <Zap className="w-3 h-3" /> Streaming
                      </span>
                    )}
                    {model.supports_vision && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        <Eye className="w-3 h-3" /> Vision
                      </span>
                    )}
                    {model.supports_functions && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        <MessageSquare className="w-3 h-3" /> Functions
                      </span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-2 text-xs text-surface-500 mb-3">
                    <div>
                      <span className="block text-surface-400">Context</span>
                      <span className="font-medium">{(Number(model.context_window) / 1000).toFixed(0)}K</span>
                    </div>
                    <div>
                      <span className="block text-surface-400">Max Output</span>
                      <span className="font-medium">{(Number(model.max_output_tokens) / 1000).toFixed(0)}K</span>
                    </div>
                  </div>

                  {/* Pricing */}
                  {(model.input_cost_per_1k > 0 || model.output_cost_per_1k > 0) && (
                    <div className="flex items-center gap-2 text-xs text-surface-500 border-t border-surface-100 dark:border-surface-800 pt-3">
                      <DollarSign className="w-3 h-3" />
                      <span>In: ${model.input_cost_per_1k}/1K</span>
                      <span>|</span>
                      <span>Out: ${model.output_cost_per_1k}/1K</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-surface-100 dark:border-surface-800">
                    <button
                      onClick={() => setEditingModel(model)}
                      className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-800 rounded"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteModel(model.id)}
                      className="p-1.5 hover:bg-red-50 text-red-500 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {filteredModels.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-surface-500">No models found</p>
        </div>
      )}
    </div>
  );
}
