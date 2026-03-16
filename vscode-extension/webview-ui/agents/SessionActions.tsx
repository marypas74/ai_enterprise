import React from 'react';
import type { AgentSession } from '../shared/types';

interface SessionActionsProps {
  session: AgentSession;
  onPause: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onCancel: (sessionId: string) => void;
}

export function SessionActions({ session, onPause, onResume, onCancel }: SessionActionsProps) {
  const isActive = session.status === 'running' || session.status === 'paused';

  if (!isActive) {
    return null;
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {session.status === 'running' && (
        <button
          onClick={() => onPause(session.id)}
          style={{
            padding: '3px 10px',
            fontSize: 12,
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
          }}
          title="Pause session"
        >
          Pause
        </button>
      )}
      {session.status === 'paused' && (
        <button
          onClick={() => onResume(session.id)}
          style={{
            padding: '3px 10px',
            fontSize: 12,
          }}
          title="Resume session"
        >
          Resume
        </button>
      )}
      <button
        onClick={() => onCancel(session.id)}
        style={{
          padding: '3px 10px',
          fontSize: 12,
          background: 'var(--vscode-inputValidation-errorBackground)',
          color: 'var(--error)',
        }}
        title="Cancel session"
      >
        Cancel
      </button>
    </div>
  );
}
