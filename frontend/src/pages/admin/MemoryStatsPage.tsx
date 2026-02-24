import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Database, Brain, BookMarked, Wrench, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';

interface CollectionInfo {
  name: string;
  points_count: number;
  status: string;
}

interface WorkingMemoryStats {
  totalSessions: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  uniqueUsers: number;
}

interface HyDEConfig {
  enabled: boolean;
  maxTokens: number;
  maxQueryLength: number;
}

export default function MemoryStatsPage() {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [wmStats, setWmStats] = useState<WorkingMemoryStats | null>(null);
  const [hydeConfig, setHydeConfig] = useState<HyDEConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [wipeTarget, setWipeTarget] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [colRes, wmRes, hydeRes] = await Promise.all([
        api.get('/vector-memory/collections').catch(() => ({ data: { collections: [] } })),
        api.get('/memory/working-stats').catch(() => ({ data: { stats: null } })),
        api.get('/vector-memory/hyde').catch(() => ({ data: { config: null } })),
      ]);
      setCollections(colRes.data.collections || []);
      setWmStats(wmRes.data.stats || null);
      setHydeConfig(hydeRes.data.config || null);
    } finally {
      setLoading(false);
    }
  };

  const toggleHyDE = async () => {
    if (!hydeConfig) return;
    try {
      const res = await api.patch('/vector-memory/hyde', { enabled: !hydeConfig.enabled });
      setHydeConfig(res.data.config);
    } catch (err) {
      console.error('Failed to toggle HyDE:', err);
    }
  };

  const wipeCollection = async (name: string) => {
    if (!confirm(`Sei sicuro di voler cancellare la collezione "${name}"? Questa azione è irreversibile.`)) return;
    try {
      await api.delete(`/vector-memory/collections/${name}`);
      setWipeTarget(null);
      loadAll();
    } catch (err) {
      console.error('Failed to wipe collection:', err);
    }
  };

  const collectionIcon = (name: string) => {
    if (name.includes('episodic')) return <Brain className="w-5 h-5 text-purple-500" />;
    if (name.includes('declarative')) return <BookMarked className="w-5 h-5 text-blue-500" />;
    if (name.includes('procedural')) return <Wrench className="w-5 h-5 text-orange-500" />;
    return <Database className="w-5 h-5 text-surface-500" />;
  };

  const statusColor = (status: string) => {
    if (status === 'green' || status === 'ok') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    if (status === 'not_created') return 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400';
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  };

  if (loading) {
    return <div className="p-6 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div></div>;
  }

  const totalPoints = collections.reduce((acc, c) => acc + c.points_count, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Statistiche Memoria</h1>
        <button onClick={loadAll} className="btn btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Aggiorna
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
              <Database className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Punti Totali</p>
              <p className="text-2xl font-bold">{totalPoints.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Collezioni</p>
              <p className="text-2xl font-bold">{collections.length}</p>
            </div>
          </div>
        </div>

        {wmStats && (
          <>
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <RefreshCw className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-surface-500">Sessioni Working Memory</p>
                  <p className="text-2xl font-bold">{wmStats.totalSessions}</p>
                  <p className="text-xs text-surface-400">{wmStats.uniqueUsers} utenti</p>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Database className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-surface-500">Token WM (In/Out)</p>
                  <p className="text-2xl font-bold">{(wmStats.totalTokensInput / 1000).toFixed(1)}K</p>
                  <p className="text-xs text-surface-400">{(wmStats.totalTokensOutput / 1000).toFixed(1)}K output</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Vector Collections Table */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Collezioni Vettoriali</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-surface-500 border-b border-surface-200 dark:border-surface-700">
                <th className="pb-3 font-medium">Collezione</th>
                <th className="pb-3 font-medium">Punti</th>
                <th className="pb-3 font-medium">Stato</th>
                <th className="pb-3 font-medium text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((col) => (
                <tr key={col.name} className="border-b border-surface-100 dark:border-surface-800">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {collectionIcon(col.name)}
                      <span className="font-medium">{col.name}</span>
                    </div>
                  </td>
                  <td className="py-3">{col.points_count.toLocaleString()}</td>
                  <td className="py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor(col.status)}`}>
                      {col.status}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {wipeTarget === col.name ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => wipeCollection(col.name)} className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700">
                          Conferma
                        </button>
                        <button onClick={() => setWipeTarget(null)} className="text-xs px-3 py-1 bg-surface-200 dark:bg-surface-700 rounded">
                          Annulla
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setWipeTarget(col.name)} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-red-500" title="Cancella collezione">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {collections.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-surface-500">
                    Nessuna collezione trovata. Qdrant potrebbe non essere disponibile.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* HyDE Configuration */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">HyDE — Hypothetical Document Embeddings</h2>
        <p className="text-sm text-surface-500 mb-4">
          HyDE migliora il recall generando una risposta ipotetica con l'LLM prima della ricerca semantica.
          La risposta ipotetica è più vicina nello spazio degli embedding ai documenti reali rispetto alla domanda breve dell'utente.
        </p>

        {hydeConfig ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Stato</p>
                <p className="text-sm text-surface-500">
                  {hydeConfig.enabled ? 'HyDE è attivo — le query di recall vengono trasformate' : 'HyDE è disattivato — le query vengono usate direttamente'}
                </p>
              </div>
              <button
                onClick={toggleHyDE}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  hydeConfig.enabled
                    ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400'
                }`}
              >
                {hydeConfig.enabled ? 'Attivo' : 'Disattivato'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-surface-500">Max Token</p>
                <p className="font-medium">{hydeConfig.maxTokens}</p>
              </div>
              <div>
                <p className="text-sm text-surface-500">Max Lunghezza Query</p>
                <p className="font-medium">{hydeConfig.maxQueryLength} caratteri</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" />
            <span>Configurazione HyDE non disponibile</span>
          </div>
        )}
      </div>
    </div>
  );
}
