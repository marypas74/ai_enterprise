import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { useHookPipelineStore } from '../../hooks/useHookPipelineStore';
import {
  GitMerge,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Clock,
  Zap,
  Store,
  Settings
} from 'lucide-react';

interface HookHandler {
  id: string;
  name: string;
  priority: number;
  pluginId?: number;
  enabled: boolean;
  source?: 'system' | 'marketplace';
}

interface HookInfo {
  name: string;
  description: string;
  type: 'pipe' | 'emit';
}

interface TraceEntry {
  id: string;
  hookName: string;
  handler: string;
  timestamp: string;
  duration: number;
  success: boolean;
  error?: string;
}

export default function PipelineVisualizerPage() {
  const { pendingApprovals, fetchPendingApprovals } = useHookPipelineStore();
  const [handlers, setHandlers] = useState<Record<string, HookHandler[]>>({});
  const [availableHooks, setAvailableHooks] = useState<HookInfo[]>([]);
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedHooks, setExpandedHooks] = useState<Set<string>>(new Set());
  const [traceExpanded, setTraceExpanded] = useState(false);

  const fetchHooks = useCallback(async () => {
    try {
      const res = await api.get('/admin/hooks');
      setHandlers(res.data.registered_handlers || {});
      setAvailableHooks(res.data.available_hooks || []);
    } catch (err) {
      console.error('Error fetching hooks:', err);
    }
  }, []);

  const fetchTrace = useCallback(async () => {
    try {
      const res = await api.get('/admin/hooks/trace');
      setTraceEntries(Array.isArray(res.data) ? res.data : res.data.entries || []);
    } catch (err) {
      console.error('Error fetching trace:', err);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchHooks(), fetchTrace(), fetchPendingApprovals()]);
      setLoading(false);
    };
    load();
  }, [fetchHooks, fetchTrace, fetchPendingApprovals]);

  const handleToggleHandler = async (hookName: string, handlerId: string, currentEnabled: boolean) => {
    try {
      await api.patch(`/admin/hooks/${hookName}/handlers/${handlerId}`, { enabled: !currentEnabled });
      await fetchHooks();
    } catch (err) {
      console.error('Error toggling handler:', err);
    }
  };

  const toggleHookExpand = (hookName: string) => {
    const next = new Set(expandedHooks);
    if (next.has(hookName)) {
      next.delete(hookName);
    } else {
      next.add(hookName);
    }
    setExpandedHooks(next);
  };

  const getSourceBadge = (handler: HookHandler) => {
    const isMarketplace = handler.source === 'marketplace' || handler.pluginId != null;
    if (isMarketplace) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
          <Store size={10} />
          Marketplace
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
        <Settings size={10} />
        System
      </span>
    );
  };

  const getHookInfo = (hookName: string): HookInfo | undefined => {
    return availableHooks.find(h => h.name === hookName);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const hookNames = Object.keys(handlers).sort();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <GitMerge size={24} />
            Hook Pipeline
          </h2>
          <p className="text-gray-500 mt-1">
            Visualizza e gestisci i handler registrati per ogni hook point
          </p>
        </div>
        <button
          onClick={async () => {
            setLoading(true);
            await Promise.all([fetchHooks(), fetchTrace()]);
            setLoading(false);
          }}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Aggiorna
        </button>
      </div>

      {/* Pending Approvals Banner */}
      {pendingApprovals.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-yellow-600" size={20} />
            <div>
              <h4 className="font-medium text-yellow-800">
                {pendingApprovals.length} approvazioni in attesa
              </h4>
              <p className="text-sm text-yellow-700 mt-0.5">
                Alcune installazioni marketplace richiedono approvazione prima di essere attivate.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Hook Point Cards */}
      {hookNames.length === 0 ? (
        <div className="flex items-center justify-center h-64 bg-white rounded-lg border-2 border-dashed border-gray-300">
          <div className="text-center">
            <Zap className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Nessun hook registrato</p>
            <p className="text-gray-500 text-sm mt-1">I handler appariranno qui quando saranno registrati</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {hookNames.map(hookName => {
            const hookHandlers = [...(handlers[hookName] || [])].sort(
              (a, b) => a.priority - b.priority
            );
            const hookInfo = getHookInfo(hookName);
            const isExpanded = expandedHooks.has(hookName);

            return (
              <div key={hookName} className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <button
                  onClick={() => toggleHookExpand(hookName)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900">{hookName}</h3>
                      {hookInfo && (
                        <p className="text-sm text-gray-500 mt-0.5">{hookInfo.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {hookInfo && (
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        hookInfo.type === 'pipe'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {hookInfo.type}
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                      {hookHandlers.length} handler{hookHandlers.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t px-4 pb-4">
                    {hookHandlers.length === 0 ? (
                      <p className="text-sm text-gray-500 py-3">Nessun handler registrato</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {hookHandlers.map((handler, index) => (
                          <div
                            key={handler.id}
                            className={`flex items-center justify-between p-3 rounded-lg border ${
                              handler.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                                {index + 1}
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900 text-sm">
                                    {handler.name}
                                  </span>
                                  {getSourceBadge(handler)}
                                </div>
                                <span className="text-xs text-gray-500">
                                  Priority: {handler.priority}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleToggleHandler(hookName, handler.id, handler.enabled)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                handler.enabled ? 'bg-blue-600' : 'bg-gray-200'
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  handler.enabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Trace Log Panel */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <button
          onClick={() => setTraceExpanded(!traceExpanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {traceExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <Clock size={18} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">Trace Log</h3>
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
              {traceEntries.length} esecuzioni recenti
            </span>
          </div>
        </button>

        {traceExpanded && (
          <div className="border-t">
            {traceEntries.length === 0 ? (
              <p className="text-sm text-gray-500 p-4">Nessuna esecuzione recente</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b">
                      <th className="px-4 py-2 font-medium">Timestamp</th>
                      <th className="px-4 py-2 font-medium">Hook</th>
                      <th className="px-4 py-2 font-medium">Handler</th>
                      <th className="px-4 py-2 font-medium">Durata</th>
                      <th className="px-4 py-2 font-medium">Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceEntries.slice(0, 50).map((entry, i) => (
                      <tr key={entry.id || i} className="border-b border-gray-100">
                        <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {entry.hookName}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{entry.handler}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {entry.duration != null ? `${entry.duration}ms` : '-'}
                        </td>
                        <td className="px-4 py-2">
                          {entry.success ? (
                            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                              OK
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full" title={entry.error}>
                              Errore
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
