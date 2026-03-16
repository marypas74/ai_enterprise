import React, { useEffect, useRef } from 'react';
import type { LogEntry } from '../shared/types';

interface SessionLogViewerProps {
  logs: LogEntry[];
}

export function SessionLogViewer({ logs }: SessionLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !autoScrollRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [logs]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const threshold = 50;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    autoScrollRef.current = isNearBottom;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        fontSize: 12,
        lineHeight: 1.6,
        padding: '8px 12px',
        background: 'var(--bg-secondary)',
      }}
    >
      {logs.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', padding: '16px 0' }}>
          Waiting for log output...
        </div>
      )}
      {logs.map((entry, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 8,
            padding: '1px 0',
            color: getLevelColor(entry.level),
          }}
        >
          <span style={{ color: 'var(--text-secondary)', flexShrink: 0, minWidth: 75 }}>
            {formatTimestamp(entry.timestamp)}
          </span>
          <span style={{
            flexShrink: 0,
            minWidth: 40,
            fontWeight: entry.level === 'error' ? 600 : 400,
          }}>
            [{entry.level.toUpperCase()}]
          </span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {entry.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function getLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'var(--error)';
    case 'warn': return 'var(--vscode-editorWarning-foreground, #d29922)';
    case 'debug': return 'var(--text-secondary)';
    default: return 'var(--text-primary)';
  }
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}
