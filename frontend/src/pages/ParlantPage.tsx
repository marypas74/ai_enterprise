import { useState, useEffect, useRef } from 'react';
import { useParlantStore, ParlantAgent, ParlantGuideline, ParlantSession } from '../hooks/useParlantStore';
import { useAuthStore } from '../hooks/useAuthStore';
import {
  Bot,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  MessageSquare,
  Settings,
  ChevronRight,
  ChevronDown,
  Shield,
  Activity,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Home,
  LogOut,
  Loader2,
  FileText,
  Zap
} from 'lucide-react';
import clsx from 'clsx';

// ==================== AGENT CARD ====================
function AgentCard({
  agent,
  isSelected,
  onSelect,
  onDelete
}: {
  agent: ParlantAgent;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={clsx(
        'p-4 rounded-lg border cursor-pointer transition-all',
        isSelected
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-surface-200 dark:border-surface-700 hover:border-primary-300'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-medium text-surface-900 dark:text-surface-100">{agent.name}</h3>
            {agent.description && (
              <p className="text-sm text-surface-500 line-clamp-1">{agent.description}</p>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>
    </div>
  );
}

// ==================== GUIDELINE EDITOR ====================
function GuidelineEditor({
  agentId,
  guideline,
  onSave,
  onCancel
}: {
  agentId: string;
  guideline?: ParlantGuideline;
  onSave: (condition: string, action: string) => void;
  onCancel: () => void;
}) {
  const [condition, setCondition] = useState(guideline?.condition || '');
  const [action, setAction] = useState(guideline?.action || '');

  return (
    <div className="p-4 bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
            Condition (When...)
          </label>
          <textarea
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="User asks about company policies"
            className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            rows={2}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
            Action (Then...)
          </label>
          <textarea
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Provide information from the knowledge base"
            className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            rows={2}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(condition, action)}
            disabled={!condition.trim() || !action.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4 inline mr-1" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== GUIDELINES PANEL ====================
function GuidelinesPanel({ agentId }: { agentId: string }) {
  const { guidelines, fetchGuidelines, createGuideline, deleteGuideline, isLoading } = useParlantStore();
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    if (agentId) {
      fetchGuidelines(agentId);
    }
  }, [agentId]);

  const handleSaveGuideline = async (condition: string, action: string) => {
    await createGuideline(agentId, condition, action);
    setShowEditor(false);
  };

  const handleDeleteGuideline = async (guidelineId: string) => {
    if (confirm('Delete this guideline?')) {
      await deleteGuideline(agentId, guidelineId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary-600" />
          Guidelines
        </h3>
        <button
          onClick={() => setShowEditor(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Guideline
        </button>
      </div>

      {showEditor && (
        <GuidelineEditor
          agentId={agentId}
          onSave={handleSaveGuideline}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
        </div>
      ) : guidelines.length === 0 ? (
        <div className="text-center py-8 text-surface-500">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No guidelines configured</p>
          <p className="text-sm">Add guidelines to control agent behavior</p>
        </div>
      ) : (
        <div className="space-y-3">
          {guidelines.map((guideline) => (
            <div
              key={guideline.id}
              className="p-4 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div>
                    <span className="text-xs font-medium text-primary-600 uppercase">When</span>
                    <p className="text-surface-900 dark:text-surface-100">{guideline.condition}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-accent-600 uppercase">Then</span>
                    <p className="text-surface-700 dark:text-surface-300">{guideline.action}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteGuideline(guideline.id)}
                  className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== CHAT PANEL ====================
function ChatPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { sessions, currentSession, events, createSession, fetchSessions, fetchEvents, sendMessage, isLoading } = useParlantStore();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (agentId) {
      fetchSessions(agentId);
    }
  }, [agentId]);

  useEffect(() => {
    if (currentSession) {
      fetchEvents(currentSession.id);
    }
  }, [currentSession?.id]);

  // Poll for new events (AI responses come asynchronously)
  useEffect(() => {
    if (!currentSession) return;

    const pollInterval = setInterval(() => {
      fetchEvents(currentSession.id);
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [currentSession?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const handleStartSession = async () => {
    await createSession(agentId);
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !currentSession || isSending) return;
    const message = input.trim();
    setInput('');
    setIsSending(true);
    await sendMessage(currentSession.id, message);
    // Immediate fetch after sending, then polling will continue
    await fetchEvents(currentSession.id);
    setIsSending(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-surface-200 dark:border-surface-700">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary-600" />
          Chat with {agentName}
        </h3>
        {!currentSession && (
          <button
            onClick={handleStartSession}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        )}
      </div>

      {!currentSession ? (
        <div className="flex-1 flex items-center justify-center text-surface-500">
          <div className="text-center">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No active session</p>
            <p className="text-sm">Start a new session to chat with this agent</p>
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {events.filter(e => e.kind === 'message').length === 0 ? (
              <div className="text-center text-surface-500 py-8">
                <p>Session started. Send a message to begin.</p>
              </div>
            ) : (
              events
                .filter((event) => event.kind === 'message' && event.data?.message)
                .map((event) => (
                  <div
                    key={event.id}
                    className={clsx(
                      'flex',
                      event.source === 'customer' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <div
                      className={clsx(
                        'max-w-[80%] px-4 py-2 rounded-lg',
                        event.source === 'customer'
                          ? 'bg-primary-600 text-white'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
                      )}
                    >
                      <p>{event.data?.message}</p>
                    </div>
                  </div>
                ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-surface-200 dark:border-surface-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={handleSendMessage}
                disabled={!input.trim() || isSending}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==================== MAIN PAGE ====================
export default function ParlantPage() {
  const { user, logout } = useAuthStore();
  const {
    agents,
    currentAgent,
    serviceHealth,
    isLoading,
    error,
    checkHealth,
    fetchAgents,
    fetchAgent,
    createAgent,
    deleteAgent,
    clearError
  } = useParlantStore();

  const [activeTab, setActiveTab] = useState<'guidelines' | 'chat'>('guidelines');
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');

  useEffect(() => {
    checkHealth();
    fetchAgents();
  }, []);

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;
    const agent = await createAgent(newAgentName.trim(), newAgentDescription.trim() || undefined);
    if (agent) {
      setShowCreateAgent(false);
      setNewAgentName('');
      setNewAgentDescription('');
      fetchAgent(agent.id);
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (confirm('Delete this agent and all its guidelines?')) {
      await deleteAgent(agentId);
    }
  };

  const handleSelectAgent = (agent: ParlantAgent) => {
    fetchAgent(agent.id);
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      {/* Header */}
      <header className="bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
              >
                <Home className="w-5 h-5" />
              </a>
              <div className="flex items-center gap-2">
                <Zap className="w-6 h-6 text-primary-600" />
                <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">Parlant Agents</h1>
              </div>
              {/* Health Status */}
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-100 dark:bg-surface-800">
                {serviceHealth === 'healthy' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-green-600">Connected</span>
                  </>
                ) : serviceHealth === 'unhealthy' ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-red-600">Disconnected</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-surface-500" />
                    <span className="text-sm text-surface-500">Checking...</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={checkHealth}
                className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
              {user?.role === 'admin' && (
                <a
                  href="/admin"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                >
                  <Settings className="w-5 h-5" />
                  <span className="text-sm">Admin</span>
                </a>
              )}
              <button
                onClick={logout}
                className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <button onClick={clearError} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Agents Sidebar */}
          <div className="col-span-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Agents</h2>
              <button
                onClick={() => setShowCreateAgent(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Agent
              </button>
            </div>

            {/* Create Agent Form */}
            {showCreateAgent && (
              <div className="p-4 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700 space-y-3">
                <input
                  type="text"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="Agent name"
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500"
                />
                <textarea
                  value={newAgentDescription}
                  onChange={(e) => setNewAgentDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500"
                  rows={2}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowCreateAgent(false)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAgent}
                    disabled={!newAgentName.trim()}
                    className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}

            {/* Agents List */}
            {isLoading && agents.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center py-8 text-surface-500">
                <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No agents configured</p>
                <p className="text-sm">Create an agent to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isSelected={currentAgent?.id === agent.id}
                    onSelect={() => handleSelectAgent(agent)}
                    onDelete={() => handleDeleteAgent(agent.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Agent Details Panel */}
          <div className="col-span-8">
            {currentAgent ? (
              <div className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
                {/* Agent Header */}
                <div className="p-4 border-b border-surface-200 dark:border-surface-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                        <Bot className="w-6 h-6 text-primary-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">
                          {currentAgent.name}
                        </h2>
                        {currentAgent.description && (
                          <p className="text-surface-500">{currentAgent.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-surface-200 dark:border-surface-700">
                  <button
                    onClick={() => setActiveTab('guidelines')}
                    className={clsx(
                      'flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors',
                      activeTab === 'guidelines'
                        ? 'border-b-2 border-primary-600 text-primary-600'
                        : 'text-surface-500 hover:text-surface-700'
                    )}
                  >
                    <Shield className="w-4 h-4" />
                    Guidelines
                  </button>
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={clsx(
                      'flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors',
                      activeTab === 'chat'
                        ? 'border-b-2 border-primary-600 text-primary-600'
                        : 'text-surface-500 hover:text-surface-700'
                    )}
                  >
                    <MessageSquare className="w-4 h-4" />
                    Chat
                  </button>
                </div>

                {/* Tab Content */}
                <div className="p-4" style={{ minHeight: '400px' }}>
                  {activeTab === 'guidelines' ? (
                    <GuidelinesPanel agentId={currentAgent.id} />
                  ) : (
                    <ChatPanel agentId={currentAgent.id} agentName={currentAgent.name} />
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 h-full flex items-center justify-center">
                <div className="text-center text-surface-500 py-16">
                  <Bot className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium mb-2">Select an Agent</h3>
                  <p>Choose an agent from the list to view and manage its configuration</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
