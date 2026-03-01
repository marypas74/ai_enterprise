import { useState, useEffect, useRef } from 'react';
import { useAgentStore, AgentSession } from '../../hooks/useAgentStore';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { STATUS_COLORS, STATUS_ICONS, LOG_TYPE_COLORS } from './constants';
import WorktreePanel from './WorktreePanel';
import ConfigPanel from './ConfigPanel';

interface SessionDetailProps {
  session: AgentSession;
  onClose: () => void;
}

export default function SessionDetail({ session, onClose }: SessionDetailProps) {
  const {
    sessionLogs,
    fetchSessionLogs,
    worktreeStatus,
    fetchWorktreeStatus,
    connectWebSocket,
    disconnectWebSocket,
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
              'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full',
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
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              activeTab === tab
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-surface-500 hover:text-surface-700'
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
                <span className={clsx('text-xs uppercase w-14', LOG_TYPE_COLORS[log.logType])}>
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
