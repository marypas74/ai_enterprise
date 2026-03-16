import React from 'react';
import type { AgentSession } from '../shared/types';

interface SessionListProps {
  sessions: AgentSession[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  const grouped = groupByStatus(sessions);

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {grouped.active.length > 0 && (
        <SessionGroup label="Active" sessions={grouped.active} selectedId={selectedId} onSelect={onSelect} />
      )}
      {grouped.completed.length > 0 && (
        <SessionGroup label="Completed" sessions={grouped.completed} selectedId={selectedId} onSelect={onSelect} />
      )}
      {grouped.failed.length > 0 && (
        <SessionGroup label="Failed" sessions={grouped.failed} selectedId={selectedId} onSelect={onSelect} />
      )}
      {sessions.length === 0 && (
        <div style={{ padding: '16px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
          No sessions. Use <em>Enterprise AI: New Agent Session</em> to start one.
        </div>
      )}
    </div>
  );
}

interface SessionGroupProps {
  label: string;
  sessions: AgentSession[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}

function SessionGroup({ label, sessions, selectedId, onSelect }: SessionGroupProps) {
  return (
    <div>
      <div style={{
        padding: '6px 12px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        letterSpacing: '0.5px',
      }}>
        {label} ({sessions.length})
      </div>
      {sessions.map((session) => (
        <div
          key={session.id}
          onClick={() => onSelect(session.id)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            borderLeft: session.id === selectedId ? '3px solid var(--accent)' : '3px solid transparent',
            background: session.id === selectedId ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelect(session.id); }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {session.templateName}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 2,
          }}>
            {session.prompt}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
            {formatRelativeTime(session.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupByStatus(sessions: AgentSession[]) {
  const active: AgentSession[] = [];
  const completed: AgentSession[] = [];
  const failed: AgentSession[] = [];

  for (const session of sessions) {
    if (session.status === 'running' || session.status === 'paused') {
      active.push(session);
    } else if (session.status === 'completed') {
      completed.push(session);
    } else {
      failed.push(session);
    }
  }

  return { active, completed, failed };
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}
