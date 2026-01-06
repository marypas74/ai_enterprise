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
  status?: string;
  column_id: string | number;
  assignee_name?: string;
  due_date?: string;
  tags?: string[];
  checklist?: { id: number; text: string; completed: boolean }[];
}

interface Column {
  id: number;
  name: string;
  color: string;
  cards: Card[];
}

interface Conversation {
  id: number;
  title: string;
  model: string;
  provider: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
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

// ============================================
// GLOBAL SINGLETON FLAGS - Survive re-mounts
// ============================================
let GLOBAL_PROJECTS_LOADED = false;
let GLOBAL_INITIAL_LOAD_DONE = false;
let GLOBAL_LOAD_PROJECTS_CALL_COUNT = 0;
let GLOBAL_LAST_LOAD_TIME = 0;
const CIRCUIT_BREAKER_MAX_CALLS = 3;
const CIRCUIT_BREAKER_WINDOW_MS = 2000;

// Reset globals only on full page refresh (not component re-mount)
if (typeof window !== 'undefined' && !(window as any).__KANBAN_GLOBALS_INITIALIZED) {
  (window as any).__KANBAN_GLOBALS_INITIALIZED = true;
  console.log('[Kanban] Globals initialized');
}

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

  // Split View / Task Execution state
  const [splitViewMode, setSplitViewMode] = useState(false);
  const [activeTask, setActiveTask] = useState<Card | null>(null);

  // History state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Version state
  const [versionInfo, setVersionInfo] = useState<{
    extension: string;
    backend?: { version: string; buildTime: string };
  }>({ extension: '2.9.14' });

  const streamingRef = useRef('');
  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  // Circuit breaker function - prevents DDOS on backend
  const safeLoadProjects = useCallback(() => {
    const now = Date.now();

    // Check if already loaded
    if (GLOBAL_PROJECTS_LOADED) {
      console.log('[Kanban] Skipping loadProjects - already loaded globally');
      return;
    }

    // Circuit breaker: reset counter if window expired
    if (now - GLOBAL_LAST_LOAD_TIME > CIRCUIT_BREAKER_WINDOW_MS) {
      GLOBAL_LOAD_PROJECTS_CALL_COUNT = 0;
    }

    // Circuit breaker: check max calls
    GLOBAL_LOAD_PROJECTS_CALL_COUNT++;
    GLOBAL_LAST_LOAD_TIME = now;

    if (GLOBAL_LOAD_PROJECTS_CALL_COUNT > CIRCUIT_BREAKER_MAX_CALLS) {
      console.error(`[Kanban] CIRCUIT BREAKER TRIGGERED: ${GLOBAL_LOAD_PROJECTS_CALL_COUNT} calls in ${CIRCUIT_BREAKER_WINDOW_MS}ms`);
      GLOBAL_PROJECTS_LOADED = true; // Stop further attempts
      return;
    }

    // Mark as loaded BEFORE sending message
    GLOBAL_PROJECTS_LOADED = true;
    console.log('[Kanban] Sending loadProjects message (call #' + GLOBAL_LOAD_PROJECTS_CALL_COUNT + ')');
    vscode.postMessage({ type: 'loadProjects' });
  }, []);

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
            setSelectedModel((current) => {
              if (!current && payload.models.length > 0) {
                return payload.models[0].id;
              }
              return current;
            });
          }
          // Load projects when authenticated (only once) - uses global flag
          if (payload?.authenticated && !GLOBAL_PROJECTS_LOADED) {
            safeLoadProjects();
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
          console.log('[MainLayout] streamStart received');
          setIsLoading(true); // Keep loading indicator until we get content
          streamingRef.current = '';
          setStreamingContent('');
          break;

        case 'streamChunk':
          try {
            const content = payload?.content || '';
            if (content) {
              console.log(`[MainLayout] streamChunk: ${content.length} chars`);
              streamingRef.current += content;
              setStreamingContent(streamingRef.current);
              setIsLoading(false); // Content arriving, hide "Thinking..."
            }
          } catch (err) {
            console.error('[MainLayout] Error processing streamChunk:', err);
          }
          break;

        case 'streamEnd':
          console.log(`[MainLayout] streamEnd, total: ${streamingRef.current.length} chars`);
          setIsLoading(false);
          if (streamingRef.current && streamingRef.current.trim()) {
            const finalContent = streamingRef.current;
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: finalContent,
                timestamp: new Date(),
              },
            ]);
          }
          streamingRef.current = '';
          setStreamingContent('');
          break;

        case 'streamError':
          console.error('[MainLayout] streamError:', payload?.error);
          setIsLoading(false);
          // Add error message to chat
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'system',
              content: `⚠️ Error: ${payload?.error || 'Stream failed'}`,
              timestamp: new Date(),
            },
          ]);
          streamingRef.current = '';
          setStreamingContent('');
          break;

        // Tool use/result handlers for agentic mode
        case 'toolUse':
          console.log('[MainLayout] toolUse:', payload);
          // Display tool being used in the stream
          const toolName = payload?.name || 'unknown';
          const toolInput = payload?.input;
          let toolMsg = `🔧 **Using tool: ${toolName}**`;
          if (toolInput?.path) {
            toolMsg += `\n   📁 Path: \`${toolInput.path}\``;
          }
          streamingRef.current += `\n\n${toolMsg}\n`;
          setStreamingContent(streamingRef.current);
          break;

        case 'toolResult':
          console.log('[MainLayout] toolResult:', payload);
          // Display tool result
          const resultName = payload?.name || 'unknown';
          const success = payload?.success;
          const output = payload?.output;
          const error = payload?.error;

          let resultMsg = success
            ? `✅ **${resultName}** completed`
            : `❌ **${resultName}** failed: ${error}`;

          if (success && output?.path) {
            resultMsg += ` - \`${output.path}\``;
          }
          if (success && output?.message) {
            resultMsg += ` (${output.message})`;
          }

          streamingRef.current += `\n${resultMsg}\n`;
          setStreamingContent(streamingRef.current);
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
          // Auto-select first project if only one exists (use functional update to avoid stale closure)
          if (loadedProjects.length === 1) {
            setSelectedProject((current) => {
              if (!current) {
                vscode.postMessage({ type: 'selectProject', projectId: loadedProjects[0].id });
                return loadedProjects[0].id;
              }
              return current;
            });
          }
          break;

        case 'setKanbanColumns':
          setColumns(payload?.columns || []);
          break;

        case 'kanbanCardUpdated':
          // Refresh the board - use ref to get current project
          setSelectedProject((current) => {
            if (current) {
              vscode.postMessage({ type: 'selectProject', projectId: current });
            }
            return current;
          });
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
            extension: payload?.extension || '2.9.14',
            backend: payload?.backend
          });
          break;

        // History messages
        case 'setHistory':
          setConversations(payload?.conversations || []);
          setHistoryError(payload?.error || null);
          setHistoryLoading(false);
          break;

        case 'loadedConversation':
          if (payload) {
            setCurrentConversationId(payload.conversationId);
            setMessages(payload.messages.map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.timestamp)
            })));
            // Select the model if specified
            if (payload.model) {
              setSelectedModel(payload.model);
            }
            // Close history panel
            setShowHistory(false);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Initial setup - only run once (uses global flag)
    if (!GLOBAL_INITIAL_LOAD_DONE) {
      GLOBAL_INITIAL_LOAD_DONE = true;
      console.log('[Kanban] Component mounted - initial setup');

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
    } else {
      console.log('[Kanban] Component re-mounted - skipping initial setup');
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []); // Empty dependency array - only run once on mount

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
      projectId: selectedProject, // Required for API authorization
    });
  }, [selectedProject]);

  const handleAddNote = useCallback((cardId: number, note: string) => {
    vscode.postMessage({
      type: 'addCardComment',
      cardId,
      content: note,
      projectId: selectedProject,
    });
  }, [selectedProject]);

  const handleDeleteCard = useCallback((cardId: number) => {
    vscode.postMessage({
      type: 'deleteCard',
      cardId,
      projectId: selectedProject,
    });
  }, [selectedProject]);

  const handleEditCard = useCallback((card: { id: number; title: string; description?: string; priority: string }) => {
    vscode.postMessage({
      type: 'editCard',
      cardId: card.id,
      title: card.title,
      description: card.description,
      priority: card.priority,
      projectId: selectedProject,
    });
  }, [selectedProject]);

  // Execute Task with AI - Opens split view and sends structured prompt
  // CRITICAL: moveCard is FIRE-AND-FORGET, never blocks the chat stream
  const handleExecuteTask = useCallback((card: Card) => {
    // Build structured prompt from card data
    const checklistItems = card.checklist?.map(item => `- [${item.completed ? 'x' : ' '}] ${item.text}`).join('\n') || '';
    const tagsInfo = card.tags?.length ? `TAGS: ${card.tags.join(', ')}` : '';

    const prompt = `## TASK EXECUTION REQUEST

**CONTEXT:** I am working on the task: "${card.title}"

**PRIORITY:** ${card.priority.toUpperCase()}

${card.description ? `**DESCRIPTION:**\n${card.description}` : ''}

${checklistItems ? `**REQUIREMENTS/CHECKLIST:**\n${checklistItems}` : ''}

${tagsInfo}

---

Please analyze this task and help me implement it. When generating code, use the save_file tool to write files directly to the project folder. Do NOT just print code - actually save it.`;

    // === STEP 1: Immediately set up UI (NEVER wait for anything) ===
    setActiveTask(card);
    setSplitViewMode(true);
    setMessages([]);
    setStreamingContent('');
    streamingRef.current = '';

    // Add user message with the prompt
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages([userMessage]);
    setIsLoading(true);

    // === STEP 2: Start AI chat stream IMMEDIATELY ===
    vscode.postMessage({
      type: 'sendAgentic',
      message: prompt,
      projectId: selectedProject,
    });

    // === STEP 3: BYPASSED - moveCard DISABLED to prevent 500 error blocking ===
    // TODO: Re-enable when backend is fixed
    console.warn('[ExecuteTask] BYPASS: Skipping card move to prevent crash. Chat starting...');
    /* DISABLED - API 500 workaround
    setTimeout(() => {
      try {
        const inProgressColumn = columns.find(col =>
          col.name.toLowerCase().includes('progress') ||
          col.name.toLowerCase().includes('corso') ||
          col.name.toLowerCase() === 'in progress' ||
          col.name.toLowerCase() === 'doing'
        );

        if (inProgressColumn && card.column_id !== inProgressColumn.id && selectedProject) {
          console.log(`[ExecuteTask] ASYNC: Moving card ${card.id} to "In Progress"`);
          vscode.postMessage({
            type: 'moveCard',
            cardId: card.id,
            columnId: inProgressColumn.id,
            projectId: selectedProject,
          });
        }
      } catch (err) {
        console.warn('[ExecuteTask] moveCard failed (swallowed):', err);
      }
    }, 100);
    */ // END DISABLED

  }, [columns, selectedProject]);

  // Close split view and return to normal Kanban
  const handleCloseSplitView = useCallback(() => {
    setSplitViewMode(false);
    setActiveTask(null);
  }, []);

  // History handlers
  const handleLoadHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError(null); // Clear previous error
    vscode.postMessage({ type: 'loadHistory' });
  }, []);

  const handleSelectConversation = useCallback((conversationId: number) => {
    vscode.postMessage({ type: 'loadConversation', conversationId });
  }, []);

  const handleDeleteConversation = useCallback((conversationId: number) => {
    if (confirm('Delete this conversation?')) {
      vscode.postMessage({ type: 'deleteConversation', conversationId });
    }
  }, []);

  // Load history when panel opens
  useEffect(() => {
    if (showHistory && conversations.length === 0 && !historyLoading) {
      handleLoadHistory();
    }
  }, [showHistory, conversations.length, historyLoading, handleLoadHistory]);

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

  // Show MessageArea if: there are messages, OR streaming content exists, OR we're loading (just sent a message)
  const hasMessages = messages.length > 0 || streamingContent || isLoading;
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
            // Load projects if not already loaded - uses global flag & circuit breaker
            if (projects.length === 0 && !GLOBAL_PROJECTS_LOADED) {
              safeLoadProjects();
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
      <div className={`claude-main ${splitViewMode ? 'split-view' : ''}`}>
        {splitViewMode ? (
          // Split View Mode: Kanban (left) + Chat (right)
          <>
            <div className="split-kanban">
              {/* Active Task Header */}
              {activeTask && (
                <div className="active-task-header">
                  <div className="active-task-info">
                    <span className={`task-priority priority-${activeTask.priority}`} />
                    <span className="task-title">{activeTask.title}</span>
                  </div>
                  <button className="close-split-btn" onClick={handleCloseSplitView} title="Close split view">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
              <KanbanPanel
                projects={projects}
                columns={columns}
                selectedProject={selectedProject}
                accessDenied={kanbanAccessDenied}
                onSelectProject={handleSelectProject}
                onUpdateCard={handleUpdateCard}
                onAddNote={handleAddNote}
                onDeleteCard={handleDeleteCard}
                onEditCard={handleEditCard}
                onExecuteTask={handleExecuteTask}
                isCompact={true}
              />
            </div>
            <div className="split-chat">
              <MessageArea
                messages={messages}
                isLoading={isLoading}
                streamingContent={streamingContent}
                onCopy={handleCopy}
                onRun={handleRun}
                onApply={handleApply}
              />
              <FloatingInput
                onSend={handleSend}
                disabled={isLoading}
                placeholder={isLoading ? 'AI is generating...' : 'Continue the conversation...'}
              />
            </div>
          </>
        ) : activeTab === 'chat' ? (
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
            projects={projects}
            columns={columns}
            selectedProject={selectedProject}
            accessDenied={kanbanAccessDenied}
            onSelectProject={handleSelectProject}
            onUpdateCard={handleUpdateCard}
            onAddNote={handleAddNote}
            onDeleteCard={handleDeleteCard}
            onEditCard={handleEditCard}
            onExecuteTask={handleExecuteTask}
          />
        )}
      </div>

      {/* Floating Input - only show in chat tab (not split view) */}
      {activeTab === 'chat' && !splitViewMode && (
        <FloatingInput
          onSend={handleSend}
          disabled={isLoading}
          placeholder={isLoading ? 'Waiting for response...' : 'Ask Enterprise AI anything...'}
        />
      )}

      {/* History Sidebar */}
      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)}>
          <div className="history-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="history-header">
              <h3>Chat History</h3>
              <button className="history-close" onClick={() => setShowHistory(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="history-list">
              {historyLoading ? (
                <div className="history-loading">Loading...</div>
              ) : historyError ? (
                <div className="history-error">{historyError}</div>
              ) : conversations.length === 0 ? (
                <div className="history-empty">No conversations yet</div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`history-item ${currentConversationId === conv.id ? 'active' : ''}`}
                    onClick={() => handleSelectConversation(conv.id)}
                  >
                    <div className="history-item-title">{conv.title || 'Untitled'}</div>
                    <div className="history-item-meta">
                      <span className="history-item-model">{conv.provider}</span>
                      <span className="history-item-date">
                        {new Date(conv.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      className="history-item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConversation(conv.id);
                      }}
                      title="Delete conversation"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            <button className="history-refresh" onClick={handleLoadHistory}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainLayout;
