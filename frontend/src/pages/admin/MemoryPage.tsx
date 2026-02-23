import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Brain,
  Search,
  Archive,
  Trash2,
  Plus,
  Settings,
  BarChart3,
  Tag,
  Star,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  BookOpen,
  AlertCircle,
  CheckCircle,
  Filter
} from 'lucide-react';

interface Observation {
  id: number;
  user_id: number;
  conversation_id: number | null;
  observation_type: string;
  content: string;
  tags: string[] | null;
  importance: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

interface Summary {
  id: number;
  conversation_id: number;
  summary: string;
  conversation_title?: string;
  tokens_saved: number;
  created_at: string;
}

interface MemorySettings {
  auto_capture: boolean;
  inject_context: boolean;
  max_context_observations: number;
  importance_threshold: number;
  retention_days: number;
}

interface Stats {
  total: number;
  by_type: Record<string, number>;
  archived: number;
  summaries: number;
  avg_importance: number;
  recent_7d: number;
}

type TabType = 'observations' | 'summaries' | 'settings' | 'stats';

const TYPE_COLORS: Record<string, string> = {
  insight: 'bg-blue-500/20 text-blue-400',
  decision: 'bg-purple-500/20 text-purple-400',
  pattern: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  preference: 'bg-yellow-500/20 text-yellow-400',
  fact: 'bg-cyan-500/20 text-cyan-400',
  manual: 'bg-gray-500/20 text-gray-400'
};

const TYPE_OPTIONS = ['insight', 'decision', 'pattern', 'error', 'preference', 'fact', 'manual'];

export default function MemoryPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('observations');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showNewForm, setShowNewForm] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('manual');
  const [newImportance, setNewImportance] = useState(5);
  const [newTags, setNewTags] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchObservations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      params.set('archived', showArchived.toString());
      params.set('limit', '100');

      let url = searchQuery.trim()
        ? `/api/memory/search?q=${encodeURIComponent(searchQuery)}&limit=100`
        : `/api/memory/observations?${params.toString()}`;

      const res = await fetch(url, { headers });
      const data = await res.json();
      setObservations(data.observations || data.results || []);
    } catch (err) {
      console.error('Failed to fetch observations:', err);
    }
  }, [token, searchQuery, filterType, showArchived]);

  const fetchSummaries = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/summaries?limit=50', { headers });
      const data = await res.json();
      setSummaries(data.summaries || []);
    } catch (err) {
      console.error('Failed to fetch summaries:', err);
    }
  }, [token]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/settings', { headers });
      const data = await res.json();
      setSettings(data.settings);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  }, [token]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/stats', { headers });
      const data = await res.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [token]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchObservations(), fetchSettings(), fetchStats()]);
      setLoading(false);
    };
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'observations') fetchObservations();
    else if (activeTab === 'summaries') fetchSummaries();
    else if (activeTab === 'settings') fetchSettings();
    else if (activeTab === 'stats') fetchStats();
  }, [activeTab, searchQuery, filterType, showArchived]);

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    try {
      const res = await fetch('/api/memory/observations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: newContent,
          observation_type: newType,
          importance: newImportance,
          tags: newTags ? newTags.split(',').map(t => t.trim()).filter(Boolean) : undefined
        })
      });
      if (res.ok) {
        showNotification('success', 'Observation saved');
        setNewContent('');
        setNewTags('');
        setShowNewForm(false);
        fetchObservations();
        fetchStats();
      }
    } catch (err) {
      showNotification('error', 'Failed to save observation');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/memory/observations/${id}`, { method: 'DELETE', headers });
      showNotification('success', 'Observation deleted');
      fetchObservations();
      fetchStats();
    } catch (err) {
      showNotification('error', 'Failed to delete');
    }
  };

  const handleBulkAction = async (action: 'archive' | 'delete') => {
    if (selectedIds.size === 0) return;
    try {
      await fetch('/api/memory/observations/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: Array.from(selectedIds), action })
      });
      showNotification('success', `${selectedIds.size} observations ${action}d`);
      setSelectedIds(new Set());
      fetchObservations();
      fetchStats();
    } catch (err) {
      showNotification('error', `Bulk ${action} failed`);
    }
  };

  const handleUpdateSettings = async (updates: Partial<MemorySettings>) => {
    try {
      const res = await fetch('/api/memory/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      setSettings(data.settings);
      showNotification('success', 'Settings updated');
    } catch (err) {
      showNotification('error', 'Failed to update settings');
    }
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === observations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(observations.map(o => o.id)));
    }
  };

  const tabs = [
    { id: 'observations' as TabType, label: 'Observations', icon: Brain, count: stats?.total },
    { id: 'summaries' as TabType, label: 'Summaries', icon: BookOpen, count: stats?.summaries },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
    { id: 'stats' as TabType, label: 'Statistics', icon: BarChart3 }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
          <Brain className="w-8 h-8 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Memory System</h1>
            <p className="text-sm text-gray-400">Persistent cross-session memory observations</p>
          </div>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>{stats.total} observations</span>
            <span>{stats.recent_7d} this week</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-gray-600">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'observations' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search observations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">All Types</option>
              {TYPE_OPTIONS.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded"
              />
              Archived
            </label>
            <button
              onClick={() => setShowNewForm(!showNewForm)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" /> New
            </button>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={() => handleBulkAction('archive')}
                  className="flex items-center gap-1 px-3 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded-lg text-sm"
                >
                  <Archive className="w-4 h-4" /> Archive ({selectedIds.size})
                </button>
                <button
                  onClick={() => handleBulkAction('delete')}
                  className="flex items-center gap-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm"
                >
                  <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
                </button>
              </>
            )}
          </div>

          {/* New Observation Form */}
          {showNewForm && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <textarea
                placeholder="Write your observation..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 min-h-[80px]"
              />
              <div className="flex items-center gap-3">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
                >
                  {TYPE_OPTIONS.map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-400" />
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={newImportance}
                    onChange={(e) => setNewImportance(parseInt(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-sm text-gray-400 w-6">{newImportance}</span>
                </div>
                <input
                  type="text"
                  placeholder="Tags (comma-separated)"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newContent.trim()}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Select All */}
          {observations.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={selectedIds.size === observations.length}
                onChange={toggleSelectAll}
                className="rounded"
              />
              Select all ({observations.length})
            </div>
          )}

          {/* Observation List */}
          {observations.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No observations found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {observations.map(obs => (
                <div
                  key={obs.id}
                  className={`bg-gray-800 border rounded-lg p-4 transition-colors ${
                    selectedIds.has(obs.id) ? 'border-blue-500' : 'border-gray-700'
                  } ${obs.is_archived ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(obs.id)}
                      onChange={() => toggleSelect(obs.id)}
                      className="mt-1 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[obs.observation_type] || TYPE_COLORS.manual}`}>
                          {obs.observation_type}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <Star className="w-3 h-3 text-yellow-400" />
                          <span className="text-xs text-gray-400">{obs.importance}</span>
                        </div>
                        {obs.tags && Array.isArray(obs.tags) && obs.tags.map((tag, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                            <Tag className="w-3 h-3 inline mr-0.5" />{tag}
                          </span>
                        ))}
                        <span className="text-xs text-gray-500 ml-auto">
                          {new Date(obs.created_at).toLocaleDateString()} {new Date(obs.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-gray-200 text-sm whitespace-pre-wrap">{obs.content}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(obs.id)}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'summaries' && (
        <div className="space-y-3">
          {summaries.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No conversation summaries yet</p>
            </div>
          ) : (
            summaries.map(s => (
              <div key={s.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">
                    {s.conversation_title || `Conversation #${s.conversation_id}`}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {s.tokens_saved > 0 && <span>{s.tokens_saved} tokens saved</span>}
                    <span>{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <p className="text-gray-300 text-sm">{s.summary}</p>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'settings' && settings && (
        <div className="max-w-xl space-y-6">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 space-y-5">
            <h3 className="text-lg font-medium text-white">Memory Preferences</h3>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">Auto Capture</p>
                <p className="text-sm text-gray-400">Automatically extract observations from conversations</p>
              </div>
              <button
                onClick={() => handleUpdateSettings({ auto_capture: !settings.auto_capture })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.auto_capture ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.auto_capture ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">Inject Context</p>
                <p className="text-sm text-gray-400">Add memory context to new conversations</p>
              </div>
              <button
                onClick={() => handleUpdateSettings({ inject_context: !settings.inject_context })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.inject_context ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.inject_context ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            <div>
              <label className="text-white font-medium">Max Context Observations</label>
              <p className="text-sm text-gray-400 mb-2">How many observations to inject per session</p>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.max_context_observations}
                onChange={(e) => handleUpdateSettings({ max_context_observations: parseInt(e.target.value) || 10 })}
                className="w-24 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-white"
              />
            </div>

            <div>
              <label className="text-white font-medium">Importance Threshold</label>
              <p className="text-sm text-gray-400 mb-2">Minimum importance for context injection (1-10)</p>
              <input
                type="range"
                min={1}
                max={10}
                value={settings.importance_threshold}
                onChange={(e) => handleUpdateSettings({ importance_threshold: parseInt(e.target.value) })}
                className="w-48"
              />
              <span className="ml-3 text-white">{settings.importance_threshold}</span>
            </div>

            <div>
              <label className="text-white font-medium">Retention Period (days)</label>
              <p className="text-sm text-gray-400 mb-2">Auto-archive observations older than this</p>
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.retention_days}
                onChange={(e) => handleUpdateSettings({ retention_days: parseInt(e.target.value) || 365 })}
                className="w-24 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-white"
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Brain className="w-6 h-6 text-purple-400" />
              <h3 className="text-lg font-medium text-white">Total Observations</h3>
            </div>
            <p className="text-3xl font-bold text-white">{stats.total}</p>
            <p className="text-sm text-gray-400 mt-1">{stats.archived} archived</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              <h3 className="text-lg font-medium text-white">This Week</h3>
            </div>
            <p className="text-3xl font-bold text-white">{stats.recent_7d}</p>
            <p className="text-sm text-gray-400 mt-1">avg importance: {stats.avg_importance}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="w-6 h-6 text-green-400" />
              <h3 className="text-lg font-medium text-white">Summaries</h3>
            </div>
            <p className="text-3xl font-bold text-white">{stats.summaries}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg col-span-full p-6">
            <h3 className="text-lg font-medium text-white mb-4">By Type</h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.by_type).map(([type, count]) => (
                <div
                  key={type}
                  className={`px-4 py-2 rounded-lg ${TYPE_COLORS[type] || TYPE_COLORS.manual}`}
                >
                  <span className="font-medium">{type}</span>
                  <span className="ml-2 text-lg font-bold">{count}</span>
                </div>
              ))}
              {Object.keys(stats.by_type).length === 0 && (
                <p className="text-gray-500">No data yet</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
