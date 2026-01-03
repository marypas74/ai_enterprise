import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import {
  Bug,
  Terminal,
  Globe,
  Server,
  Trash2,
  Download,
  Play,
  Pause,
  Filter,
  Search,
  RefreshCw,
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCircle,
  Copy,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff
} from 'lucide-react';
import clsx from 'clsx';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: 'backend' | 'frontend' | 'api';
  message: string;
  details?: any;
  method?: string;
  url?: string;
  status?: number;
  duration?: number;
}

interface ApiRequest {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  requestBody?: any;
  responseBody?: any;
  error?: string;
}

const LEVEL_COLORS = {
  debug: 'text-gray-500 bg-gray-100 dark:bg-gray-900/30',
  info: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
  warn: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30',
  error: 'text-red-600 bg-red-100 dark:bg-red-900/30'
};

const LEVEL_ICONS = {
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle
};

const SOURCE_COLORS = {
  backend: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
  frontend: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30',
  api: 'text-green-600 bg-green-100 dark:bg-green-900/30'
};

// Intercept console for frontend logs
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug
};

export default function DebugPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [apiRequests, setApiRequests] = useState<ApiRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'backend' | 'frontend' | 'api'>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logLimit, setLogLimit] = useState<number>(100);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [backendLogs, setBackendLogs] = useState<any[]>([]);
  const [systemInfo, setSystemInfo] = useState<any>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Generate unique ID
  const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add log entry
  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    if (isPaused) return;

    const newEntry: LogEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date().toISOString()
    };

    setLogs(prev => [...prev.slice(-500), newEntry]); // Keep last 500 logs
  }, [isPaused]);

  // Intercept frontend console
  useEffect(() => {
    const interceptConsole = (level: 'debug' | 'info' | 'warn' | 'error') => {
      return (...args: any[]) => {
        // Call original
        (originalConsole as any)[level](...args);

        // Add to our logs
        addLog({
          level,
          source: 'frontend',
          message: args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(' '),
          details: args.length > 1 ? args : args[0]
        });
      };
    };

    console.log = interceptConsole('info');
    console.info = interceptConsole('info');
    console.warn = interceptConsole('warn');
    console.error = interceptConsole('error');
    console.debug = interceptConsole('debug');

    return () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
    };
  }, [addLog]);

  // Intercept API calls
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (input, init) => {
      const startTime = Date.now();
      const requestId = generateId();
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
      const method = init?.method || 'GET';

      const request: ApiRequest = {
        id: requestId,
        timestamp: new Date().toISOString(),
        method,
        url,
        requestBody: init?.body ? JSON.parse(init.body as string) : undefined
      };

      if (!isPaused) {
        setApiRequests(prev => [...prev.slice(-100), request]);
      }

      try {
        const response = await originalFetch(input, init);
        const duration = Date.now() - startTime;

        // Clone response to read body
        const cloned = response.clone();
        let responseBody;
        try {
          responseBody = await cloned.json();
        } catch {
          responseBody = await cloned.text();
        }

        if (!isPaused) {
          setApiRequests(prev => prev.map(r =>
            r.id === requestId
              ? { ...r, status: response.status, duration, responseBody }
              : r
          ));

          addLog({
            level: response.ok ? 'info' : 'error',
            source: 'api',
            message: `${method} ${url} - ${response.status} (${duration}ms)`,
            method,
            url,
            status: response.status,
            duration,
            details: { request: request.requestBody, response: responseBody }
          });
        }

        return response;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        if (!isPaused) {
          setApiRequests(prev => prev.map(r =>
            r.id === requestId
              ? { ...r, error: error.message, duration }
              : r
          ));

          addLog({
            level: 'error',
            source: 'api',
            message: `${method} ${url} - FAILED: ${error.message}`,
            method,
            url,
            duration,
            details: error
          });
        }

        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [isPaused, addLog]);

  // Connect to backend WebSocket for logs
  useEffect(() => {
    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/debug`;

      try {
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          setWsConnected(true);
          addLog({
            level: 'info',
            source: 'frontend',
            message: 'Connected to backend debug WebSocket'
          });
        };

        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'log') {
              addLog({
                level: data.level || 'info',
                source: 'backend',
                message: data.msg || data.message || JSON.stringify(data),
                details: data
              });
            }
          } catch {
            addLog({
              level: 'debug',
              source: 'backend',
              message: event.data
            });
          }
        };

        wsRef.current.onclose = () => {
          setWsConnected(false);
        };

        wsRef.current.onerror = () => {
          setWsConnected(false);
        };
      } catch (error) {
        console.error('WebSocket connection failed:', error);
      }
    };

    connectWs();

    return () => {
      wsRef.current?.close();
    };
  }, [addLog]);

  // Load backend logs via API
  const loadBackendLogs = async () => {
    try {
      const response = await api.get('/admin/debug/logs');
      setBackendLogs(response.data.logs || []);

      // Add to main logs
      response.data.logs?.forEach((log: any) => {
        addLog({
          level: log.level === 30 ? 'info' : log.level === 40 ? 'warn' : log.level === 50 ? 'error' : 'debug',
          source: 'backend',
          message: log.msg || JSON.stringify(log),
          details: log
        });
      });
    } catch (error: any) {
      addLog({
        level: 'warn',
        source: 'frontend',
        message: `Failed to load backend logs: ${error.message}`
      });
    }
  };

  // Load system info
  const loadSystemInfo = async () => {
    try {
      // Use direct fetch for /health (not through /api prefix)
      const [versionRes, healthRes] = await Promise.all([
        api.get('/version').catch(() => ({ data: null })),
        fetch('/health').then(r => r.json()).catch(() => null)
      ]);

      setSystemInfo({
        version: versionRes.data,
        health: healthRes
      });
    } catch (error) {
      // Silently handle - system info is optional
    }
  };

  useEffect(() => {
    loadSystemInfo();
    loadBackendLogs();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Filter logs and reverse for DESC order (newest first), then apply limit
  const filteredLogs = logs.filter(log => {
    if (activeTab !== 'all' && log.source !== activeTab) return false;
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (searchQuery && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }).slice().reverse().slice(0, logLimit);

  // Toggle expanded log
  const toggleExpanded = (id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    setApiRequests([]);
  };

  // Export logs
  const exportLogs = () => {
    const data = JSON.stringify({ logs, apiRequests, systemInfo }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Bug className="w-6 h-6 text-primary-500" />
          <h1 className="text-2xl font-bold">Debug Console</h1>
          <span className={clsx(
            'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
            wsConnected
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}>
            {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {wsConnected ? 'Live' : 'Disconnected'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={clsx(
              'btn btn-sm',
              isPaused ? 'btn-primary' : 'btn-secondary'
            )}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>

          <button onClick={loadBackendLogs} className="btn btn-sm btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>

          <button onClick={exportLogs} className="btn btn-sm btn-secondary">
            <Download className="w-4 h-4" />
            Export
          </button>

          <button onClick={clearLogs} className="btn btn-sm btn-secondary text-red-600">
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      {/* System Info Bar */}
      {systemInfo && (
        <div className="card p-3 mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-purple-500" />
              <span>Backend: v{systemInfo.version?.version || 'unknown'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-500" />
              <span>Build: {systemInfo.version?.buildTime?.split('T')[0] || 'unknown'}</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Health: {systemInfo.health?.status || 'unknown'}</span>
            </div>
          </div>
          <div className="text-surface-500">
            Logs: {logs.length} | API Calls: {apiRequests.length}
          </div>
        </div>
      )}

      {/* Tabs & Filters */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 bg-surface-100 dark:bg-surface-800 p-1 rounded-lg">
          {[
            { key: 'all', label: 'All', icon: Bug },
            { key: 'backend', label: 'Backend', icon: Server },
            { key: 'frontend', label: 'Frontend', icon: Terminal },
            { key: 'api', label: 'API', icon: Globe }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-white dark:bg-surface-700 shadow-sm'
                  : 'hover:bg-surface-200 dark:hover:bg-surface-700'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="input pl-9 py-1.5 text-sm w-64"
            />
          </div>

          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="input py-1.5 text-sm"
          >
            <option value="all">All Levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>

          <select
            value={logLimit}
            onChange={(e) => setLogLimit(parseInt(e.target.value))}
            className="input py-1.5 text-sm"
          >
            <option value={25}>25 logs</option>
            <option value={50}>50 logs</option>
            <option value={75}>75 logs</option>
            <option value={100}>100 logs</option>
            <option value={150}>150 logs</option>
            <option value={200}>200 logs</option>
            <option value={500}>500 logs</option>
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Logs List */}
      <div className="flex-1 card overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto font-mono text-sm">
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-surface-500">
              <Bug className="w-12 h-12 mb-3 opacity-50" />
              <p>No logs to display</p>
              <p className="text-xs">Logs will appear here as events occur</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-50 dark:bg-surface-800">
                <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 w-24">Time</th>
                  <th className="px-3 py-2 w-20">Level</th>
                  <th className="px-3 py-2 w-24">Source</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const LevelIcon = LEVEL_ICONS[log.level];
                  const isExpanded = expandedLogs.has(log.id);

                  return (
                    <>
                      <tr
                        key={log.id}
                        className={clsx(
                          'border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer',
                          log.level === 'error' && 'bg-red-50 dark:bg-red-900/10'
                        )}
                        onClick={() => log.details && toggleExpanded(log.id)}
                      >
                        <td className="px-3 py-2">
                          {log.details && (
                            isExpanded
                              ? <ChevronDown className="w-4 h-4 text-surface-400" />
                              : <ChevronRight className="w-4 h-4 text-surface-400" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-surface-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                            LEVEL_COLORS[log.level]
                          )}>
                            <LevelIcon className="w-3 h-3" />
                            {log.level}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-xs font-medium',
                            SOURCE_COLORS[log.source]
                          )}>
                            {log.source}
                          </span>
                        </td>
                        <td className="px-3 py-2 truncate max-w-xl">
                          {log.message}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(log.message);
                            }}
                            className="p-1 hover:bg-surface-200 dark:hover:bg-surface-700 rounded"
                            title="Copy message"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && log.details && (
                        <tr key={`${log.id}-details`}>
                          <td colSpan={6} className="px-6 py-3 bg-surface-50 dark:bg-surface-800/50">
                            <pre className="text-xs overflow-auto max-h-64 p-3 bg-surface-900 dark:bg-surface-950 text-green-400 rounded">
                              {typeof log.details === 'string'
                                ? log.details
                                : JSON.stringify(log.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Quick Stats Footer */}
      <div className="mt-4 flex items-center justify-between text-xs text-surface-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            Errors: {logs.filter(l => l.level === 'error').length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            Warnings: {logs.filter(l => l.level === 'warn').length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            Info: {logs.filter(l => l.level === 'info').length}
          </span>
        </div>
        <span>
          Showing {filteredLogs.length} of {logs.length} logs
        </span>
      </div>
    </div>
  );
}
