import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import DynamicForm from '../../components/DynamicForm';
import { getMyInstallations, type Installation } from '../../services/marketplaceApi';
import {
  Puzzle,
  Server,
  Wrench,
  Plus,
  Edit2,
  Trash2,
  Settings,
  Power,
  Play,
  Search,
  Globe,
  Folder,
  Terminal,
  GitBranch,
  Database,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';

interface Plugin {
  id: number;
  name: string;
  display_name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  icon: string;
  config_schema: any;
  is_system: boolean;
  is_enabled: boolean;
  tool_count?: number;
}

interface MCPServer {
  id: number;
  name: string;
  display_name: string;
  description: string;
  transport_type: string;
  command: string;
  url: string;
  env_vars: Record<string, string>;
  is_enabled: boolean;
}

interface Tool {
  id: number;
  plugin_id: number;
  name: string;
  display_name: string;
  description: string;
  tool_type: string;
  input_schema: any;
  requires_approval: boolean;
  is_enabled: boolean;
  plugin_name?: string;
}

type TabType = 'plugins' | 'mcp' | 'tools';

const CATEGORY_ICONS: Record<string, any> = {
  tools: Wrench,
  integrations: Globe,
  utilities: Settings,
  ai: Server,
  data: Database,
  other: Puzzle
};

const PLUGIN_ICONS: Record<string, any> = {
  search: Search,
  folder: Folder,
  terminal: Terminal,
  'git-branch': GitBranch,
  database: Database,
  globe: Globe,
  default: Puzzle
};

export default function PluginsPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('plugins');
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const [selectedMCP, setSelectedMCP] = useState<MCPServer | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<number>>(new Set());
  const [testingMCP, setTestingMCP] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [mcpApprovalStatus, setMcpApprovalStatus] = useState<Record<string, Installation['status']>>({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchPlugins(), fetchMCPServers(), fetchTools(), fetchMcpMarketplaceStatus()]);
    setLoading(false);
  };

  const fetchMcpMarketplaceStatus = async () => {
    try {
      const response = await getMyInstallations({ limit: 200 });
      const installations: Installation[] = response.data?.data ?? [];
      const statusMap: Record<string, Installation['status']> = {};
      for (const inst of installations) {
        if (inst.catalogItem?.type === 'mcp' && inst.catalogItem.name) {
          statusMap[inst.catalogItem.name] = inst.status;
        }
      }
      setMcpApprovalStatus(statusMap);
    } catch {
      // Marketplace may not be available
    }
  };

  const fetchPlugins = async () => {
    try {
      const response = await fetch('/api/plugins', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setPlugins(await response.json());
      }
    } catch (error) {
      console.error('Error fetching plugins:', error);
    }
  };

  const fetchMCPServers = async () => {
    try {
      const response = await fetch('/api/mcp-servers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setMcpServers(await response.json());
      }
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
    }
  };

  const fetchTools = async () => {
    try {
      const response = await fetch('/api/tools', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setTools(await response.json());
      }
    } catch (error) {
      console.error('Error fetching tools:', error);
    }
  };

  const handleTogglePlugin = async (plugin: Plugin) => {
    if (plugin.is_system) return;

    try {
      const response = await fetch(`/api/plugins/${plugin.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ is_enabled: !plugin.is_enabled })
      });

      if (response.ok) {
        fetchPlugins();
      }
    } catch (error) {
      console.error('Error toggling plugin:', error);
    }
  };

  const handleToggleMCP = async (mcp: MCPServer) => {
    try {
      const response = await fetch(`/api/mcp-servers/${mcp.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ is_enabled: !mcp.is_enabled })
      });

      if (response.ok) {
        fetchMCPServers();
      }
    } catch (error) {
      console.error('Error toggling MCP:', error);
    }
  };

  const handleToggleTool = async (tool: Tool) => {
    try {
      const response = await fetch(`/api/tools/${tool.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ is_enabled: !tool.is_enabled })
      });

      if (response.ok) {
        fetchTools();
      }
    } catch (error) {
      console.error('Error toggling tool:', error);
    }
  };

  const handleTestMCP = async (mcp: MCPServer) => {
    setTestingMCP(mcp.id);
    setTestResult(null);

    try {
      const response = await fetch(`/api/mcp-servers/${mcp.id}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      const result = await response.json();
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: 'Connection error' });
    } finally {
      setTestingMCP(null);
    }
  };

  const handleSavePluginSettings = async (values: Record<string, any>) => {
    if (!selectedPlugin) return;

    try {
      const response = await fetch(`/api/plugins/${selectedPlugin.id}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(values)
      });

      if (response.ok) {
        setShowSettings(false);
        setSelectedPlugin(null);
      }
    } catch (error) {
      console.error('Error saving plugin settings:', error);
    }
  };

  const togglePluginExpand = (id: number) => {
    const newExpanded = new Set(expandedPlugins);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedPlugins(newExpanded);
  };

  const getPluginTools = (pluginId: number) => {
    return tools.filter(t => t.plugin_id === pluginId);
  };

  const tabs = [
    { id: 'plugins' as TabType, label: 'Plugins', icon: Puzzle, count: plugins.length },
    { id: 'mcp' as TabType, label: 'MCP Servers', icon: Server, count: mcpServers.length },
    { id: 'tools' as TabType, label: 'Tools', icon: Wrench, count: tools.length }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Plugins & MCP</h2>
          <p className="text-gray-500 mt-1">Gestisci plugins, MCP servers e tools</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={20} />
                {tab.label}
                <span className="px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Plugins Tab */}
      {activeTab === 'plugins' && (
        <div className="space-y-4">
          {plugins.map(plugin => {
            const Icon = PLUGIN_ICONS[plugin.icon] || PLUGIN_ICONS.default;
            const CategoryIcon = CATEGORY_ICONS[plugin.category] || CATEGORY_ICONS.other;
            const pluginTools = getPluginTools(plugin.id);
            const isExpanded = expandedPlugins.has(plugin.id);

            return (
              <div
                key={plugin.id}
                className={`bg-white rounded-lg shadow-sm border overflow-hidden ${
                  !plugin.is_enabled ? 'opacity-60' : ''
                }`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <Icon className="text-blue-600" size={24} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{plugin.display_name}</h3>
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                            v{plugin.version}
                          </span>
                          {plugin.is_system && (
                            <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                              System
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">{plugin.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <CategoryIcon size={14} />
                            {plugin.category}
                          </span>
                          {plugin.author && <span>by {plugin.author}</span>}
                          {pluginTools.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Wrench size={14} />
                              {pluginTools.length} tools
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {plugin.config_schema && (
                        <button
                          onClick={() => {
                            setSelectedPlugin(plugin);
                            setShowSettings(true);
                          }}
                          className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="Settings"
                        >
                          <Settings size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => handleTogglePlugin(plugin)}
                        disabled={plugin.is_system}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          plugin.is_enabled ? 'bg-blue-600' : 'bg-gray-200'
                        } ${plugin.is_system ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            plugin.is_enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Plugin Tools */}
                  {pluginTools.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => togglePluginExpand(plugin.id)}
                        className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        Mostra tools ({pluginTools.length})
                      </button>
                      {isExpanded && (
                        <div className="mt-3 pl-4 border-l-2 border-gray-100 space-y-2">
                          {pluginTools.map(tool => (
                            <div
                              key={tool.id}
                              className="flex items-center justify-between p-2 bg-gray-50 rounded"
                            >
                              <div>
                                <span className="text-sm font-medium">{tool.display_name}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  {tool.requires_approval && '(richiede approvazione)'}
                                </span>
                              </div>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={tool.is_enabled}
                                  onChange={() => handleToggleTool(tool)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MCP Servers Tab */}
      {activeTab === 'mcp' && (
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-yellow-600 mt-0.5" size={20} />
              <div>
                <h4 className="font-medium text-yellow-800">Model Context Protocol (MCP)</h4>
                <p className="text-sm text-yellow-700 mt-1">
                  I server MCP permettono all'AI di interagire con strumenti esterni.
                  Assicurati che i comandi siano corretti e che le variabili d'ambiente siano configurate.
                </p>
              </div>
            </div>
          </div>

          {mcpServers.map(mcp => (
            <div
              key={mcp.id}
              className={`bg-white rounded-lg shadow-sm border p-4 ${
                !mcp.is_enabled ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${
                    mcp.is_enabled ? 'bg-green-50' : 'bg-gray-50'
                  }`}>
                    <Server className={mcp.is_enabled ? 'text-green-600' : 'text-gray-400'} size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{mcp.display_name}</h3>
                      {mcpApprovalStatus[mcp.name] && (() => {
                        const status = mcpApprovalStatus[mcp.name];
                        const badges: Record<string, { label: string; className: string; Icon: typeof CheckCircle }> = {
                          pending_approval: { label: 'In attesa', className: 'bg-yellow-100 text-yellow-700', Icon: Clock },
                          approved: { label: 'Approvato', className: 'bg-green-100 text-green-700', Icon: CheckCircle },
                          installed: { label: 'Approvato', className: 'bg-green-100 text-green-700', Icon: CheckCircle },
                          rejected: { label: 'Rifiutato', className: 'bg-red-100 text-red-700', Icon: XCircle },
                          failed: { label: 'Rifiutato', className: 'bg-red-100 text-red-700', Icon: XCircle },
                        };
                        const badge = badges[status] || badges.pending_approval;
                        const BadgeIcon = badge.Icon;
                        return (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${badge.className}`}>
                            <BadgeIcon size={10} />
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{mcp.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                        {mcp.transport_type.toUpperCase()}
                      </span>
                      {mcp.command && (
                        <code className="px-2 py-0.5 bg-gray-800 text-gray-200 rounded text-xs font-mono truncate max-w-md">
                          {mcp.command}
                        </code>
                      )}
                      {mcp.url && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <ExternalLink size={12} />
                          {mcp.url}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTestMCP(mcp)}
                    disabled={testingMCP === mcp.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {testingMCP === mcp.id ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    ) : (
                      <Play size={14} />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() => setSelectedMCP(mcp)}
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleToggleMCP(mcp)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      mcp.is_enabled ? 'bg-green-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        mcp.is_enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Environment Variables */}
              {Object.keys(mcp.env_vars).length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Variabili d'ambiente:</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(mcp.env_vars).map(([key, value]) => (
                      <span
                        key={key}
                        className="px-2 py-1 bg-gray-100 rounded text-xs font-mono"
                      >
                        {key}={value ? '***' : '(non impostata)'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Test Result */}
              {testResult && testingMCP === null && (
                <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 ${
                  testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {testResult.success ? <CheckCircle size={18} /> : <XCircle size={18} />}
                  {testResult.message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tools Tab */}
      {activeTab === 'tools' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map(tool => (
              <div
                key={tool.id}
                className={`bg-white rounded-lg shadow-sm border p-4 ${
                  !tool.is_enabled ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      tool.is_enabled ? 'bg-blue-50' : 'bg-gray-50'
                    }`}>
                      <Wrench className={tool.is_enabled ? 'text-blue-600' : 'text-gray-400'} size={20} />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{tool.display_name}</h4>
                      <p className="text-xs text-gray-500">{tool.name}</p>
                    </div>
                  </div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={tool.is_enabled}
                      onChange={() => handleToggleTool(tool)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                </div>
                <p className="text-sm text-gray-600 mt-3">{tool.description}</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    tool.tool_type === 'function' ? 'bg-blue-100 text-blue-700' :
                    tool.tool_type === 'api' ? 'bg-green-100 text-green-700' :
                    tool.tool_type === 'mcp' ? 'bg-purple-100 text-purple-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {tool.tool_type}
                  </span>
                  {tool.requires_approval && (
                    <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded-full">
                      Richiede approvazione
                    </span>
                  )}
                  {tool.plugin_name && (
                    <span className="text-xs text-gray-400">
                      da {tool.plugin_name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plugin Settings Modal */}
      {showSettings && selectedPlugin && selectedPlugin.config_schema && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-xl font-semibold">
                Impostazioni: {selectedPlugin.display_name}
              </h3>
            </div>
            <div className="p-6">
              <DynamicForm
                schema={selectedPlugin.config_schema}
                onSubmit={handleSavePluginSettings}
                submitLabel="Salva Impostazioni"
              />
            </div>
            <div className="p-6 border-t flex justify-end">
              <button
                onClick={() => {
                  setShowSettings(false);
                  setSelectedPlugin(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MCP Edit Modal */}
      {selectedMCP && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-xl font-semibold">
                Modifica MCP Server: {selectedMCP.display_name}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comando (per stdio)
                </label>
                <input
                  type="text"
                  defaultValue={selectedMCP.command}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL (per SSE/WebSocket)
                </label>
                <input
                  type="text"
                  defaultValue={selectedMCP.url}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Variabili d'ambiente (JSON)
                </label>
                <textarea
                  defaultValue={JSON.stringify(selectedMCP.env_vars, null, 2)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                />
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setSelectedMCP(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Annulla
              </button>
              <button
                onClick={() => {
                  // TODO: Save MCP changes
                  setSelectedMCP(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
