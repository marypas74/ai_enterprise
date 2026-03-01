import { useState, useEffect } from 'react';
import { useAgentStore, AgentSession } from '../../hooks/useAgentStore';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import SessionCard from './SessionCard';

interface SessionsListProps {
  onSelectSession: (session: AgentSession) => void;
}

export default function SessionsList({ onSelectSession }: SessionsListProps) {
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
              'px-3 py-1.5 text-sm rounded-lg transition-colors capitalize',
              filter === f
                ? 'bg-primary-100 text-primary-700'
                : 'text-surface-600 hover:bg-surface-100'
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
