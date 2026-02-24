import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Database,
  RefreshCw,
  Trash2,
  Search,
  Globe,
  AlertCircle,
  CheckCircle,
  Settings,
  BarChart3,
  FileText,
  Link as LinkIcon,
  Upload
} from 'lucide-react';

interface CollectionInfo {
  name: string;
  points_count: number;
  status: string;
}

interface RecallSettings {
  autoRagEnabled: boolean;
  episodicK: number;
  episodicThreshold: number;
  declarativeK: number;
  declarativeThreshold: number;
  proceduralK: number;
  proceduralThreshold: number;
}

interface RecallResult {
  id: string | number;
  collection: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

interface IngestionItem {
  id: number;
  url: string;
  title: string;
  status: string;
  chunks_count: number;
  content_length: number;
  error: string | null;
  created_at: string;
}

type TabType = 'collections' | 'recall' | 'ingest' | 'settings';

export default function VectorMemoryPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('collections');
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [recallSettings, setRecallSettings] = useState<RecallSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Recall state
  const [recallQuery, setRecallQuery] = useState('');
  const [recallResults, setRecallResults] = useState<{ episodic: RecallResult[]; declarative: RecallResult[]; procedural: RecallResult[] } | null>(null);
  const [recalling, setRecalling] = useState(false);

  // Ingest state
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestionHistory, setIngestionHistory] = useState<IngestionItem[]>([]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/vector/collections', { headers });
      const data = await res.json();
      setCollections(data.collections || []);
    } catch { /* empty */ }
  }, [token]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/vector/recall-settings', { headers });
      const data = await res.json();
      setRecallSettings(data.settings ?? data);
    } catch { /* empty */ }
  }, [token]);

  const fetchIngestionHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/ingestion/history?limit=50', { headers });
      const data = await res.json();
      setIngestionHistory(Array.isArray(data) ? data : []);
    } catch { /* empty */ }
  }, [token]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchCollections(), fetchSettings()]);
      setLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    if (activeTab === 'ingest') fetchIngestionHistory();
  }, [activeTab]);

  const handleWipe = async (name: string) => {
    if (!confirm(`Are you sure you want to wipe the "${name}" collection? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/memory/vector/collections/${name}`, { method: 'DELETE', headers });
      if (res.ok) {
        showNotification('success', `Collection "${name}" wiped`);
        fetchCollections();
      } else {
        showNotification('error', 'Failed to wipe collection');
      }
    } catch {
      showNotification('error', 'Network error');
    }
  };

  const handleRecall = async () => {
    if (!recallQuery.trim()) return;
    setRecalling(true);
    try {
      const res = await fetch(`/api/memory/vector/recall?text=${encodeURIComponent(recallQuery)}`, { headers });
      const data = await res.json();
      setRecallResults(data.results ?? data);
    } catch {
      showNotification('error', 'Recall failed');
    } finally {
      setRecalling(false);
    }
  };

  const handleIngest = async () => {
    if (!ingestUrl.trim()) return;
    setIngesting(true);
    try {
      const res = await fetch('/api/ingestion/url', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: ingestUrl }),
      });
      const data = await res.json();
      if (data.status === 'completed') {
        showNotification('success', `Ingested ${data.chunksCount} chunks from "${data.title}"`);
        setIngestUrl('');
        fetchIngestionHistory();
        fetchCollections();
      } else {
        showNotification('error', data.error || 'Ingestion failed');
      }
    } catch {
      showNotification('error', 'Network error');
    } finally {
      setIngesting(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<RecallSettings>) => {
    try {
      const res = await fetch('/api/memory/vector/recall-settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setRecallSettings(data.settings ?? data);
        showNotification('success', 'Settings updated');
      }
    } catch {
      showNotification('error', 'Failed to update settings');
    }
  };

  const tabs = [
    { id: 'collections' as TabType, label: 'Collections', icon: Database },
    { id: 'recall' as TabType, label: 'Test Recall', icon: Search },
    { id: 'ingest' as TabType, label: 'URL Ingest', icon: Globe },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-8 h-8 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold">Vector Memory</h1>
            <p className="text-sm text-surface-500">Episodic, declarative, and procedural memory collections</p>
          </div>
        </div>
        <button onClick={fetchCollections} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                : 'text-surface-500 hover:text-surface-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Collections Tab */}
      {activeTab === 'collections' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {collections.map(c => (
            <div key={c.name} className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-mono text-sm font-medium">{c.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  c.status === 'green' || c.status === 'ok'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : c.status === 'not_created'
                    ? 'bg-surface-100 text-surface-500'
                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                }`}>
                  {c.status}
                </span>
              </div>
              <p className="text-3xl font-bold mb-1">{c.points_count.toLocaleString()}</p>
              <p className="text-sm text-surface-500">vectors stored</p>
              <button
                onClick={() => handleWipe(c.name)}
                disabled={c.points_count === 0}
                className="mt-4 flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg disabled:opacity-30"
              >
                <Trash2 className="w-4 h-4" /> Wipe Collection
              </button>
            </div>
          ))}
          {collections.length === 0 && (
            <div className="col-span-3 text-center py-12 text-surface-500">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No collections found. Qdrant may not be running.</p>
            </div>
          )}
        </div>
      )}

      {/* Recall Tab */}
      {activeTab === 'recall' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
              <input
                type="text"
                placeholder="Test vector recall query..."
                value={recallQuery}
                onChange={e => setRecallQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRecall()}
                className="input pl-10"
              />
            </div>
            <button
              onClick={handleRecall}
              disabled={recalling || !recallQuery.trim()}
              className="btn-primary px-4 py-2 disabled:opacity-50"
            >
              {recalling ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </div>

          {recallResults && (
            <div className="space-y-4">
              {(['episodic', 'declarative', 'procedural'] as const).map(collection => {
                const results = recallResults[collection];
                if (results.length === 0) return null;
                return (
                  <div key={collection}>
                    <h3 className="font-medium mb-2 capitalize">{collection} ({results.length})</h3>
                    <div className="space-y-2">
                      {results.map((r, i) => (
                        <div key={i} className="card p-3 text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-xs text-surface-500">score: {r.score.toFixed(3)}</span>
                            {r.metadata.source && (
                              <span className="text-xs text-surface-500">{r.metadata.source}</span>
                            )}
                          </div>
                          <p className="text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{r.content.substring(0, 400)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Ingest Tab */}
      {activeTab === 'ingest' && (
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="font-medium mb-3">Ingest URL into Declarative Memory</h3>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                <input
                  type="url"
                  placeholder="https://example.com/article"
                  value={ingestUrl}
                  onChange={e => setIngestUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleIngest()}
                  className="input pl-10"
                />
              </div>
              <button
                onClick={handleIngest}
                disabled={ingesting || !ingestUrl.trim()}
                className="btn-primary px-4 py-2 disabled:opacity-50 flex items-center gap-2"
              >
                {ingesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Ingest
              </button>
            </div>
            <p className="text-xs text-surface-500 mt-2">
              The URL will be scraped, chunked, and stored as declarative memory vectors.
            </p>
          </div>

          {/* History */}
          <div>
            <h3 className="font-medium mb-3">Ingestion History</h3>
            {ingestionHistory.length === 0 ? (
              <p className="text-surface-500 text-sm">No ingestions yet.</p>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-surface-500 bg-surface-50 dark:bg-surface-900">
                      <th className="px-4 py-2 font-medium">URL</th>
                      <th className="px-4 py-2 font-medium">Title</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Chunks</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingestionHistory.map(item => (
                      <tr key={item.id} className="border-t border-surface-100 dark:border-surface-800">
                        <td className="px-4 py-2 max-w-[200px] truncate font-mono text-xs">{item.url}</td>
                        <td className="px-4 py-2 max-w-[150px] truncate">{item.title || '-'}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            item.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                            item.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                            'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">{item.chunks_count || 0}</td>
                        <td className="px-4 py-2 text-surface-500">{new Date(item.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && recallSettings && (
        <div className="max-w-xl space-y-6">
          <div className="card p-6 space-y-5">
            <h3 className="text-lg font-medium">Auto-RAG Settings</h3>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto-RAG Enabled</p>
                <p className="text-sm text-surface-500">Inject vector memory context on every message</p>
              </div>
              <button
                onClick={() => handleUpdateSettings({ autoRagEnabled: !recallSettings.autoRagEnabled })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  recallSettings.autoRagEnabled ? 'bg-blue-600' : 'bg-surface-300 dark:bg-surface-600'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  recallSettings.autoRagEnabled ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            {(['episodic', 'declarative', 'procedural'] as const).map(collection => {
              const kKey = `${collection}K` as keyof RecallSettings;
              const tKey = `${collection}Threshold` as keyof RecallSettings;
              return (
                <div key={collection} className="border-t border-surface-200 dark:border-surface-700 pt-4">
                  <h4 className="font-medium capitalize mb-3">{collection} Memory</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-surface-500">Top-K results</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={recallSettings[kKey] as number}
                        onChange={e => handleUpdateSettings({ [kKey]: parseInt(e.target.value) || 3 })}
                        className="input mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-surface-500">Score threshold</label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={recallSettings[tKey] as number}
                        onChange={e => handleUpdateSettings({ [tKey]: parseFloat(e.target.value) || 0.7 })}
                        className="input mt-1"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
