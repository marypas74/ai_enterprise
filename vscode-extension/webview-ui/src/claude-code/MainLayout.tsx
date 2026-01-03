import React, { useState, useCallback, useEffect, useRef } from 'react';
import WelcomeHero from './WelcomeHero';
import FloatingInput from './FloatingInput';
import MessageArea from './MessageArea';
import KanbanPanel from './KanbanPanel';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface Project {
  id: number;
  name: string;
  description?: string;
  color: string;
}

interface Card {
  id: number;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  column_id: number;
  assignee_name?: string;
  due_date?: string;
}

interface Column {
  id: number;
  name: string;
  color: string;
  cards: Card[];
}

interface VSCodeAPI {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
}

// Get VS Code API
const vscode: VSCodeAPI = (window as any).acquireVsCodeApi
  ? (window as any).acquireVsCodeApi()
  : { postMessage: () => {}, getState: () => ({}), setState: () => {} };

type ActiveTab = 'chat' | 'kanban';

/**
 * MainLayout - Enterprise AI Panel main component
 */
const MainLayout: React.FC = () => {
  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');

  // Kanban state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [columns, setColumns] = useState<Column[]>([]);
  const [kanbanAccessDenied, setKanbanAccessDenied] = useState<{ message: string; groups?: any[] } | null>(null);

  // Version state
  const [versionInfo, setVersionInfo] = useState<{
    extension: string;
    backend?: { version: string; buildTime: string };
  }>({ extension: '2.9.1' });

  const streamingRef = useRef('');
  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'setAuthenticated':
          setIsAuthenticated(payload?.authenticated ?? false);
          setUser(payload?.user || null);
          if (payload?.models) {
            setModels(payload.models);
            if (payload.models.length > 0 && !selectedModel) {
              setSelectedModel(payload.models[0].id);
            }
          }
          // Load projects when authenticated
          if (payload?.authenticated) {
            vscode.postMessage({ type: 'loadProjects' });
          }
          break;

        case 'updateModels':
          if (payload?.models) {
            setModels(payload.models);
          }
          if (payload?.selected) {
            setSelectedModel(payload.selected);
          }
          break;

        case 'streamStart':
          setIsLoading(false);
          streamingRef.current = '';
          setStreamingContent('');
          break;

        case 'streamChunk':
          if (payload?.content) {
            streamingRef.current += payload.content;
            setStreamingContent(streamingRef.current);
          }
          break;

        case 'streamEnd':
          if (streamingRef.current) {
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: streamingRef.current,
                timestamp: new Date(),
              },
            ]);
          }
          streamingRef.current = '';
          setStreamingContent('');
          break;

        case 'addMessage':
          if (payload) {
            setMessages((prev) => [
              ...prev,
              {
                id: payload.id || generateId(),
                role: payload.role,
                content: payload.content,
                timestamp: new Date(payload.timestamp || Date.now()),
              },
            ]);
          }
          setIsLoading(false);
          break;

        case 'setLoading':
          setIsLoading(payload?.loading ?? false);
          break;

        case 'clearMessages':
          setMessages([]);
          setStreamingContent('');
          streamingRef.current = '';
          break;

        // Kanban messages
        case 'setProjects':
          const loadedProjects = payload?.projects || [];
          setProjects(loadedProjects);
          // Auto-select first project if only one exists
          if (loadedProjects.length === 1 && !selectedProject) {
            setSelectedProject(loadedProjects[0].id);
            vscode.postMessage({ type: 'selectProject', projectId: loadedProjects[0].id });
          }
          break;

        case 'setKanbanColumns':
          console.log('Received columns:', payload?.columns);
          setColumns(payload?.columns || []);
          break;

        case 'kanbanCardUpdated':
          // Refresh the board
          if (selectedProject) {
            vscode.postMessage({ type: 'selectProject', projectId: selectedProject });
          }
          break;

        case 'kanbanNoteAdded':
          // Show confirmation
          if (payload?.success) {
            // Card note was added successfully
          }
          break;

        case 'kanbanAccessDenied':
          setKanbanAccessDenied({
            message: payload?.message || 'Kanban access denied',
            groups: payload?.groups
          });
          break;

        case 'versionInfo':
          setVersionInfo({
            extension: payload?.extension || '2.9.1',
            backend: payload?.backend
          });
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Restore state
    const savedState = vscode.getState();
    if (savedState?.messages) {
      setMessages(savedState.messages);
    }
    if (savedState?.activeTab) {
      setActiveTab(savedState.activeTab);
    }

    // Request version info
    vscode.postMessage({ type: 'getVersionInfo' });

    return () => window.removeEventListener('message', handleMessage);
  }, [selectedModel, selectedProject]);

  // Save state when messages or tab changes
  useEffect(() => {
    vscode.setState({ messages, activeTab });
  }, [messages, activeTab]);

  // Send message
  const handleSend = useCallback((content: string) => {
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    vscode.postMessage({ type: 'send', message: content });
  }, []);

  // Action handlers
  const handleCopy = useCallback((text: string) => {
    vscode.postMessage({ type: 'copy', text });
  }, []);

  const handleRun = useCallback((command: string) => {
    vscode.postMessage({ type: 'runCommand', command });
  }, []);

  const handleApply = useCallback((code: string, language: string) => {
    vscode.postMessage({ type: 'applyCode', code, language });
  }, []);

  const handleLogin = useCallback(() => {
    vscode.postMessage({ type: 'login' });
  }, []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setStreamingContent('');
    vscode.postMessage({ type: 'newChat' });
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    setShowModelDropdown(false);
    vscode.postMessage({ type: 'selectModel', modelId });
  }, []);

  // Kanban handlers
  const handleSelectProject = useCallback((projectId: number) => {
    setSelectedProject(projectId);
    vscode.postMessage({ type: 'selectProject', projectId });
  }, []);

  const handleUpdateCard = useCallback((cardId: number, columnId: string | number, notes?: string) => {
    vscode.postMessage({
      type: 'moveCard',
      cardId,
      columnId,
      notes,
    });
  }, []);

  const handleAddNote = useCallback((cardId: number, note: string) => {
    vscode.postMessage({
      type: 'addCardComment',
      cardId,
      content: note,
      projectId: selectedProject,
    });
  }, [selectedProject]);

  // Not authenticated - show login
  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-logo">
          <svg width="80" height="60" viewBox="0 0 64 48">
            <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1 0-2 .1-3 .4C47 4 42.5 0 37 0c-6.5 0-12 5-12.5 11.5C20 12 16 16.5 16 22c0 6 5 11 11 11h25z" fill="#2196F3"/>
            <path d="M48 32c4 0 7.5-3 8-7H10c.5 4 4 7 8 7h30z" fill="#1976D2"/>
            <circle cx="32" cy="24" r="10" fill="#7C4DFF"/>
            <circle cx="32" cy="24" r="2" fill="white"/>
            <circle cx="26" cy="20" r="1.5" fill="white"/>
            <circle cx="38" cy="20" r="1.5" fill="white"/>
            <circle cx="26" cy="28" r="1.5" fill="white"/>
            <circle cx="38" cy="28" r="1.5" fill="white"/>
            <line x1="32" y1="24" x2="26" y2="20" stroke="white" strokeWidth="1.5"/>
            <line x1="32" y1="24" x2="38" y2="20" stroke="white" strokeWidth="1.5"/>
            <line x1="32" y1="24" x2="26" y2="28" stroke="white" strokeWidth="1.5"/>
            <line x1="32" y1="24" x2="38" y2="28" stroke="white" strokeWidth="1.5"/>
          </svg>
        </div>
        <h1 className="login-title">Enterprise AI</h1>
        <p className="login-subtitle">Connect to start your AI coding session</p>
        <button className="login-button" onClick={handleLogin}>
          Login to Enterprise AI
        </button>
        <p className="login-version">v{versionInfo.extension}</p>
      </div>
    );
  }

  const hasMessages = messages.length > 0 || streamingContent;
  const currentModel = models.find((m) => m.id === selectedModel);

  return (
    <div className="claude-container">
      {/* Header */}
      <header className="claude-header">
        {/* Left: History button */}
        <div className="claude-header-left">
          <button
            className="claude-header-btn"
            onClick={() => setShowHistory(!showHistory)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            History
          </button>
        </div>

        {/* Center: Title */}
        <div className="claude-header-center">
          <svg width="28" height="20" viewBox="0 0 64 48" style={{ marginRight: 8 }}>
            <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1 0-2 .1-3 .4C47 4 42.5 0 37 0c-6.5 0-12 5-12.5 11.5C20 12 16 16.5 16 22c0 6 5 11 11 11h25z" fill="#2196F3"/>
            <path d="M48 32c4 0 7.5-3 8-7H10c.5 4 4 7 8 7h30z" fill="#1976D2"/>
            <circle cx="32" cy="24" r="10" fill="#7C4DFF"/>
            <circle cx="32" cy="24" r="2" fill="white"/>
            <circle cx="26" cy="20" r="1.5" fill="white"/>
            <circle cx="38" cy="20" r="1.5" fill="white"/>
            <circle cx="26" cy="28" r="1.5" fill="white"/>
            <circle cx="38" cy="28" r="1.5" fill="white"/>
          </svg>
          <span className="claude-title">Enterprise AI</span>
          <span className="version-badge" title={`Ext: v${versionInfo.extension}${versionInfo.backend ? ` | API: v${versionInfo.backend.version}` : ''}`}>
            v{versionInfo.extension}
          </span>
        </div>

        {/* Right: Model selector & New chat */}
        <div className="claude-header-right">
          {/* Model selector */}
          <div className="model-selector">
            <button
              className="model-selector-btn"
              onClick={() => setShowModelDropdown(!showModelDropdown)}
            >
              {currentModel?.name || 'Select Model'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showModelDropdown && (
              <div className="model-selector-dropdown">
                {models.map((model) => (
                  <button
                    key={model.id}
                    className={`model-option ${model.id === selectedModel ? 'selected' : ''}`}
                    onClick={() => handleModelSelect(model.id)}
                  >
                    <span className="model-provider">{model.provider}</span>
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* New chat button */}
          <button className="claude-header-btn" onClick={handleNewChat} title="New chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="panel-tabs">
        <button
          className={`panel-tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Chat
        </button>
        <button
          className={`panel-tab ${activeTab === 'kanban' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('kanban');
            // Load projects if not loaded
            if (projects.length === 0) {
              vscode.postMessage({ type: 'loadProjects' });
            }
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          Kanban
        </button>
      </div>

      {/* Main content area */}
      <div className="claude-main">
        {activeTab === 'chat' ? (
          hasMessages ? (
            <MessageArea
              messages={messages}
              isLoading={isLoading}
              streamingContent={streamingContent}
              onCopy={handleCopy}
              onRun={handleRun}
              onApply={handleApply}
            />
          ) : (
            <WelcomeHero />
          )
        ) : (
          <KanbanPanel
            vscode={vscode}
            projects={projects}
            columns={columns}
            selectedProject={selectedProject}
            accessDenied={kanbanAccessDenied}
            onSelectProject={handleSelectProject}
            onUpdateCard={handleUpdateCard}
            onAddNote={handleAddNote}
          />
        )}
      </div>

      {/* Floating Input - only show in chat tab */}
      {activeTab === 'chat' && (
        <FloatingInput
          onSend={handleSend}
          disabled={isLoading}
          placeholder={isLoading ? 'Waiting for response...' : 'Ask Enterprise AI anything...'}
        />
      )}
    </div>
  );
};

export default MainLayout;
