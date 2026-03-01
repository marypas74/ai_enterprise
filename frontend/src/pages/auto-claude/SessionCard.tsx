import { useAgentStore, AgentSession } from '../../hooks/useAgentStore';
import {
  Play,
  Pause,
  Square,
  ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { STATUS_COLORS, STATUS_ICONS } from './constants';

interface SessionCardProps {
  session: AgentSession;
  onClick: () => void;
}

export default function SessionCard({ session, onClick }: SessionCardProps) {
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
              'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full',
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
