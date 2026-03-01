import React, { useState, useCallback, useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import LoadingIndicator from './LoadingIndicator';
import ScrollToBottomButton from './ScrollToBottomButton';
import { useAutoScroll, useScrollOnChange } from '../hooks/useAutoScroll';
import { ChatMessage, VSCodeAPI, AvailableModel, AuthState, ExtensionMessage } from '../types';
import { BotIconType } from './BotIcon';

// Get VS Code API
const vscode: VSCodeAPI = (window as any).acquireVsCodeApi
  ? (window as any).acquireVsCodeApi()
  : {
    postMessage: () => { },
    getState: () => ({}),
    setState: () => { },
  };

interface ChatContainerProps {
  initialMessages?: ChatMessage[];
}

const ChatContainer: React.FC<ChatContainerProps> = ({ initialMessages = [] }) => {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [authState, setAuthState] = useState<AuthState>({ isAuthenticated: false });
  const [botIconType, setBotIconType] = useState<BotIconType>('default');

  // Auto-scroll hook
  const { containerRef, isAtBottom, scrollToBottom, handleScroll } = useAutoScroll({
    threshold: 100,
    smooth: true,
  });

  // Auto-scroll when messages change (only if at bottom)
  useScrollOnChange(containerRef, messages, isAtBottom);

  // Reference for streaming message content accumulation
  const streamingContentRef = useRef('');

  // Generate unique ID
  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Send message to extension
  const sendMessage = useCallback((content: string) => {
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Send to extension host
    vscode.postMessage({
      type: 'send',
      message: content,
    });

    // Save state
    vscode.setState({ messages: [...messages, userMessage] });
  }, [messages]);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'streamStart':
          // Start new streaming message
          const newMessageId = generateId();
          setStreamingMessageId(newMessageId);
          streamingContentRef.current = '';
          setIsLoading(false);

          setMessages(prev => [
            ...prev,
            {
              id: newMessageId,
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
            },
          ]);
          break;

        case 'streamChunk':
          // Append chunk to streaming message
          if (payload?.content) {
            streamingContentRef.current += payload.content;

            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, content: streamingContentRef.current }
                  : msg
              )
            );
          }
          break;

        case 'streamEnd':
          // Mark streaming as complete
          setMessages(prev =>
            prev.map(msg =>
              msg.id === streamingMessageId
                ? { ...msg, isStreaming: false }
                : msg
            )
          );
          setStreamingMessageId(null);
          streamingContentRef.current = '';
          break;

        case 'addMessage':
          // Add complete message (non-streaming)
          if (payload) {
            setMessages(prev => [
              ...prev,
              {
                ...payload,
                id: payload.id || generateId(),
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
          break;

        case 'updateModels':
          if (payload?.models) {
            setModels(payload.models);
            if (payload.selected) {
              setSelectedModel(payload.selected);
            }
          }
          break;

        case 'setAuthenticated':
          setAuthState({
            isAuthenticated: payload?.authenticated ?? false,
            user: payload?.user,
          });
          if (payload?.models) {
            setModels(payload.models);
          }
          break;

        case 'insertCode':
          // Insert code into input (handled by ChatInput)
          break;

        case 'updateSettings':
          // Update settings like bot icon
          if (payload?.botIconStyle) {
            setBotIconType(payload.botIconStyle as BotIconType);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Restore state if available
    const savedState = vscode.getState();
    if (savedState?.messages) {
      setMessages(savedState.messages);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [streamingMessageId]);

  // Code action handlers
  const handleCopyCode = useCallback((code: string) => {
    vscode.postMessage({ type: 'copy', text: code });
  }, []);

  const handleRunCommand = useCallback((command: string, language: string) => {
    vscode.postMessage({ type: 'runCommand', command });
  }, []);

  const handleApplyCode = useCallback((code: string, language: string) => {
    vscode.postMessage({ type: 'applyCode', code, language });
  }, []);

  // Model selection
  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    setSelectedModel(modelId);
    vscode.postMessage({ type: 'selectModel', modelId });
  }, []);

  // New chat
  const handleNewChat = useCallback(() => {
    setMessages([]);
    vscode.postMessage({ type: 'clear' });
    vscode.setState({ messages: [] });
  }, []);

  // Login
  const handleLogin = useCallback(() => {
    vscode.postMessage({ type: 'login' });
  }, []);

  // Logout
  const handleLogout = useCallback(() => {
    vscode.postMessage({ type: 'logout' });
  }, []);

  // Render login screen if not authenticated
  if (!authState.isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-content">
          <h2>Enterprise AI Chat</h2>
          <p>Login to start chatting with AI</p>
          <button onClick={handleLogin} className="login-button">
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <div className="header-left">
          <h1 className="header-title">AI Chat</h1>
          {authState.user && (
            <span className="header-user">{authState.user.name}</span>
          )}
        </div>
        <div className="header-actions">
          {models.length > 0 && (
            <select
              value={selectedModel}
              onChange={handleModelChange}
              className="model-selector"
              aria-label="Select model"
            >
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={handleNewChat} className="header-btn" title="New chat">
            <NewChatIcon />
          </button>
          <button onClick={handleLogout} className="header-btn" title="Logout">
            <LogoutIcon />
          </button>
        </div>
      </header>

      {/* AI Act: Disclosure Banner (Art. 50) */}
      <div className="ai-disclosure-banner" style={{
        padding: '8px 12px',
        backgroundColor: 'var(--vscode-editorInfo-background, rgba(0, 120, 212, 0.1))',
        borderBottom: '1px solid var(--vscode-editorInfo-foreground, rgba(0, 120, 212, 0.3))',
        fontSize: '11px',
        color: 'var(--vscode-foreground)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span style={{ fontSize: '13px' }}>&#8505;</span>
        <span>Stai interagendo con un sistema di intelligenza artificiale. Le risposte sono generate da AI e potrebbero non essere accurate.</span>
      </div>

      {/* Messages area */}
      <div
        ref={containerRef}
        className="messages-container"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="empty-state">
            <WelcomeIcon />
            <h3>Welcome!</h3>
            <p>Ask me anything about your code</p>
            <div className="suggestions">
              <button
                onClick={() => sendMessage('Explain the selected code')}
                className="suggestion-btn"
              >
                Explain code
              </button>
              <button
                onClick={() => sendMessage('Find bugs in my code')}
                className="suggestion-btn"
              >
                Find bugs
              </button>
              <button
                onClick={() => sendMessage('Write unit tests')}
                className="suggestion-btn"
              >
                Write tests
              </button>
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map(message => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={message.isStreaming}
                botIconType={botIconType}
                onCopyCode={handleCopyCode}
                onRunCommand={handleRunCommand}
                onApplyCode={handleApplyCode}
              />
            ))}
            {isLoading && <LoadingIndicator />}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      <ScrollToBottomButton
        visible={!isAtBottom && messages.length > 0}
        onClick={scrollToBottom}
      />

      {/* Input area */}
      <ChatInput
        onSend={sendMessage}
        disabled={isLoading || !!streamingMessageId}
        placeholder={
          isLoading
            ? 'Waiting for response...'
            : 'Type a message... (Enter to send)'
        }
      />
    </div>
  );
};

// Icon components
const NewChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const WelcomeIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" className="welcome-icon">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </svg>
);

export default ChatContainer;
