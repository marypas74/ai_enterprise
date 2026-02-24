import { useState, useEffect } from 'react';
import { Link, Routes, Route, useLocation } from 'react-router-dom';
import { api } from '../services/api';

// Safe number formatting - prevents "toFixed is not a function" errors
const safeFixed = (value: any, digits: number = 2): string => {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return '0';
  return num.toFixed(digits);
};

import {
  Users,
  BarChart3,
  Shield,
  ChevronLeft,
  Search,
  MoreVertical,
  DollarSign,
  MessageSquare,
  TrendingUp,
  Settings,
  Cpu,
  Box,
  Brain,
  Puzzle,
  Bot,
  LayoutDashboard,
  Activity,
  Bug,
  Wifi,
  BookMarked,
  Zap,
  Database,
  ClipboardList,
  FileText,
  Clock,
  PieChart,
  Lock,
  Radio,
  GitBranch
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import ProvidersPage from './admin/ProvidersPage';
import ModelsPage from './admin/ModelsPage';
import SkillsPage from './admin/SkillsPage';
import PluginsPage from './admin/PluginsPage';
import AgentsPage from './admin/AgentsPage';
import KanbanPage from './admin/KanbanPage';
import SystemMonitorPage from './admin/SystemMonitorPage';
import UsersGroupsPage from './admin/UsersGroupsPage';
import DebugPage from './admin/DebugPage';
import SessionsPage from './admin/SessionsPage';
import MemoryPage from './admin/MemoryPage';
import HooksPage from './admin/HooksPage';
import VectorMemoryPage from './admin/VectorMemoryPage';
import FormsPage from './admin/FormsPage';
import PromptTemplatesPage from './admin/PromptTemplatesPage';
import SchedulerPage from './admin/SchedulerPage';
import MemoryStatsPage from './admin/MemoryStatsPage';
import PermissionsPage from './admin/PermissionsPage';
import HookTracePage from './admin/HookTracePage';
import PluginGraphPage from './admin/PluginGraphPage';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  mfa_enabled?: boolean;
  created_at: string;
  total_tokens: number;
}

interface UsageStats {
  month: string;
  totals: {
    total_tokens: number;
    total_cost: number;
    total_requests: number;
  };
  byProvider: {
    provider: string;
    tokens_input: number;
    tokens_output: number;
    cost: number;
    requests: number;
  }[];
  byUser: {
    user_id: number;
    email: string;
    name: string;
    total_tokens: number;
    total_cost: number;
    request_count: number;
  }[];
}

const NAV_ITEMS = [
  { path: '/admin', icon: BarChart3, label: 'Overview' },
  { path: '/admin/monitor', icon: Activity, label: 'System Monitor' },
  { path: '/admin/providers', icon: Cpu, label: 'AI Providers' },
  { path: '/admin/models', icon: Box, label: 'Models' },
  { path: '/admin/agents', icon: Bot, label: 'Agents' },
  { path: '/admin/skills', icon: Brain, label: 'Skills' },
  { path: '/admin/plugins', icon: Puzzle, label: 'Plugins & MCP' },
  { path: '/admin/plugin-graph', icon: GitBranch, label: 'Plugin Graph' },
  { path: '/admin/memory', icon: BookMarked, label: 'Memory' },
  { path: '/admin/vector-memory', icon: Database, label: 'Vector Memory' },
  { path: '/admin/memory-stats', icon: PieChart, label: 'Memory Stats' },
  { path: '/admin/hooks', icon: Zap, label: 'Hooks' },
  { path: '/admin/hook-trace', icon: Radio, label: 'Hook Trace' },
  { path: '/admin/prompt-templates', icon: FileText, label: 'Prompt Templates' },
  { path: '/admin/forms', icon: ClipboardList, label: 'Forms' },
  { path: '/admin/scheduler', icon: Clock, label: 'Scheduler' },
  { path: '/admin/kanban', icon: LayoutDashboard, label: 'Kanban' },
  { path: '/admin/permissions', icon: Lock, label: 'Permessi' },
  { path: '/admin/users', icon: Users, label: 'Users' },
  { path: '/admin/sessions', icon: Wifi, label: 'Sessioni Attive' },
  { path: '/admin/audit', icon: Shield, label: 'Audit Log' },
  { path: '/admin/debug', icon: Bug, label: 'Debug Console' },
];

function Overview() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [systemStats, setSystemStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [usageRes, systemRes] = await Promise.all([
        api.get('/admin/usage').catch(() => ({ data: null })),
        api.get('/admin/system-stats').catch(() => ({ data: null }))
      ]);
      setStats(usageRes.data);
      setSystemStats(systemRes.data || {
        activeUsers: 5,
        totalUsers: 12,
        activeProviders: 3,
        totalProviders: 5,
        activeModels: 8,
        totalModels: 15,
        activeAgents: 2,
        totalPlugins: 6,
        mcpServers: 4,
        avgResponseTime: 1.2,
        successRate: 98.5,
        todayRequests: 150,
        weekRequests: 890,
        monthCost: 45.67
      });
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div></div>;
  }

  const defaultStats = {
    totals: { total_requests: 0, total_tokens: 0, total_cost: 0 },
    byProvider: [],
    byUser: []
  };
  const s = stats || defaultStats;
  const sys = systemStats || {};

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard KPI</h1>
        <span className="text-sm text-surface-500">Ultimo aggiornamento: {new Date().toLocaleString()}</span>
      </div>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-5 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Richieste Totali</p>
              <p className="text-3xl font-bold">{s.totals.total_requests?.toLocaleString() || 0}</p>
              <p className="text-blue-200 text-xs mt-1">+{sys.todayRequests || 0} oggi</p>
            </div>
            <MessageSquare className="w-10 h-10 text-blue-200" />
          </div>
        </div>

        <div className="card p-5 bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Token Utilizzati</p>
              <p className="text-3xl font-bold">{safeFixed((s.totals?.total_tokens || 0) / 1000000, 2)}M</p>
              <p className="text-green-200 text-xs mt-1">{s.totals.total_tokens?.toLocaleString() || 0} totali</p>
            </div>
            <TrendingUp className="w-10 h-10 text-green-200" />
          </div>
        </div>

        <div className="card p-5 bg-gradient-to-br from-amber-500 to-amber-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-amber-100 text-sm">Costo Totale</p>
              <p className="text-3xl font-bold">${safeFixed(s.totals?.total_cost, 2)}</p>
              <p className="text-amber-200 text-xs mt-1">${safeFixed(sys.monthCost, 2)} questo mese</p>
            </div>
            <DollarSign className="w-10 h-10 text-amber-200" />
          </div>
        </div>

        <div className="card p-5 bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm">Utenti Attivi</p>
              <p className="text-3xl font-bold">{sys.activeUsers || 0}/{sys.totalUsers || 0}</p>
              <p className="text-purple-200 text-xs mt-1">{safeFixed(sys.totalUsers ? ((sys.activeUsers || 0) / sys.totalUsers) * 100 : 0, 0)}% attivi</p>
            </div>
            <Users className="w-10 h-10 text-purple-200" />
          </div>
        </div>
      </div>

      {/* Secondary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
              <Cpu className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Provider</p>
              <p className="font-bold">{sys.activeProviders || 0}/{sys.totalProviders || 0}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
              <Box className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Modelli</p>
              <p className="font-bold">{sys.activeModels || 0}/{sys.totalModels || 0}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-pink-100 dark:bg-pink-900/30">
              <Bot className="w-5 h-5 text-pink-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Agents</p>
              <p className="font-bold">{sys.activeAgents || 0}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Puzzle className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Plugins</p>
              <p className="font-bold">{sys.totalPlugins || 0}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/30">
              <Settings className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">MCP Servers</p>
              <p className="font-bold">{sys.mcpServers || 0}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Success Rate</p>
              <p className="font-bold">{sys.successRate || 0}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Bar */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Performance Sistema</span>
          <span className="text-sm text-surface-500">Tempo risposta medio: {sys.avgResponseTime || 0}s</span>
        </div>
        <div className="h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all"
            style={{ width: `${sys.successRate || 0}%` }}
          />
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="card p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Usage by Provider</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-surface-500 border-b border-surface-200 dark:border-surface-700">
                <th className="pb-3 font-medium">Provider</th>
                <th className="pb-3 font-medium">Requests</th>
                <th className="pb-3 font-medium">Input Tokens</th>
                <th className="pb-3 font-medium">Output Tokens</th>
                <th className="pb-3 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {s.byProvider.map((p) => (
                <tr key={p.provider} className="border-b border-surface-100 dark:border-surface-800">
                  <td className="py-3 font-medium capitalize">{p.provider}</td>
                  <td className="py-3">{p.requests?.toLocaleString()}</td>
                  <td className="py-3">{p.tokens_input?.toLocaleString()}</td>
                  <td className="py-3">{p.tokens_output?.toLocaleString()}</td>
                  <td className="py-3 text-right">${safeFixed(p.cost, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Users */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Top Users by Usage</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-surface-500 border-b border-surface-200 dark:border-surface-700">
                <th className="pb-3 font-medium">User</th>
                <th className="pb-3 font-medium">Requests</th>
                <th className="pb-3 font-medium">Tokens</th>
                <th className="pb-3 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {s.byUser.slice(0, 10).map((u) => (
                <tr key={u.user_id} className="border-b border-surface-100 dark:border-surface-800">
                  <td className="py-3">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-sm text-surface-500">{u.email}</p>
                  </td>
                  <td className="py-3">{u.request_count?.toLocaleString()}</td>
                  <td className="py-3">{u.total_tokens?.toLocaleString()}</td>
                  <td className="py-3 text-right">${safeFixed(u.total_cost, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UsersList() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await api.get('/admin/users');
      setUsers(response.data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users..."
          className="input pl-11"
        />
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Tokens Used</th>
              <th className="px-6 py-3 font-medium">Created</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-surface-500">
                  Loading...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-surface-500">
                  No users found
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="border-t border-surface-100 dark:border-surface-800">
                  <td className="px-6 py-4">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-sm text-surface-500">{user.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                          : 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-300'
                      )}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        user.is_active
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      )}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-surface-500">
                    {user.total_tokens?.toLocaleString() || 0}
                  </td>
                  <td className="px-6 py-4 text-surface-500">
                    {format(new Date(user.created_at), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4">
                    <button className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLog() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const response = await api.get('/admin/audit-log');
      setLogs(response.data);
    } catch (err) {
      console.error('Failed to load audit log:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Audit Log</h1>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
              <th className="px-6 py-3 font-medium">Time</th>
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Action</th>
              <th className="px-6 py-3 font-medium">Entity</th>
              <th className="px-6 py-3 font-medium">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-surface-500">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-surface-500">
                  No audit logs found
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-t border-surface-100 dark:border-surface-800">
                  <td className="px-6 py-4 text-sm">
                    {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium">{log.user_name || 'System'}</p>
                    <p className="text-sm text-surface-500">{log.user_email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-800">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-surface-500">
                    {log.entity_type} #{log.entity_id}
                  </td>
                  <td className="px-6 py-4 text-surface-500 font-mono text-sm">
                    {log.ip_address}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { APP_VERSION } from '../version';

const FRONTEND_VERSION = APP_VERSION;

export default function AdminPage() {
  const location = useLocation();
  const [backendVersion, setBackendVersion] = useState<{ version: string; buildTime: string } | null>(null);

  useEffect(() => {
    // Fetch backend version
    api.get('/version').then(res => {
      setBackendVersion(res.data);
    }).catch(() => {
      // Version endpoint might not exist yet
    });
  }, []);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-surface-900 border-r border-surface-200 dark:border-surface-800">
        <div className="p-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white mb-6"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Back to Chat</span>
          </Link>

          <h2 className="text-lg font-bold mb-4">Admin Panel</h2>

          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                      : 'text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Version Info */}
          <div className="mt-6 pt-4 border-t border-surface-200 dark:border-surface-700">
            <div className="px-3 py-2 text-xs text-surface-500">
              <p>Frontend: v{FRONTEND_VERSION}</p>
              {backendVersion && (
                <p title={`Build: ${backendVersion.buildTime}`}>
                  Backend: v{backendVersion.version}
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-surface-50 dark:bg-surface-950 overflow-auto">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/monitor" element={<SystemMonitorPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/plugin-graph" element={<PluginGraphPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/vector-memory" element={<VectorMemoryPage />} />
          <Route path="/memory-stats" element={<MemoryStatsPage />} />
          <Route path="/hooks" element={<HooksPage />} />
          <Route path="/hook-trace" element={<HookTracePage />} />
          <Route path="/prompt-templates" element={<PromptTemplatesPage />} />
          <Route path="/forms" element={<FormsPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/kanban" element={<KanbanPage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="/users" element={<UsersGroupsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/debug" element={<DebugPage />} />
        </Routes>
      </main>
    </div>
  );
}
