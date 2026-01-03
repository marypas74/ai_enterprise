"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const MessageBubble_1 = __importDefault(require("./MessageBubble"));
const ChatInput_1 = __importDefault(require("./ChatInput"));
const LoadingIndicator_1 = __importDefault(require("./LoadingIndicator"));
const ScrollToBottomButton_1 = __importDefault(require("./ScrollToBottomButton"));
const useAutoScroll_1 = require("../hooks/useAutoScroll");
// Get VS Code API
const vscode = window.acquireVsCodeApi
    ? window.acquireVsCodeApi()
    : {
        postMessage: () => { },
        getState: () => ({}),
        setState: () => { },
    };
const ChatContainer = ({ initialMessages = [] }) => {
    // State
    const [messages, setMessages] = (0, react_1.useState)(initialMessages);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [streamingMessageId, setStreamingMessageId] = (0, react_1.useState)(null);
    const [models, setModels] = (0, react_1.useState)([]);
    const [selectedModel, setSelectedModel] = (0, react_1.useState)('');
    const [authState, setAuthState] = (0, react_1.useState)({ isAuthenticated: false });
    // Auto-scroll hook
    const { containerRef, isAtBottom, scrollToBottom, handleScroll } = (0, useAutoScroll_1.useAutoScroll)({
        threshold: 100,
        smooth: true,
    });
    // Auto-scroll when messages change (only if at bottom)
    (0, useAutoScroll_1.useScrollOnChange)(containerRef, messages, isAtBottom);
    // Reference for streaming message content accumulation
    const streamingContentRef = (0, react_1.useRef)('');
    // Generate unique ID
    const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // Send message to extension
    const sendMessage = (0, react_1.useCallback)((content) => {
        const userMessage = {
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
    (0, react_1.useEffect)(() => {
        const handleMessage = (event) => {
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
                        setMessages(prev => prev.map(msg => msg.id === streamingMessageId
                            ? { ...msg, content: streamingContentRef.current }
                            : msg));
                    }
                    break;
                case 'streamEnd':
                    // Mark streaming as complete
                    setMessages(prev => prev.map(msg => msg.id === streamingMessageId
                        ? { ...msg, isStreaming: false }
                        : msg));
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
    const handleCopyCode = (0, react_1.useCallback)((code) => {
        vscode.postMessage({ type: 'copy', text: code });
    }, []);
    const handleRunCommand = (0, react_1.useCallback)((command, language) => {
        vscode.postMessage({ type: 'runCommand', command });
    }, []);
    const handleApplyCode = (0, react_1.useCallback)((code, language) => {
        vscode.postMessage({ type: 'applyCode', code, language });
    }, []);
    // Model selection
    const handleModelChange = (0, react_1.useCallback)((e) => {
        const modelId = e.target.value;
        setSelectedModel(modelId);
        vscode.postMessage({ type: 'selectModel', modelId });
    }, []);
    // New chat
    const handleNewChat = (0, react_1.useCallback)(() => {
        setMessages([]);
        vscode.postMessage({ type: 'clear' });
        vscode.setState({ messages: [] });
    }, []);
    // Login
    const handleLogin = (0, react_1.useCallback)(() => {
        vscode.postMessage({ type: 'login' });
    }, []);
    // Logout
    const handleLogout = (0, react_1.useCallback)(() => {
        vscode.postMessage({ type: 'logout' });
    }, []);
    // Render login screen if not authenticated
    if (!authState.isAuthenticated) {
        return (<div className="login-screen">
        <div className="login-content">
          <h2>Enterprise AI Chat</h2>
          <p>Login to start chatting with AI</p>
          <button onClick={handleLogin} className="login-button">
            Login
          </button>
        </div>
      </div>);
    }
    return (<div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <div className="header-left">
          <h1 className="header-title">AI Chat</h1>
          {authState.user && (<span className="header-user">{authState.user.name}</span>)}
        </div>
        <div className="header-actions">
          {models.length > 0 && (<select value={selectedModel} onChange={handleModelChange} className="model-selector" aria-label="Select model">
              {models.map(model => (<option key={model.id} value={model.id}>
                  {model.name}
                </option>))}
            </select>)}
          <button onClick={handleNewChat} className="header-btn" title="New chat">
            <NewChatIcon />
          </button>
          <button onClick={handleLogout} className="header-btn" title="Logout">
            <LogoutIcon />
          </button>
        </div>
      </header>

      {/* Messages area */}
      <div ref={containerRef} className="messages-container" onScroll={handleScroll}>
        {messages.length === 0 ? (<div className="empty-state">
            <WelcomeIcon />
            <h3>Welcome!</h3>
            <p>Ask me anything about your code</p>
            <div className="suggestions">
              <button onClick={() => sendMessage('Explain the selected code')} className="suggestion-btn">
                Explain code
              </button>
              <button onClick={() => sendMessage('Find bugs in my code')} className="suggestion-btn">
                Find bugs
              </button>
              <button onClick={() => sendMessage('Write unit tests')} className="suggestion-btn">
                Write tests
              </button>
            </div>
          </div>) : (<div className="messages-list">
            {messages.map(message => (<MessageBubble_1.default key={message.id} message={message} isStreaming={message.isStreaming} onCopyCode={handleCopyCode} onRunCommand={handleRunCommand} onApplyCode={handleApplyCode}/>))}
            {isLoading && <LoadingIndicator_1.default />}
          </div>)}
      </div>

      {/* Scroll to bottom button */}
      <ScrollToBottomButton_1.default visible={!isAtBottom && messages.length > 0} onClick={scrollToBottom}/>

      {/* Input area */}
      <ChatInput_1.default onSend={sendMessage} disabled={isLoading || !!streamingMessageId} placeholder={isLoading
            ? 'Waiting for response...'
            : 'Type a message... (Enter to send)'}/>
    </div>);
};
// Icon components
const NewChatIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>);
const LogoutIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>);
const WelcomeIcon = () => (<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" className="welcome-icon">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
  </svg>);
exports.default = ChatContainer;
//# sourceMappingURL=ChatContainer.js.map