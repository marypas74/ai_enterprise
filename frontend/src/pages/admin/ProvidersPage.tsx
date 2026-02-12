import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import DynamicForm from '../../components/DynamicForm';
import {
  Settings,
  Check,
  X,
  Play,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Cloud,
  Server,
  Trash2,
  Download,
  HardDrive,
  Cpu,
  Box,
  StopCircle
} from 'lucide-react';
import clsx from 'clsx';

interface Provider {
  id: number;
  name: string;
  display_name: string;
  provider_type: string;
  is_enabled: boolean;
  is_local: boolean;
  config_schema: any;
  settings?: Record<string, any>;
}

interface OllamaDockerStatus {
  running: boolean;
  containerId?: string;
  port?: number;
  models?: string[];
  gpuEnabled?: boolean;
  memoryLimit?: string;
}

interface AvailableModel {
  name: string;
  description: string;
  size: string;
  parameters: string;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Ollama Docker state
  const [ollamaDockerStatus, setOllamaDockerStatus] = useState<OllamaDockerStatus | null>(null);
  const [ollamaDockerLoading, setOllamaDockerLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [showDockerConfig, setShowDockerConfig] = useState(false);
  const [dockerConfig, setDockerConfig] = useState({
    port: 11434,
    enableGpu: false,
    memoryLimit: '8g',
    initialModels: [] as string[]
  });
  const [pullingModel, setPullingModel] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  // Load Ollama Docker status when Ollama provider is selected
  useEffect(() => {
    if (selectedProvider?.name === 'ollama') {
      loadOllamaDockerStatus();
      loadAvailableModels();
    }
  }, [selectedProvider]);

  const loadProviders = async () => {
    try {
      const response = await api.get('/admin/providers');
      setProviders(response.data);
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadProviderDetails = async (id: number) => {
    try {
      const response = await api.get(`/admin/providers/${id}`);
      setSelectedProvider(response.data);
      setTestResult(null);
    } catch (err) {
      console.error('Failed to load provider details:', err);
    }
  };

  const toggleProvider = async (id: number, enabled: boolean) => {
    try {
      await api.patch(`/admin/providers/${id}`, { is_enabled: enabled });
      setProviders(prev =>
        prev.map(p => p.id === id ? { ...p, is_enabled: enabled } : p)
      );
    } catch (err) {
      console.error('Failed to toggle provider:', err);
    }
  };

  const saveSettings = async (values: Record<string, any>) => {
    if (!selectedProvider) return;
    setSaving(true);
    try {
      await api.put(`/admin/providers/${selectedProvider.id}/settings`, values);
      setTestResult({ success: true, message: 'Settings saved successfully' });
    } catch (err) {
      console.error('Failed to save settings:', err);
      setTestResult({ success: false, message: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!selectedProvider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await api.post(`/admin/providers/${selectedProvider.id}/test`);
      setTestResult({ success: response.data.success, message: response.data.message || 'Connection successful' });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || 'Connection failed'
      });
    } finally {
      setTesting(false);
    }
  };

  const syncOllamaModels = async () => {
    setSyncing(true);
    try {
      const response = await api.post('/admin/providers/ollama/sync');
      alert(`Synced ${response.data.models?.length || 0} models from Ollama`);
    } catch (err: any) {
      alert('Failed to sync: ' + (err.response?.data?.error || 'Unknown error'));
    } finally {
      setSyncing(false);
    }
  };

  // Ollama Docker functions
  const loadOllamaDockerStatus = async () => {
    try {
      const response = await api.get('/admin/providers/ollama/docker/status');
      setOllamaDockerStatus(response.data);
    } catch (err) {
      console.error('Failed to load Ollama Docker status:', err);
      setOllamaDockerStatus({ running: false });
    }
  };

  const loadAvailableModels = async () => {
    try {
      const response = await api.get('/admin/providers/ollama/models/available');
      setAvailableModels(response.data.models || []);
    } catch (err) {
      console.error('Failed to load available models:', err);
    }
  };

  const deployOllamaDocker = async () => {
    setOllamaDockerLoading(true);
    try {
      await api.post('/admin/providers/ollama/docker/deploy', dockerConfig);
      setTestResult({ success: true, message: 'Container Ollama avviato con successo!' });
      setShowDockerConfig(false);
      await loadOllamaDockerStatus();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || 'Errore durante il deploy del container'
      });
    } finally {
      setOllamaDockerLoading(false);
    }
  };

  const stopOllamaDocker = async () => {
    if (!confirm('Fermare e rimuovere il container Ollama?')) return;
    setOllamaDockerLoading(true);
    try {
      await api.delete('/admin/providers/ollama/docker/stop');
      setTestResult({ success: true, message: 'Container Ollama fermato' });
      await loadOllamaDockerStatus();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || 'Errore durante lo stop del container'
      });
    } finally {
      setOllamaDockerLoading(false);
    }
  };

  const pullModel = async (modelName: string) => {
    setPullingModel(modelName);
    try {
      await api.post('/admin/providers/ollama/docker/pull-model', { model: modelName });
      setTestResult({ success: true, message: `Modello ${modelName} scaricato con successo!` });
      await loadOllamaDockerStatus();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || `Errore durante il download di ${modelName}`
      });
    } finally {
      setPullingModel(null);
    }
  };

  const getProviderIcon = (type: string) => {
    switch (type) {
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">AI Providers</h1>
          <p className="text-surface-500 mt-1">Configure your AI service providers and their API credentials</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Provider List */}
        <div className="lg:col-span-1 space-y-3">
          {providers.map(provider => (
            <div
              key={provider.id}
              onClick={() => loadProviderDetails(provider.id)}
              className={clsx(
                'card p-4 cursor-pointer transition-all',
                selectedProvider?.id === provider.id
                  ? 'ring-2 ring-primary-500'
                  : 'hover:bg-surface-50 dark:hover:bg-surface-800'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getProviderIcon(provider.provider_type)}</span>
                  <div>
                    <h3 className="font-semibold">{provider.display_name}</h3>
                    <div className="flex items-center gap-2 text-xs text-surface-500">
                      {provider.is_local ? (
                        <><Server className="w-3 h-3" /> Local</>
                      ) : (
                        <><Cloud className="w-3 h-3" /> Cloud</>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleProvider(provider.id, !provider.is_enabled);
                  }}
                  className={clsx(
                    'p-1.5 rounded-full transition-colors',
                    provider.is_enabled
                      ? 'bg-green-100 text-green-600 dark:bg-green-900/30'
                      : 'bg-surface-100 text-surface-400 dark:bg-surface-800'
                  )}
                >
                  {provider.is_enabled ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Provider Settings */}
        <div className="lg:col-span-2">
          {selectedProvider ? (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{getProviderIcon(selectedProvider.provider_type)}</span>
                  <div>
                    <h2 className="text-xl font-bold">{selectedProvider.display_name}</h2>
                    <p className="text-sm text-surface-500">
                      {selectedProvider.is_enabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {selectedProvider.name === 'ollama' && (
                    <button
                      onClick={syncOllamaModels}
                      disabled={syncing}
                      className="btn btn-secondary flex items-center gap-2"
                    >
                      <RefreshCw className={clsx('w-4 h-4', syncing && 'animate-spin')} />
                      Sync Models
                    </button>
                  )}
                  <button
                    onClick={testConnection}
                    disabled={testing}
                    className="btn btn-secondary flex items-center gap-2"
                  >
                    <Play className={clsx('w-4 h-4', testing && 'animate-pulse')} />
                    Test Connection
                  </button>
                </div>
              </div>

              {/* Test Result */}
              {testResult && (
                <div
                  className={clsx(
                    'flex items-center gap-2 p-3 rounded-lg mb-6',
                    testResult.success
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                  )}
                >
                  {testResult.success ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}


              {/* Settings Form for provider configuration */}
              <DynamicForm
                schema={selectedProvider.config_schema}
                initialValues={selectedProvider.settings || {}}
                onSubmit={saveSettings}
                submitLabel="Salva Configurazione"
                loading={saving}
              />

              {/* Ollama Docker Management Section */}
              {selectedProvider.name === 'ollama' && (
                <div className="mt-6 pt-6 border-t border-surface-200 dark:border-surface-700">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Box className="w-5 h-5" />
                    Gestione Container Docker
                  </h3>

                  {/* Docker Status */}
                  <div className="mb-4 p-4 rounded-lg bg-surface-50 dark:bg-surface-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={clsx(
                          'w-3 h-3 rounded-full',
                          ollamaDockerStatus?.running ? 'bg-green-500' : 'bg-surface-400'
                        )} />
                        <span className="font-medium">
                          {ollamaDockerStatus?.running ? 'Container in esecuzione' : 'Container non attivo'}
                        </span>
                      </div>
                      {ollamaDockerStatus?.running ? (
                        <button
                          onClick={stopOllamaDocker}
                          disabled={ollamaDockerLoading}
                          className="btn btn-danger btn-sm flex items-center gap-2"
                        >
                          <StopCircle className="w-4 h-4" />
                          Ferma Container
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowDockerConfig(true)}
                          disabled={ollamaDockerLoading}
                          className="btn btn-primary btn-sm flex items-center gap-2"
                        >
                          <Play className="w-4 h-4" />
                          Avvia Container
                        </button>
                      )}
                    </div>

                    {ollamaDockerStatus?.running && (
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <span className="text-surface-500">Porta:</span>
                          <span className="ml-2 font-mono">{ollamaDockerStatus.port}</span>
                        </div>
                        <div>
                          <span className="text-surface-500">GPU:</span>
                          <span className="ml-2">{ollamaDockerStatus.gpuEnabled ? 'Abilitata' : 'Disabilitata'}</span>
                        </div>
                        <div>
                          <span className="text-surface-500">Memoria:</span>
                          <span className="ml-2 font-mono">{ollamaDockerStatus.memoryLimit}</span>
                        </div>
                        <div>
                          <span className="text-surface-500">Modelli:</span>
                          <span className="ml-2">{ollamaDockerStatus.models?.length || 0}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Docker Config Modal */}
                  {showDockerConfig && (
                    <div className="mb-4 p-4 rounded-lg border border-primary-200 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-800">
                      <h4 className="font-medium mb-4">Configurazione Container</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">Porta</label>
                          <input
                            type="number"
                            value={dockerConfig.port}
                            onChange={(e) => setDockerConfig({ ...dockerConfig, port: parseInt(e.target.value) })}
                            className="input w-full"
                            min={1024}
                            max={65535}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Limite Memoria</label>
                          <select
                            value={dockerConfig.memoryLimit}
                            onChange={(e) => setDockerConfig({ ...dockerConfig, memoryLimit: e.target.value })}
                            className="input w-full"
                          >
                            <option value="4g">4 GB</option>
                            <option value="8g">8 GB</option>
                            <option value="16g">16 GB</option>
                            <option value="32g">32 GB</option>
                            <option value="64g">64 GB</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="enableGpu"
                            checked={dockerConfig.enableGpu}
                            onChange={(e) => setDockerConfig({ ...dockerConfig, enableGpu: e.target.checked })}
                            className="rounded"
                          />
                          <label htmlFor="enableGpu" className="text-sm flex items-center gap-2">
                            <Cpu className="w-4 h-4" />
                            Abilita GPU (NVIDIA)
                          </label>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={deployOllamaDocker}
                          disabled={ollamaDockerLoading}
                          className="btn btn-primary flex items-center gap-2"
                        >
                          {ollamaDockerLoading ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          Avvia
                        </button>
                        <button
                          onClick={() => setShowDockerConfig(false)}
                          className="btn btn-secondary"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Available Models */}
                  {ollamaDockerStatus?.running && availableModels.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-3 flex items-center gap-2">
                        <HardDrive className="w-4 h-4" />
                        Modelli Disponibili
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {availableModels.map((model) => {
                          const isInstalled = ollamaDockerStatus.models?.includes(model.name);
                          const isPulling = pullingModel === model.name;
                          return (
                            <div
                              key={model.name}
                              className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800"
                            >
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {model.name}
                                  {isInstalled && (
                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                  )}
                                </div>
                                <div className="text-xs text-surface-500">
                                  {model.parameters} • {model.size}
                                </div>
                              </div>
                              {!isInstalled && (
                                <button
                                  onClick={() => pullModel(model.name)}
                                  disabled={isPulling || !!pullingModel}
                                  className="btn btn-sm btn-secondary flex items-center gap-1"
                                >
                                  {isPulling ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Download className="w-3 h-3" />
                                  )}
                                  {isPulling ? 'Scaricando...' : 'Scarica'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="card p-12 text-center">
              <Settings className="w-12 h-12 mx-auto text-surface-300 mb-4" />
              <h3 className="text-lg font-medium text-surface-600">Select a Provider</h3>
              <p className="text-surface-500 mt-1">
                Choose a provider from the list to configure its settings
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
