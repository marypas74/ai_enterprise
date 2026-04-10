import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  Bot,
  Plus,
  Search,
  Settings,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  ChevronRight,
  Code,
  Zap,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';
import clsx from 'clsx';

interface Agent {
  id: number;
  name: string;
  description: string;
  type: 'assistant' | 'autonomous' | 'tool-caller' | 'custom';
  status: 'active' | 'inactive' | 'running' | 'error';
  model_id: number;
  model_name?: string;
  system_prompt: string;
  tools: string[];
  skills: string[];
  config: Record<string, any>;
  max_iterations: number;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
  last_run?: string;
  run_count: number;
}

const AGENT_TYPES = [
  { value: 'assistant', label: 'Assistant', description: 'Risponde a domande e esegue task semplici' },
  { value: 'autonomous', label: 'Autonomous', description: 'Opera autonomamente con obiettivi definiti' },
  { value: 'tool-caller', label: 'Tool Caller', description: 'Specializzato nell\'uso di tool esterni' },
  { value: 'custom', label: 'Custom', description: 'Configurazione personalizzata' }
];

const STATUS_CONFIG = {
  active: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30' },
  inactive: { icon: XCircle, color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-900/30' },
  running: { icon: RefreshCw, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  error: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' }
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [agentsRes, modelsRes, toolsRes, skillsRes] = await Promise.all([
        api.get('/agents'),
        api.get('/models'),
        api.get('/tools'),
        api.get('/skills')
      ]);
      setAgents(agentsRes.data || []);
      setModels(modelsRes.data || []);
      setTools(toolsRes.data || []);
      setSkills(skillsRes.data || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      // Set demo data for visualization
      setAgents([
        {
          id: 1,
          name: 'Code Assistant',
          description: 'Aiuta con la scrittura e revisione del codice',
          type: 'assistant',
          status: 'active',
          model_id: 1,
          model_name: 'GPT-4o',
          system_prompt: 'Sei un assistente esperto in programmazione...',
          tools: ['code_interpreter', 'file_search'],
          skills: ['code_review', 'refactoring'],
          config: {},
          max_iterations: 10,
          timeout_seconds: 300,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          run_count: 150
        },
        {
          id: 2,
          name: 'Research Agent',
          description: 'Ricerca autonoma su argomenti specifici',
          type: 'autonomous',
          status: 'running',
          model_id: 2,
          model_name: 'Claude 3.5 Sonnet',
          system_prompt: 'Sei un agente di ricerca autonomo...',
          tools: ['web_search', 'summarize'],
          skills: ['research', 'analysis'],
          config: { max_depth: 3 },
          max_iterations: 50,
          timeout_seconds: 600,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_run: new Date().toISOString(),
          run_count: 45
        },
        {
          id: 3,
          name: 'API Integrator',
          description: 'Gestisce chiamate a API esterne',
          type: 'tool-caller',
          status: 'active',
          model_id: 1,
          model_name: 'GPT-4o',
          system_prompt: 'Sei specializzato nell\'integrazione con API...',
          tools: ['http_request', 'json_parser', 'database'],
          skills: ['api_integration'],
          config: {},
          max_iterations: 20,
          timeout_seconds: 120,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          run_count: 89
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const filteredAgents = agents.filter(agent => {
    const matchesSearch = agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.description.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === 'all' || agent.type === selectedType;
    return matchesSearch && matchesType;
  });

  const handleToggleStatus = async (agent: Agent) => {
    try {
      const newStatus = agent.status === 'active' ? 'inactive' : 'active';
      await api.patch(`/agents/${agent.id}`, { status: newStatus });
      setAgents(agents.map(a => a.id === agent.id ? { ...a, status: newStatus } : a));
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Sei sicuro di voler eliminare questo agent?')) return;
    try {
      await api.delete(`/agents/${id}`);
      setAgents(agents.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  const handleRunAgent = async (agent: Agent) => {
    try {
      await api.post(`/agents/${agent.id}/run`);
      setAgents(agents.map(a => a.id === agent.id ? { ...a, status: 'running' } : a));
    } catch (err) {
      console.error('Failed to run agent:', err);
    }
  };

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-surface-500 mt-1">Gestisci gli agenti AI autonomi e assistenti</p>
        </div>
        <button
          onClick={() => { setEditingAgent(null); setShowModal(true); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nuovo Agent
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca agents..."
            className="input pl-11 w-full"
          />
        </div>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="input w-48"
        >
          <option value="all">Tutti i tipi</option>
          {AGENT_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Bot className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{agents.length}</p>
              <p className="text-sm text-surface-500">Totale Agents</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{agents.filter(a => a.status === 'active').length}</p>
              <p className="text-sm text-surface-500">Attivi</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Zap className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{agents.filter(a => a.status === 'running').length}</p>
              <p className="text-sm text-surface-500">In Esecuzione</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{agents.reduce((sum, a) => sum + a.run_count, 0)}</p>
              <p className="text-sm text-surface-500">Esecuzioni Totali</p>
            </div>
          </div>
        </div>
      </div>

      {/* Agents Grid */}
      {loading ? (
        <div className="text-center py-12 text-surface-500">Caricamento...</div>
      ) : filteredAgents.length === 0 ? (
        <div className="text-center py-12">
          <Bot className="w-12 h-12 text-surface-300 mx-auto mb-4" />
          <p className="text-surface-500">Nessun agent trovato</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredAgents.map(agent => {
            const StatusIcon = STATUS_CONFIG[agent.status]?.icon || AlertCircle;
            return (
              <div
                key={agent.id}
                className={clsx(
                  'card p-5 cursor-pointer hover:shadow-lg transition-shadow',
                  selectedAgent?.id === agent.id && 'ring-2 ring-primary-500'
                )}
                onClick={() => setSelectedAgent(agent)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 text-white">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{agent.name}</h3>
                      <p className="text-sm text-surface-500">{agent.model_name}</p>
                    </div>
                  </div>
                  <div className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                    STATUS_CONFIG[agent.status]?.bg
                  )}>
                    <StatusIcon className={clsx('w-3.5 h-3.5', STATUS_CONFIG[agent.status]?.color)} />
                    <span className={STATUS_CONFIG[agent.status]?.color}>
                      {agent.status === 'running' ? 'In esecuzione' : agent.status}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-surface-600 dark:text-surface-400 mb-4 line-clamp-2">
                  {agent.description}
                </p>

                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="px-2 py-1 text-xs rounded-full bg-surface-100 dark:bg-surface-800">
                    {AGENT_TYPES.find(t => t.value === agent.type)?.label}
                  </span>
                  <span className="px-2 py-1 text-xs rounded-full bg-surface-100 dark:bg-surface-800">
                    {agent.tools.length} tools
                  </span>
                  <span className="px-2 py-1 text-xs rounded-full bg-surface-100 dark:bg-surface-800">
                    {agent.skills.length} skills
                  </span>
                  <span className="px-2 py-1 text-xs rounded-full bg-surface-100 dark:bg-surface-800">
                    {agent.run_count} esecuzioni
                  </span>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-surface-100 dark:border-surface-800">
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRunAgent(agent); }}
                      disabled={agent.status === 'running'}
                      className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg disabled:opacity-50"
                      title="Esegui"
                    >
                      <Play className="w-4 h-4 text-green-600" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleStatus(agent); }}
                      className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg"
                      title={agent.status === 'active' ? 'Disattiva' : 'Attiva'}
                    >
                      {agent.status === 'active' ? (
                        <Pause className="w-4 h-4 text-amber-600" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      )}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingAgent(agent); setShowModal(true); }}
                      className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg"
                      title="Configura"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(agent.id); }}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-600"
                    title="Elimina"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      </div>

      {/* Modal per nuovo/modifica agent */}
      {showModal && (
        <AgentModal
          agent={editingAgent}
          models={models}
          tools={tools}
          skills={skills}
          onClose={() => { setShowModal(false); setEditingAgent(null); }}
          onSave={() => { loadData(); setShowModal(false); setEditingAgent(null); }}
        />
      )}
    </div>
  );
}

function AgentModal({ agent, models, tools, skills, onClose, onSave }: {
  agent: Agent | null;
  models: any[];
  tools: any[];
  skills: any[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    name: agent?.name || '',
    description: agent?.description || '',
    type: agent?.type || 'assistant',
    model_id: agent?.model_id || '',
    system_prompt: agent?.system_prompt || '',
    tools: agent?.tools || [],
    skills: agent?.skills || [],
    max_iterations: agent?.max_iterations || 10,
    timeout_seconds: agent?.timeout_seconds || 300
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (agent) {
        await api.patch(`/agents/${agent.id}`, form);
      } else {
        await api.post('/agents', form);
      }
      onSave();
    } catch (err) {
      console.error('Failed to save agent:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-surface-200 dark:border-surface-800">
          <h2 className="text-xl font-bold">
            {agent ? 'Modifica Agent' : 'Nuovo Agent'}
          </h2>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input w-full"
                placeholder="Code Assistant"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                className="input w-full"
              >
                {AGENT_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Descrizione</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full"
              placeholder="Descrizione dell'agent..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Modello AI</label>
            <select
              value={form.model_id}
              onChange={(e) => setForm({ ...form, model_id: e.target.value })}
              className="input w-full"
            >
              <option value="">Seleziona un modello</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.display_name || m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">System Prompt</label>
            <textarea
              value={form.system_prompt}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              className="input w-full h-32"
              placeholder="Sei un assistente AI specializzato in..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Max Iterazioni</label>
              <input
                type="number"
                value={form.max_iterations}
                onChange={(e) => setForm({ ...form, max_iterations: parseInt(e.target.value) })}
                className="input w-full"
                min={1}
                max={100}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Timeout (sec)</label>
              <input
                type="number"
                value={form.timeout_seconds}
                onChange={(e) => setForm({ ...form, timeout_seconds: parseInt(e.target.value) })}
                className="input w-full"
                min={30}
                max={3600}
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">
            Annulla
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
