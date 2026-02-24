import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Zap,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Info
} from 'lucide-react';

interface HookHandler {
  id: string;
  name: string;
  priority: number;
  pluginId?: number;
  enabled: boolean;
}

interface HookInfo {
  name: string;
  description: string;
  type: 'pipe' | 'emit';
}

export default function HooksPage() {
  const { token } = useAuth();
  const [handlers, setHandlers] = useState<Record<string, HookHandler[]>>({});
  const [availableHooks, setAvailableHooks] = useState<HookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedHooks, setExpandedHooks] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchHooks = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/hooks', { headers });
      const data = await res.json();
      setHandlers(data.registered_handlers || {});
      setAvailableHooks(data.available_hooks || []);
    } catch (err) {
      console.error('Failed to fetch hooks:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchHooks(); }, []);

  const toggleHandler = async (handlerId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/admin/hooks/handlers/${encodeURIComponent(handlerId)}/toggle`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        showNotification('success', `Handler ${enabled ? 'enabled' : 'disabled'}`);
        fetchHooks();
      } else {
        showNotification('error', 'Failed to toggle handler');
      }
    } catch {
      showNotification('error', 'Network error');
    }
  };

  const toggleExpand = (hookName: string) => {
    const next = new Set(expandedHooks);
    if (next.has(hookName)) next.delete(hookName);
    else next.add(hookName);
    setExpandedHooks(next);
  };

  const totalHandlers = Object.values(handlers).reduce((sum, arr) => sum + arr.length, 0);
  const activeHandlers = Object.values(handlers).flat().filter(h => h.enabled).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notification */}
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
          <Zap className="w-8 h-8 text-yellow-400" />
          <div>
            <h1 className="text-2xl font-bold">Pipeline Hooks</h1>
            <p className="text-sm text-surface-500">Event-driven pipeline interception points</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-surface-500">
          <span>{totalHandlers} handlers registered</span>
          <span>{activeHandlers} active</span>
          <button onClick={fetchHooks} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Available Hooks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {availableHooks.map(hook => {
          const hookHandlers = handlers[hook.name] || [];
          const isExpanded = expandedHooks.has(hook.name);
          const hasHandlers = hookHandlers.length > 0;

          return (
            <div
              key={hook.name}
              className={`card p-4 border ${hasHandlers ? 'border-blue-500/30' : 'border-surface-200 dark:border-surface-700'}`}
            >
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => hasHandlers && toggleExpand(hook.name)}
              >
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono ${
                    hook.type === 'pipe'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  }`}>
                    {hook.type}
                  </span>
                  <span className="font-mono text-sm font-medium">{hook.name}</span>
                </div>
                {hasHandlers && (
                  isExpanded
                    ? <ChevronDown className="w-4 h-4 text-surface-400" />
                    : <ChevronRight className="w-4 h-4 text-surface-400" />
                )}
              </div>
              <p className="text-xs text-surface-500 mt-1">{hook.description}</p>
              {hasHandlers && (
                <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                  {hookHandlers.length} handler{hookHandlers.length > 1 ? 's' : ''}
                </span>
              )}

              {/* Expanded handler list */}
              {isExpanded && hookHandlers.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-surface-200 dark:border-surface-700 pt-3">
                  {hookHandlers.map(h => (
                    <div key={h.id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{h.name}</span>
                        <span className="text-xs text-surface-500 ml-2">p:{h.priority}</span>
                        {h.pluginId && <span className="text-xs text-surface-500 ml-2">plugin:{h.pluginId}</span>}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleHandler(h.id, !h.enabled); }}
                        className="flex items-center"
                      >
                        {h.enabled
                          ? <ToggleRight className="w-6 h-6 text-green-500" />
                          : <ToggleLeft className="w-6 h-6 text-surface-400" />
                        }
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="card p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-surface-500">
          <p><strong>Pipe hooks</strong> pass data through each handler sequentially — each can modify the data.</p>
          <p><strong>Emit hooks</strong> fire-and-forget — all handlers run in parallel.</p>
          <p className="mt-1">Handlers are registered by plugins and system modules. Priority determines execution order (lower = first).</p>
        </div>
      </div>
    </div>
  );
}
