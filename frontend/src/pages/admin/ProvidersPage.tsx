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
  Key,
  LogIn,
  Trash2,
  ExternalLink,
  Copy
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

interface OAuthStatus {
  configured: boolean;
  hasApiKey: boolean;
  hasOAuthToken: boolean;
  preferOAuth: boolean;
}

interface OAuthInitResponse {
  authUrl: string;
  state: string;
  instructions: string;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Claude Pro OAuth state
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus | null>(null);
  const [oauthLoading, setOAuthLoading] = useState(false);
  const [oauthData, setOAuthData] = useState<OAuthInitResponse | null>(null);
  const [oauthCode, setOAuthCode] = useState('');
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');

  useEffect(() => {
    loadProviders();
  }, []);

  // Load OAuth status when Claude Pro OAuth provider is selected
  useEffect(() => {
    if (selectedProvider?.name === 'anthropic_oauth') {
      loadOAuthStatus();
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

  // Claude Pro OAuth functions
  const loadOAuthStatus = async () => {
    try {
      const response = await api.get('/admin/providers/anthropic/oauth/status');
      setOAuthStatus(response.data);
    } catch (err) {
      console.error('Failed to load OAuth status:', err);
    }
  };

  const initOAuth = async () => {
    setOAuthLoading(true);
    setOAuthError(null);
    setOAuthData(null);
    try {
      const response = await api.post('/admin/providers/anthropic/oauth/init');
      setOAuthData(response.data);
      // Open the auth URL in a new tab
      window.open(response.data.authUrl, '_blank');
    } catch (err: any) {
      setOAuthError(err.response?.data?.error || 'Failed to initialize OAuth');
    } finally {
      setOAuthLoading(false);
    }
  };

  const completeOAuth = async () => {
    if (!oauthCode.trim() || !oauthData?.state) {
      setOAuthError('Please enter the authorization code');
      return;
    }
    setOAuthLoading(true);
    setOAuthError(null);
    try {
      await api.post('/admin/providers/anthropic/oauth/complete', {
        code: oauthCode.trim(),
        state: oauthData.state
      });
      setOAuthData(null);
      setOAuthCode('');
      await loadOAuthStatus();
      setTestResult({ success: true, message: 'Claude Pro OAuth configured successfully!' });
    } catch (err: any) {
      setOAuthError(err.response?.data?.error || 'Failed to complete OAuth');
    } finally {
      setOAuthLoading(false);
    }
  };

  const removeOAuth = async () => {
    if (!confirm('Remove Claude Pro OAuth token? You will need to reconfigure it.')) return;
    setOAuthLoading(true);
    try {
      await api.delete('/admin/providers/anthropic/oauth');
      await loadOAuthStatus();
      setTestResult({ success: true, message: 'OAuth token removed' });
    } catch (err: any) {
      setOAuthError(err.response?.data?.error || 'Failed to remove OAuth');
    } finally {
      setOAuthLoading(false);
    }
  };

  const submitManualToken = async () => {
    if (!manualToken.trim()) {
      setOAuthError('Please enter the access token');
      return;
    }
    setOAuthLoading(true);
    setOAuthError(null);
    try {
      await api.post('/admin/providers/anthropic/oauth/token', {
        accessToken: manualToken.trim(),
        refreshToken: manualRefreshToken.trim() || undefined
      });
      setManualToken('');
      setManualRefreshToken('');
      setShowManualToken(false);
      await loadOAuthStatus();
      setTestResult({ success: true, message: 'Claude Pro OAuth token configurato con successo!' });
    } catch (err: any) {
      setOAuthError(err.response?.data?.error || 'Failed to set token');
    } finally {
      setOAuthLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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

              {/* Claude Pro OAuth Section (only for anthropic_oauth provider) */}
              {selectedProvider.name === 'anthropic_oauth' && (
                <div className="mb-6 p-4 bg-gradient-to-r from-purple-900/20 to-blue-900/20 rounded-lg border border-purple-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <LogIn className="w-5 h-5 text-purple-400" />
                    <h3 className="font-semibold text-purple-300">Configurazione OAuth Token</h3>
                    {oauthStatus?.hasOAuthToken && (
                      <span className="ml-auto px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Configurato
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-surface-400 mb-4">
                    Usa la tua subscription Claude Pro/Max. Gli utenti usano Claude senza bisogno di API key propria.
                  </p>

                  {oauthError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg mb-4 bg-red-900/20 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4" />
                      {oauthError}
                    </div>
                  )}

                  {oauthStatus?.hasOAuthToken ? (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowManualToken(true)}
                        disabled={oauthLoading}
                        className="btn btn-secondary flex items-center gap-2"
                      >
                        <RefreshCw className={clsx('w-4 h-4', oauthLoading && 'animate-spin')} />
                        Reconfigure
                      </button>
                      <button
                        onClick={removeOAuth}
                        disabled={oauthLoading}
                        className="btn bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Remove
                      </button>
                    </div>
                  ) : !showManualToken && !oauthData ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowManualToken(true)}
                          disabled={oauthLoading}
                          className="btn bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2"
                        >
                          <Key className="w-4 h-4" />
                          Inserisci Token Manualmente
                        </button>
                        <span className="text-surface-500 text-xs">oppure</span>
                        <button
                          onClick={initOAuth}
                          disabled={oauthLoading}
                          className="btn btn-secondary flex items-center gap-2"
                        >
                          <LogIn className={clsx('w-4 h-4', oauthLoading && 'animate-spin')} />
                          Usa Browser OAuth
                        </button>
                      </div>
                      <p className="text-xs text-surface-500">
                        Raccomandiamo l'inserimento manuale del token ottenuto da <code className="bg-surface-700 px-1 rounded">claude login</code>
                      </p>
                    </div>
                  ) : oauthData ? (
                    <div className="space-y-3">
                      <div className="p-3 bg-surface-800 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-surface-400">URL di autorizzazione:</span>
                          <button
                            onClick={() => copyToClipboard(oauthData.authUrl)}
                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" /> Copia URL
                          </button>
                        </div>
                        <input
                          type="text"
                          readOnly
                          value={oauthData.authUrl}
                          className="input w-full text-xs font-mono bg-surface-900"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                      </div>

                      <div className="p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg">
                        <p className="text-xs text-amber-300 mb-2">
                          <strong>Nota:</strong> Dopo aver cliccato "Autorizza" su claude.ai, verrai reindirizzato a una pagina.
                          Copia il parametro <code className="bg-surface-700 px-1 rounded">code=...</code> dalla URL del browser.
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={oauthCode}
                          onChange={(e) => setOAuthCode(e.target.value)}
                          placeholder="Incolla il code qui..."
                          className="input flex-1"
                        />
                        <button
                          onClick={completeOAuth}
                          disabled={oauthLoading || !oauthCode.trim()}
                          className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Completa
                        </button>
                      </div>

                      <div className="flex items-center gap-3">
                        <a
                          href={oauthData.authUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> Apri pagina autorizzazione
                        </a>
                        <button
                          onClick={() => { setOAuthData(null); setOAuthCode(''); }}
                          className="text-xs text-surface-400 hover:text-surface-300"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-3 bg-surface-800 rounded-lg">
                        <p className="text-xs text-surface-400 mb-2">
                          <strong className="text-purple-300">Come ottenere il token:</strong>
                        </p>
                        <ol className="text-xs text-surface-400 list-decimal list-inside space-y-1">
                          <li>Installa Claude Code CLI: <code className="bg-surface-700 px-1 rounded">npm install -g @anthropic-ai/claude-code</code></li>
                          <li>Esegui: <code className="bg-surface-700 px-1 rounded">claude login</code></li>
                          <li>Completa l'autorizzazione nel browser</li>
                          <li>Copia il token da: <code className="bg-surface-700 px-1 rounded">~/.claude/credentials.json</code></li>
                          <li>Incolla il campo <code className="bg-surface-700 px-1 rounded">accessToken</code> qui sotto</li>
                        </ol>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-surface-400">Access Token *</label>
                        <input
                          type="password"
                          value={manualToken}
                          onChange={(e) => setManualToken(e.target.value)}
                          placeholder="sk-ant-oat01-..."
                          className="input w-full font-mono text-sm"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-surface-400">Refresh Token (opzionale, per auto-rinnovo)</label>
                        <input
                          type="password"
                          value={manualRefreshToken}
                          onChange={(e) => setManualRefreshToken(e.target.value)}
                          placeholder="anthropic-refresh-..."
                          className="input w-full font-mono text-sm"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={submitManualToken}
                          disabled={oauthLoading || !manualToken.trim()}
                          className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                        >
                          {oauthLoading ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                          Salva Token
                        </button>
                        <button
                          onClick={() => { setShowManualToken(false); setManualToken(''); setManualRefreshToken(''); setOAuthError(null); }}
                          className="btn btn-secondary"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Settings Form for all providers except anthropic_oauth */}
              {selectedProvider.name !== 'anthropic_oauth' && (
                <DynamicForm
                  schema={selectedProvider.config_schema}
                  initialValues={selectedProvider.settings || {}}
                  onSubmit={saveSettings}
                  submitLabel="Salva Configurazione"
                  loading={saving}
                />
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
