import { useState, useEffect, useCallback, useRef } from 'react';
import { useAgentStore, AgentSession, AgentTemplate, SessionLog } from '../hooks/useAgentStore';
import { api } from '../services/api';
import {
  Play,
  Pause,
  Square,
  Plus,
  Settings,
  Terminal,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  GitBranch,
  GitMerge,
  FileCode,
  Trash2,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  Bot,
  Cpu,
  Zap,
  Eye,
  X,
  Send,
  Copy,
  Download,
  Home,
  MessageSquare,
  Shield
} from 'lucide-react';
import { useAuthStore } from '../hooks/useAuthStore';
import clsx from 'clsx';
import { format } from 'date-fns';

// ==================== CONSTANTS ====================
// Professional color palette: Cyan (primary), Magenta (accent), Yellow (highlight)
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-surface-100 text-surface-700',
  initializing: 'bg-primary-100 text-primary-700',  // Cyan
  running: 'bg-accent-100 text-accent-700',          // Magenta
  paused: 'bg-highlight-100 text-highlight-700',     // Yellow
  completed: 'bg-primary-100 text-primary-700',      // Cyan
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-surface-100 text-surface-600'
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4" />,
  initializing: <Loader2 className="w-4 h-4 animate-spin" />,
  running: <Play className="w-4 h-4" />,
  paused: <Pause className="w-4 h-4" />,
  completed: <CheckCircle2 className="w-4 h-4" />,
  failed: <XCircle className="w-4 h-4" />,
  cancelled: <Square className="w-4 h-4" />
};

const LOG_TYPE_COLORS: Record<string, string> = {
  info: 'text-primary-400',      // Cyan
  warning: 'text-highlight-400', // Yellow
  error: 'text-red-400',
  stdout: 'text-accent-400',     // Magenta
  stderr: 'text-red-300'
};

// ==================== DASHBOARD COMPONENT ====================
function Dashboard({ onSelectSession }: { onSelectSession?: (sessionId: number) => void }) {
  const { orchestratorMetrics, terminalSlots, fetchOrchestratorMetrics, fetchTerminalSlots } = useAgentStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchOrchestratorMetrics();
    fetchTerminalSlots();
    const interval = setInterval(() => {
      fetchOrchestratorMetrics();
      fetchTerminalSlots();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchOrchestratorMetrics(), fetchTerminalSlots()]);
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-surface-900">Orchestrator Dashboard</h2>
          <p className="text-sm text-surface-500">Real-time agent monitoring</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
        >
          <RefreshCw className={clsx("w-4 h-4", isRefreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Terminal Slots"
          value={`${orchestratorMetrics?.terminals.occupied || 0} / 12`}
          subtitle={`${orchestratorMetrics?.terminals.available || 12} available`}
          icon={<Terminal className="w-5 h-5" />}
          color="cyan"
        />
        <MetricCard
          title="Active Sessions"
          value={orchestratorMetrics?.sessions.running || 0}
          subtitle={`${orchestratorMetrics?.sessions.total || 0} total (30 days)`}
          icon={<Activity className="w-5 h-5" />}
          color="magenta"
        />
        <MetricCard
          title="Success Rate"
          value={`${orchestratorMetrics?.sessions.successRate || 0}%`}
          subtitle={`${orchestratorMetrics?.sessions.completed || 0} completed`}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="cyan"
        />
        <MetricCard
          title="Avg Duration"
          value={formatDuration(orchestratorMetrics?.performance.avgDurationSeconds || 0)}
          subtitle={`${orchestratorMetrics?.performance.totalIterations || 0} iterations`}
          icon={<Clock className="w-5 h-5" />}
          color="yellow"
        />
      </div>

      {/* Terminal Slots Grid */}
      <div>
        <h3 className="text-md font-medium text-surface-800 mb-3">Terminal Slots</h3>
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }, (_, i) => {
            const slot = terminalSlots.find(s => s.slot === i);
            return (
              <TerminalSlotCard
                key={i}
                slotNumber={i}
                status={slot?.status || 'available'}
                sessionName={slot?.sessionName}
                onClick={slot?.sessionId && onSelectSession ? () => onSelectSession(slot.sessionId!) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, color }: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  color: 'cyan' | 'magenta' | 'yellow' | 'red';
}) {
  // Professional color palette: Cyan, Magenta, Yellow
  const colorClasses = {
    cyan: 'bg-primary-50 text-primary-600',      // Cyan
    magenta: 'bg-accent-50 text-accent-600',     // Magenta
    yellow: 'bg-highlight-50 text-highlight-600', // Yellow
    red: 'bg-red-50 text-red-600'
  };

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={clsx("p-2 rounded-lg", colorClasses[color])}>
          {icon}
        </div>
        <span className="text-sm text-surface-500">{title}</span>
      </div>
      <div className="text-2xl font-bold text-surface-900">{value}</div>
      <div className="text-xs text-surface-500 mt-1">{subtitle}</div>
    </div>
  );
}

function TerminalSlotCard({ slotNumber, status, sessionName, onClick }: {
  slotNumber: number;
  status: 'available' | 'occupied' | 'reserved';
  sessionName?: string | null;
  onClick?: () => void;
}) {
  // Professional color palette: Cyan, Magenta, Yellow
  const statusColors = {
    available: 'bg-surface-100 border-surface-200',
    occupied: 'bg-accent-50 border-accent-200',    // Magenta for active
    reserved: 'bg-highlight-50 border-highlight-200' // Yellow for reserved
  };

  const dotColors = {
    available: 'bg-surface-400',
    occupied: 'bg-accent-500 animate-pulse',  // Magenta
    reserved: 'bg-highlight-500'               // Yellow
  };

  const isClickable = status === 'occupied' && onClick;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={clsx(
        "rounded-lg border p-3 transition-colors",
        statusColors[status],
        isClickable && "cursor-pointer hover:border-accent-400"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-surface-600">Slot {slotNumber}</span>
        <div className={clsx("w-2 h-2 rounded-full", dotColors[status])} />
      </div>
      <div className="text-xs text-surface-500 truncate">
        {sessionName || status}
      </div>
    </div>
  );
}

// ==================== SESSIONS LIST COMPONENT ====================
function SessionsList({ onSelectSession }: { onSelectSession: (session: AgentSession) => void }) {
  const { sessions, activeSessions, fetchSessions, isLoading } = useAgentStore();
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');

  useEffect(() => {
    fetchSessions({ limit: 50 });
  }, []);

  const filteredSessions = sessions.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'active') return ['running', 'paused', 'initializing', 'pending'].includes(s.status);
    if (filter === 'completed') return s.status === 'completed';
    if (filter === 'failed') return s.status === 'failed' || s.status === 'cancelled';
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-2 border-b border-surface-200 pb-2">
        {(['all', 'active', 'completed', 'failed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              "px-3 py-1.5 text-sm rounded-lg transition-colors capitalize",
              filter === f
                ? "bg-primary-100 text-primary-700"
                : "text-surface-600 hover:bg-surface-100"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Sessions list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="text-center py-8 text-surface-500">
          No sessions found
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              onClick={() => onSelectSession(session)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session, onClick }: { session: AgentSession; onClick: () => void }) {
  const { startSession, pauseSession, resumeSession, cancelSession } = useAgentStore();

  const handleAction = async (e: React.MouseEvent, action: 'start' | 'pause' | 'resume' | 'cancel') => {
    e.stopPropagation();
    try {
      switch (action) {
        case 'start': await startSession(session.id); break;
        case 'pause': await pauseSession(session.id); break;
        case 'resume': await resumeSession(session.id); break;
        case 'cancel': await cancelSession(session.id); break;
      }
    } catch (err) {
      console.error(`Failed to ${action} session:`, err);
    }
  };

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-surface-200 p-4 hover:border-primary-300 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-surface-900 truncate">{session.name}</h4>
            <span className={clsx(
              "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full",
              STATUS_COLORS[session.status]
            )}>
              {STATUS_ICONS[session.status]}
              {session.status}
            </span>
          </div>
          <p className="text-sm text-surface-500 line-clamp-2">{session.taskSpecification}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-surface-400">
            <span>Slot {session.terminalSlot}</span>
            <span>Iter {session.iterationCount}/{session.maxIterations}</span>
            {session.createdAt && (
              <span>{format(new Date(session.createdAt), 'MMM d, HH:mm')}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-4">
          {session.status === 'pending' && (
            <button
              onClick={(e) => handleAction(e, 'start')}
              className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
              title="Start"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {session.status === 'running' && (
            <button
              onClick={(e) => handleAction(e, 'pause')}
              className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {session.status === 'paused' && (
            <button
              onClick={(e) => handleAction(e, 'resume')}
              className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {['running', 'paused', 'initializing'].includes(session.status) && (
            <button
              onClick={(e) => handleAction(e, 'cancel')}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
              title="Cancel"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          <ChevronRight className="w-4 h-4 text-surface-400" />
        </div>
      </div>
    </div>
  );
}

// ==================== SESSION DETAIL COMPONENT ====================
function SessionDetail({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const {
    sessionLogs,
    fetchSessionLogs,
    worktreeStatus,
    fetchWorktreeStatus,
    connectWebSocket,
    disconnectWebSocket
  } = useAgentStore();
  const [activeTab, setActiveTab] = useState<'logs' | 'worktree' | 'config'>('logs');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessionLogs(session.id);
    fetchWorktreeStatus(session.id);
    connectWebSocket(session.id);
    return () => disconnectWebSocket();
  }, [session.id]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionLogs]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-200">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-surface-900">{session.name}</h3>
            <span className={clsx(
              "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full",
              STATUS_COLORS[session.status]
            )}>
              {STATUS_ICONS[session.status]}
              {session.status}
            </span>
          </div>
          <p className="text-sm text-surface-500 mt-1">Session #{session.id}</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-surface-100 rounded-lg">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-surface-200">
        {(['logs', 'worktree', 'config'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize",
              activeTab === tab
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-surface-500 hover:text-surface-700"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'logs' && (
          <div className="bg-surface-900 rounded-lg p-4 font-mono text-sm h-full overflow-auto">
            {sessionLogs.map((log, i) => (
              <div key={log.id || i} className="flex gap-2 py-1">
                <span className="text-surface-500 text-xs">
                  {format(new Date(log.timestamp), 'HH:mm:ss')}
                </span>
                <span className={clsx("text-xs uppercase w-14", LOG_TYPE_COLORS[log.logType])}>
                  [{log.logType}]
                </span>
                <span className="text-surface-100 flex-1 whitespace-pre-wrap break-all">
                  {log.content}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        {activeTab === 'worktree' && (
          <WorktreePanel session={session} worktree={worktreeStatus} />
        )}

        {activeTab === 'config' && (
          <ConfigPanel session={session} />
        )}
      </div>
    </div>
  );
}

function WorktreePanel({ session, worktree }: { session: AgentSession; worktree: any }) {
  const { mergeWorktree } = useAgentStore();
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      await mergeWorktree(session.id);
    } catch (err) {
      console.error('Merge failed:', err);
    } finally {
      setIsMerging(false);
    }
  };

  if (!worktree) {
    return (
      <div className="text-center py-8 text-surface-500">
        <GitBranch className="w-12 h-12 mx-auto mb-3 text-surface-300" />
        <p>No worktree configured for this session</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-surface-200 p-4">
        <h4 className="font-medium text-surface-900 mb-3">Worktree Info</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-500">Branch:</span>
            <span className="font-mono text-surface-900">{worktree.branchName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Base Branch:</span>
            <span className="font-mono text-surface-900">{worktree.baseBranch}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Path:</span>
            <span className="font-mono text-surface-900 truncate max-w-xs">{worktree.worktreePath}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Status:</span>
            <span className={clsx(
              "px-2 py-0.5 rounded-full text-xs",
              worktree.status === 'active' && "bg-green-100 text-green-700",
              worktree.status === 'merged' && "bg-blue-100 text-blue-700",
              worktree.status === 'conflict' && "bg-red-100 text-red-700"
            )}>
              {worktree.status}
            </span>
          </div>
        </div>
      </div>

      {worktree.status === 'active' && session.status === 'completed' && (
        <button
          onClick={handleMerge}
          disabled={isMerging}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
        >
          {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
          Merge to {worktree.baseBranch}
        </button>
      )}

      {worktree.conflictFiles?.length > 0 && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Merge Conflicts ({worktree.conflictFiles.length})
          </h4>
          <ul className="space-y-1">
            {worktree.conflictFiles.map((file: string) => (
              <li key={file} className="text-sm font-mono text-red-700">{file}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConfigPanel({ session }: { session: AgentSession }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-surface-200 p-4">
        <h4 className="font-medium text-surface-900 mb-3">Session Configuration</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-500">Max Iterations:</span>
            <span className="text-surface-900">{session.maxIterations}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Timeout:</span>
            <span className="text-surface-900">{formatDuration(session.timeoutSeconds)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Auto Commit:</span>
            <span className="text-surface-900">{session.config?.autoCommit ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Run Tests:</span>
            <span className="text-surface-900">{session.config?.runTests ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-surface-200 p-4">
        <h4 className="font-medium text-surface-900 mb-3">Task Specification</h4>
        <pre className="text-sm text-surface-700 whitespace-pre-wrap bg-surface-50 p-3 rounded-lg">
          {session.taskSpecification}
        </pre>
      </div>

      {session.systemPrompt && (
        <div className="bg-white rounded-lg border border-surface-200 p-4">
          <h4 className="font-medium text-surface-900 mb-3">System Prompt</h4>
          <pre className="text-sm text-surface-700 whitespace-pre-wrap bg-surface-50 p-3 rounded-lg">
            {session.systemPrompt}
          </pre>
        </div>
      )}
    </div>
  );
}

// ==================== CREATE SESSION MODAL ====================
function CreateSessionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (session: AgentSession) => void }) {
  const { templates, fetchTemplates, createSession, isLoading } = useAgentStore();
  const [formData, setFormData] = useState({
    name: '',
    taskSpecification: '',
    modelId: 1,
    systemPrompt: '',
    templateId: undefined as number | undefined,
    config: {
      maxIterations: 50,
      timeoutSeconds: 3600,
      autoCommit: true,
      runTests: true,
      createWorktree: true,
      baseBranch: 'main'
    }
  });
  const [models, setModels] = useState<any[]>([]);

  useEffect(() => {
    fetchTemplates();
    api.get('/chat/models').then(res => setModels(res.data)).catch(() => {});
  }, []);

  const handleTemplateSelect = (templateId: number) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setFormData(prev => ({
        ...prev,
        templateId,
        modelId: template.modelId,
        systemPrompt: template.systemPrompt,
        config: {
          ...prev.config,
          maxIterations: template.maxIterations,
          timeoutSeconds: template.timeoutSeconds,
          ...template.defaultConfig
        }
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const session = await createSession(formData);
      onCreated(session);
      onClose();
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <h3 className="font-semibold text-lg">Create Agent Session</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Template selector */}
          {templates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Template (optional)</label>
              <select
                value={formData.templateId || ''}
                onChange={(e) => e.target.value && handleTemplateSelect(Number(e.target.value))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
              >
                <option value="">No template</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Session Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg"
              placeholder="e.g., Implement authentication feature"
              required
            />
          </div>

          {/* Task specification */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Task Specification *</label>
            <textarea
              value={formData.taskSpecification}
              onChange={(e) => setFormData(prev => ({ ...prev, taskSpecification: e.target.value }))}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg h-32 resize-none"
              placeholder="Describe the task in detail..."
              required
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">AI Model</label>
            <select
              value={formData.modelId}
              onChange={(e) => setFormData(prev => ({ ...prev, modelId: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Max Iterations</label>
              <input
                type="number"
                value={formData.config.maxIterations}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, maxIterations: Number(e.target.value) }
                }))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
                min={1}
                max={100}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Timeout (seconds)</label>
              <input
                type="number"
                value={formData.config.timeoutSeconds}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, timeoutSeconds: Number(e.target.value) }
                }))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
                min={60}
                max={7200}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.config.createWorktree}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, createWorktree: e.target.checked }
                }))}
                className="w-4 h-4 rounded border-surface-300"
              />
              <span className="text-sm text-surface-700">Create Git worktree</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.config.autoCommit}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, autoCommit: e.target.checked }
                }))}
                className="w-4 h-4 rounded border-surface-300"
              />
              <span className="text-sm text-surface-700">Auto commit</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.config.runTests}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, runTests: e.target.checked }
                }))}
                className="w-4 h-4 rounded border-surface-300"
              />
              <span className="text-sm text-surface-700">Run tests</span>
            </label>
          </div>

          {/* Base branch */}
          {formData.config.createWorktree && (
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Base Branch</label>
              <input
                type="text"
                value={formData.config.baseBranch}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, baseBranch: e.target.value }
                }))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
              />
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-surface-700 hover:bg-surface-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Session
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== HELPER FUNCTIONS ====================
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// ==================== MAIN PAGE COMPONENT ====================
export default function AutoClaudePage() {
  const { error, clearError, connectWebSocket, disconnectWebSocket } = useAgentStore();
  const { user } = useAuthStore();
  const [view, setView] = useState<'dashboard' | 'sessions' | 'templates'>('dashboard');
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    // Connect to orchestrator WebSocket for real-time updates
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-64 bg-surface-50 border-r border-surface-200 flex flex-col">
        <div className="p-4 border-b border-surface-200">
          <div className="flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary-500" />
            <span className="font-semibold text-surface-900">Auto-Claude</span>
          </div>
          <p className="text-xs text-surface-500 mt-1">Multi-agent orchestration</p>
        </div>

        {/* Navigation links */}
        <div className="p-2 border-b border-surface-200">
          <a
            href="/"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-surface-600 hover:bg-surface-100"
          >
            <MessageSquare className="w-4 h-4" />
            Chat
          </a>
          {user?.role === 'admin' && (
            <a
              href="/admin"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-surface-600 hover:bg-surface-100 mt-1"
            >
              <Shield className="w-4 h-4" />
              Admin Panel
            </a>
          )}
        </div>

        <nav className="flex-1 p-2">
          <button
            onClick={() => { setView('dashboard'); setSelectedSession(null); }}
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left",
              view === 'dashboard' && !selectedSession
                ? "bg-primary-100 text-primary-700"
                : "text-surface-600 hover:bg-surface-100"
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => { setView('sessions'); setSelectedSession(null); }}
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left mt-1",
              view === 'sessions' && !selectedSession
                ? "bg-primary-100 text-primary-700"
                : "text-surface-600 hover:bg-surface-100"
            )}
          >
            <Cpu className="w-4 h-4" />
            Sessions
          </button>
          <button
            onClick={() => { setView('templates'); setSelectedSession(null); }}
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left mt-1",
              view === 'templates'
                ? "bg-primary-100 text-primary-700"
                : "text-surface-600 hover:bg-surface-100"
            )}
          >
            <Zap className="w-4 h-4" />
            Templates
          </button>
        </nav>

        {/* Create button */}
        <div className="p-4 border-t border-surface-200">
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-red-700">{error}</span>
            <button onClick={clearError} className="text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {selectedSession ? (
            <SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />
          ) : view === 'dashboard' ? (
            <div className="p-6">
              <Dashboard onSelectSession={async (sessionId) => {
                try {
                  const response = await api.get(`/agents/sessions/${sessionId}`);
                  setSelectedSession(response.data);
                } catch (err) {
                  console.error('Failed to load session:', err);
                }
              }} />
            </div>
          ) : view === 'sessions' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-surface-900">Agent Sessions</h2>
              </div>
              <SessionsList onSelectSession={setSelectedSession} />
            </div>
          ) : (
            <div className="p-6">
              <TemplatesView />
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <CreateSessionModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(session) => {
            setSelectedSession(session);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

// ==================== TEMPLATES VIEW ====================
function TemplatesView() {
  const { templates, fetchTemplates, deleteTemplate } = useAgentStore();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const categoryColors: Record<string, string> = {
    development: 'bg-blue-100 text-blue-700',
    testing: 'bg-green-100 text-green-700',
    documentation: 'bg-purple-100 text-purple-700',
    research: 'bg-amber-100 text-amber-700',
    automation: 'bg-red-100 text-red-700',
    custom: 'bg-gray-100 text-gray-700'
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-surface-900">Agent Templates</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600"
        >
          <Plus className="w-4 h-4" />
          Create Template
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(template => (
          <div key={template.id} className="bg-white rounded-lg border border-surface-200 p-4">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-medium text-surface-900">{template.name}</h4>
              <span className={clsx(
                "px-2 py-0.5 text-xs rounded-full capitalize",
                categoryColors[template.category] || categoryColors.custom
              )}>
                {template.category}
              </span>
            </div>
            {template.description && (
              <p className="text-sm text-surface-500 mb-3 line-clamp-2">{template.description}</p>
            )}
            <div className="flex items-center justify-between text-xs text-surface-400">
              <span>{template.isPublic ? 'Public' : 'Private'}</span>
              <button
                onClick={() => deleteTemplate(template.id)}
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
