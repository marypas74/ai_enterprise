import { useState, useEffect } from 'react';
import { useAgentStore, AgentSession } from '../hooks/useAgentStore';
import { api } from '../services/api';
import { useAuthStore } from '../hooks/useAuthStore';
import {
  Plus,
  Bot,
  Cpu,
  Zap,
  X,
  LayoutDashboard,
  MessageSquare,
  Shield,
} from 'lucide-react';
import clsx from 'clsx';
import Dashboard from './auto-claude/Dashboard';
import SessionsList from './auto-claude/SessionsList';
import SessionDetail from './auto-claude/SessionDetail';
import CreateSessionModal from './auto-claude/CreateSessionModal';
import TemplatesView from './auto-claude/TemplatesView';

export default function AutoClaudePage() {
  const { error, clearError, connectWebSocket, disconnectWebSocket } = useAgentStore();
  const { user } = useAuthStore();
  const [view, setView] = useState<'dashboard' | 'sessions' | 'templates'>('dashboard');
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
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
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left',
              view === 'dashboard' && !selectedSession
                ? 'bg-primary-100 text-primary-700'
                : 'text-surface-600 hover:bg-surface-100'
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => { setView('sessions'); setSelectedSession(null); }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left mt-1',
              view === 'sessions' && !selectedSession
                ? 'bg-primary-100 text-primary-700'
                : 'text-surface-600 hover:bg-surface-100'
            )}
          >
            <Cpu className="w-4 h-4" />
            Sessions
          </button>
          <button
            onClick={() => { setView('templates'); setSelectedSession(null); }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left mt-1',
              view === 'templates'
                ? 'bg-primary-100 text-primary-700'
                : 'text-surface-600 hover:bg-surface-100'
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
