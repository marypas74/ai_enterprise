import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../hooks/useAuthStore';
import { api, streamChat } from '../services/api';
import {
  Send,
  Plus,
  Menu,
  X,
  Settings,
  LogOut,
  MessageSquare,
  Trash2,
  ChevronDown,
  Bot,
  User,
  Sparkles,
  Download,
  Zap
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import clsx from 'clsx';

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Conversation {
  id: number;
  title: string;
  model: string;
  updated_at: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

export default function ChatPage() {
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load available models from configured providers
  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await api.get('/chat/models');
        const availableModels = response.data as Model[];
        setModels(availableModels);
        // Set first model as default if none selected
        if (availableModels.length > 0 && !selectedModel) {
          setSelectedModel(availableModels[0].id);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, []);

  // Load conversations
  useEffect(() => {
    loadConversations();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async () => {
    try {
      const response = await api.get('/chat/conversations');
      setConversations(response.data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const loadConversation = async (id: number) => {
    try {
      const response = await api.get(`/chat/conversations/${id}/messages`);
      setCurrentConversationId(id);
      setMessages(response.data.messages.filter((m: Message) => m.role !== 'system'));
      setSelectedModel(response.data.conversation.model);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  const deleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;

    try {
      await api.delete(`/chat/conversations/${id}`);
      setConversations(conversations.filter(c => c.id !== id));
      if (currentConversationId === id) {
        startNewConversation();
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsStreaming(true);

    // Add empty assistant message for streaming
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    await streamChat(
      selectedModel,
      userMessage,
      (content) => {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage.role === 'assistant') {
            lastMessage.content += content;
          }
          return newMessages;
        });
      },
      (conversationId) => {
        setIsStreaming(false);
        if (!currentConversationId) {
          setCurrentConversationId(conversationId);
          loadConversations();
        }
      },
      (error) => {
        setIsStreaming(false);
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage.role === 'assistant') {
            lastMessage.content = `Error: ${error}`;
          }
          return newMessages;
        });
      },
      currentConversationId || undefined,
      undefined
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentModel = models.find(m => m.id === selectedModel) || models[0] || { id: '', name: 'Loading...', provider: '' };

  // Download VS Code extension
  const downloadExtension = async () => {
    try {
      const response = await api.get('/downloads/vscode-extension/latest', {
        responseType: 'blob'
      });

      // Get filename from content-disposition header or use default
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'enterprise-ai-chat.vsix';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download extension:', err);
      alert('Failed to download VS Code extension');
    }
  };

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col bg-surface-900 text-white transition-all duration-300',
          sidebarOpen ? 'w-72' : 'w-0'
        )}
      >
        {sidebarOpen && (
          <>
            {/* New Chat Button */}
            <div className="p-4">
              <button
                onClick={startNewConversation}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-surface-700 hover:bg-surface-800 transition-colors"
              >
                <Plus className="w-5 h-5" />
                <span>New Chat</span>
              </button>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto px-2">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 group text-left transition-colors',
                    currentConversationId === conv.id
                      ? 'bg-surface-800'
                      : 'hover:bg-surface-800/50'
                  )}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0 text-surface-400" />
                  <span className="flex-1 truncate text-sm">{conv.title}</span>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface-700 rounded transition-all"
                  >
                    <Trash2 className="w-4 h-4 text-surface-400" />
                  </button>
                </button>
              ))}
            </div>

            {/* VS Code Extension Download */}
            <div className="px-4 pb-2">
              <button
                onClick={downloadExtension}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-surface-700 hover:bg-surface-800 transition-colors text-sm"
              >
                <Download className="w-4 h-4" />
                <span>VS Code Extension</span>
              </button>
            </div>

            {/* User Menu */}
            <div className="p-4 border-t border-surface-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center">
                  <span className="text-sm font-medium">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-surface-400 truncate">{user?.email}</p>
                </div>
                <button
                  onClick={logout}
                  className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5 text-surface-400" />
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-white dark:bg-surface-950">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Model Selector */}
            <div className="relative">
              <button
                onClick={() => setShowModelSelect(!showModelSelect)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-primary-500" />
                <span className="font-medium">{currentModel.name}</span>
                <ChevronDown className="w-4 h-4 text-surface-400" />
              </button>

              {showModelSelect && (
                <div className="absolute top-full left-0 mt-1 w-72 card p-2 shadow-lg z-50 max-h-[70vh] overflow-y-auto">
                  {modelsLoading ? (
                    <p className="px-3 py-2 text-sm text-surface-500">Loading models...</p>
                  ) : models.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-surface-500">No models configured</p>
                  ) : (
                    models.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setShowModelSelect(false);
                        }}
                        className={clsx(
                          'w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors',
                          selectedModel === model.id
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-surface-100 dark:hover:bg-surface-800'
                        )}
                      >
                        <div>
                          <p className="font-medium">{model.name}</p>
                          <p className="text-xs text-surface-500">{model.provider}</p>
                        </div>
                        {selectedModel === model.id && (
                          <div className="w-2 h-2 rounded-full bg-primary-500" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <a
            href="/auto-claude"
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <Sparkles className="w-5 h-5" />
            <span className="text-sm">Auto-Claude</span>
          </a>

          <a
            href="/parlant"
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <Zap className="w-5 h-5" />
            <span className="text-sm">Parlant</span>
          </a>

          {user?.role === 'admin' && (
            <a
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm">Admin</span>
            </a>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-6">
                <Bot className="w-8 h-8 text-primary-600" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Enterprise AI Chat</h2>
              <p className="text-surface-500 max-w-md">
                Start a conversation with {currentModel.name}. Your messages are private and secure.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-6">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={clsx(
                    'px-4 py-6',
                    message.role === 'assistant' && 'bg-surface-50 dark:bg-surface-900/50'
                  )}
                >
                  <div className="flex gap-4 max-w-3xl mx-auto">
                    <div
                      className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                        message.role === 'user'
                          ? 'bg-primary-600'
                          : 'bg-gradient-to-br from-violet-500 to-purple-600'
                      )}
                    >
                      {message.role === 'user' ? (
                        <User className="w-5 h-5 text-white" />
                      ) : (
                        <Bot className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 prose dark:prose-invert prose-sm max-w-none">
                      {message.role === 'assistant' && message.content === '' ? (
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      ) : (
                        <ReactMarkdown
                          components={{
                            code({ className, children, ...props }) {
                              const match = /language-(\w+)/.exec(className || '');
                              const inline = !match;
                              return inline ? (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              ) : (
                                <SyntaxHighlighter
                                  style={oneDark as any}
                                  language={match[1]}
                                  PreTag="div"
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              );
                            }
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-surface-200 dark:border-surface-800 p-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message..."
                  rows={1}
                  className="input resize-none min-h-[48px] max-h-[200px] py-3 pr-12"
                  style={{
                    height: 'auto',
                    minHeight: '48px'
                  }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming}
                  className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-center text-surface-400">
              {currentModel.name} may produce inaccurate information
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
