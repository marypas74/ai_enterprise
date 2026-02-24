import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { Activity, Play, Square, Trash2, RefreshCw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface TraceEntry {
  id: number;
  hookName: string;
  type: 'pipe' | 'emit';
  handlerId: string;
  handlerName: string;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: string;
  userId?: number;
  conversationId?: number;
}

interface TraceStats {
  totalExecutions: number;
  totalErrors: number;
  avgDurationMs: number;
  hookBreakdown: Record<string, { count: number; errors: number; avgMs: number }>;
}

export default function HookTracePage() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadTrace();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  useEffect(() => {
    if (enabled) {
      intervalRef.current = setInterval(loadTrace, 3000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [enabled]);

  const loadTrace = async () => {
    try {
      const [statusRes, logRes] = await Promise.all([
        api.get('/admin/hooks/trace'),
        api.get('/admin/hooks/trace/log?limit=200'),
      ]);
      setEnabled(statusRes.data.enabled);
      setStats(statusRes.data.stats);
      setEntries(logRes.data.entries || []);
    } catch (err) {
      console.error('Failed to load trace:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTracing = async () => {
    try {
      const res = await api.post('/admin/hooks/trace/toggle', { enabled: !enabled });
      setEnabled(res.data.enabled);
    } catch (err) {
      console.error('Failed to toggle tracing:', err);
    }
  };

  const clearLog = async () => {
    try {
      await api.delete('/admin/hooks/trace/log');
      setEntries([]);
      setStats(null);
    } catch (err) {
      console.error('Failed to clear log:', err);
    }
  };

  const filtered = filter
    ? entries.filter(e => e.hookName.includes(filter) || e.handlerId.includes(filter) || e.handlerName.includes(filter))
    : entries;

  if (loading) {
    return <div className="p-6 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div></div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-primary-500" />
          <h1 className="text-2xl font-bold">Hook Execution Trace</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTracing} className={`btn flex items-center gap-2 ${enabled ? 'btn-primary' : 'btn-secondary'}`}>
            {enabled ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {enabled ? 'Stop' : 'Start'} Tracing
          </button>
          <button onClick={loadTrace} className="btn btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={clearLog} className="btn btn-secondary flex items-center gap-2 text-red-500">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!enabled && (
        <div className="card p-4 mb-6 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <span className="text-sm">Il tracing è disattivato. Attivalo per registrare le esecuzioni degli hook in tempo reale.</span>
        </div>
      )}

      {/* Stats Cards */}
      {stats && stats.totalExecutions > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="card p-4">
            <p className="text-xs text-surface-500">Esecuzioni Totali</p>
            <p className="text-2xl font-bold">{stats.totalExecutions}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-500">Errori</p>
            <p className="text-2xl font-bold text-red-500">{stats.totalErrors}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-500">Durata Media</p>
            <p className="text-2xl font-bold">{stats.avgDurationMs}ms</p>
          </div>
        </div>
      )}

      {/* Hook Breakdown */}
      {stats && stats.hookBreakdown && Object.keys(stats.hookBreakdown).length > 0 && (
        <div className="card p-4 mb-6">
          <h3 className="text-sm font-semibold mb-3">Breakdown per Hook</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(stats.hookBreakdown)
              .sort(([, a], [, b]) => b.count - a.count)
              .map(([hook, data]) => (
                <button
                  key={hook}
                  onClick={() => setFilter(filter === hook ? '' : hook)}
                  className={`text-left p-2 rounded-lg text-xs transition-colors ${
                    filter === hook
                      ? 'bg-primary-100 dark:bg-primary-900/30 ring-1 ring-primary-300'
                      : 'bg-surface-50 dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700'
                  }`}
                >
                  <p className="font-mono font-medium truncate">{hook}</p>
                  <p className="text-surface-500">{data.count}x | {data.avgMs}ms {data.errors > 0 && <span className="text-red-500">| {data.errors} err</span>}</p>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtra per hook name, handler ID..."
          className="input w-full"
        />
      </div>

      {/* Trace Log Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-50 dark:bg-surface-900">
              <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                <th className="px-3 py-2 font-medium w-8"></th>
                <th className="px-3 py-2 font-medium">Timestamp</th>
                <th className="px-3 py-2 font-medium">Hook</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Handler</th>
                <th className="px-3 py-2 font-medium text-right">Durata</th>
                <th className="px-3 py-2 font-medium">User</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-surface-500 text-sm">
                    {entries.length === 0 ? 'Nessuna esecuzione registrata. Attiva il tracing e interagisci con il sistema.' : 'Nessun risultato per il filtro corrente.'}
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => (
                  <tr key={entry.id} className={`border-b border-surface-100 dark:border-surface-800 text-xs ${!entry.success ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                    <td className="px-3 py-1.5">
                      {entry.success
                        ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-surface-500">
                      {new Date(entry.timestamp).toLocaleTimeString('it-IT', { hour12: false, fractionalSecondDigits: 3 })}
                    </td>
                    <td className="px-3 py-1.5 font-mono font-medium">{entry.hookName}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        entry.type === 'pipe'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      }`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="font-medium">{entry.handlerName}</p>
                      {entry.error && <p className="text-red-500 truncate max-w-[200px]" title={entry.error}>{entry.error}</p>}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      <span className={entry.durationMs > 100 ? 'text-amber-600 font-bold' : ''}>{entry.durationMs}ms</span>
                    </td>
                    <td className="px-3 py-1.5 text-surface-500">
                      {entry.userId ? `u:${entry.userId}` : '-'}
                      {entry.conversationId ? ` c:${entry.conversationId}` : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
