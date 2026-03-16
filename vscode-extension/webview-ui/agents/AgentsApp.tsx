import React, { useState, useCallback } from 'react';
import { useVsCodeMessage, usePostMessage } from '../shared/hooks/useVsCodeApi';
import { useAuth } from '../shared/hooks/useAuth';
import type { AgentSession, LogEntry, SseState } from '../shared/types';
import { SessionList } from './SessionList';
import { SessionLogViewer } from './SessionLogViewer';
import { SessionActions } from './SessionActions';

type ExtensionMessage =
  | { type: 'setSessions'; payload: { sessions: AgentSession[] } }
  | { type: 'sessionUpdated'; payload: { session: AgentSession } }
  | { type: 'logEntry'; payload: LogEntry }
  | { type: 'logHistory'; payload: { entries: LogEntry[] } }
  | { type: 'sseStatus'; payload: SseState }
  | { type: 'setAuthenticated'; payload: { user: { id: number; email: string; name: string; role: string } } }
  | { type: 'setUnauthenticated' };

export function AgentsApp() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sseStatus, setSseStatus] = useState<SseState>({ connected: false });
  const { isAuthenticated, setAuthenticated, setUnauthenticated } = useAuth();
  const postMessage = usePostMessage();

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  useVsCodeMessage<ExtensionMessage>((msg) => {
    switch (msg.type) {
      case 'setSessions':
        setSessions(msg.payload.sessions);
        break;
      case 'sessionUpdated': {
        const updated = msg.payload.session;
        setSessions((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s)),
        );
        break;
      }
      case 'logEntry':
        setLogs((prev) => [...prev, msg.payload]);
        break;
      case 'logHistory':
        setLogs(msg.payload.entries);
        break;
      case 'sseStatus':
        setSseStatus(msg.payload);
        break;
      case 'setAuthenticated':
        setAuthenticated(msg.payload.user);
        break;
      case 'setUnauthenticated':
        setUnauthenticated();
        setSessions([]);
        setLogs([]);
        setSelectedSessionId(null);
        break;
    }
  });

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setLogs([]);
    postMessage({ type: 'selectSession', payload: { sessionId } });
  }, [postMessage]);

  const handlePause = useCallback((sessionId: string) => {
    postMessage({ type: 'pauseSession', payload: { sessionId } });
  }, [postMessage]);

  const handleResume = useCallback((sessionId: string) => {
    postMessage({ type: 'resumeSession', payload: { sessionId } });
  }, [postMessage]);

  const handleCancel = useCallback((sessionId: string) => {
    postMessage({ type: 'cancelSession', payload: { sessionId } });
  }, [postMessage]);

  const handleRefresh = useCallback(() => {
    postMessage({ type: 'loadSessions' });
  }, [postMessage]);

  // Signal ready on mount
  React.useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Login required. Use <strong>Enterprise AI: Login</strong> from the Command Palette.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{
        width: 280,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <strong>Agent Sessions</strong>
          <button
            onClick={handleRefresh}
            style={{ padding: '2px 8px', fontSize: '12px' }}
            title="Refresh sessions"
          >
            Refresh
          </button>
        </div>
        <SessionList
          sessions={sessions}
          selectedId={selectedSessionId}
          onSelect={handleSelectSession}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedSession ? (
          <>
            <div style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <strong>{selectedSession.templateName}</strong>
                <span style={{
                  marginLeft: 8,
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 11,
                  background: getStatusColor(selectedSession.status),
                  color: '#fff',
                }}>
                  {selectedSession.status}
                </span>
              </div>
              <SessionActions
                session={selectedSession}
                onPause={handlePause}
                onResume={handleResume}
                onCancel={handleCancel}
              />
            </div>

            {!sseStatus.connected && sseStatus.message && (
              <div className="error-banner">
                {sseStatus.message}
              </div>
            )}

            <SessionLogViewer logs={logs} />

            {selectedSession.error && (
              <div className="error-banner" style={{ margin: '0 8px 8px 8px' }}>
                Error: {selectedSession.error}
              </div>
            )}
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
          }}>
            Select a session to view logs
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'running': return '#2ea043';
    case 'paused': return '#d29922';
    case 'completed': return '#388bfd';
    case 'failed': return '#f85149';
    case 'cancelled': return '#8b949e';
    default: return '#8b949e';
  }
}
