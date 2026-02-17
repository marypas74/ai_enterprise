import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  User,
  Sparkles,
  Download,
  Paperclip,
  FileText,
  Image,
  Code,
  File,
  Loader2,
  Archive,
  History,
  ArchiveRestore
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import clsx from 'clsx';
import { BotIcon, BotIconType } from '../components/BotIcon';
import { IconSelector, useSelectedIcon } from '../components/IconSelector';

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Conversation {
  id: number;
  title: string;
  model: string;
  is_archived: boolean;
  updated_at: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface Attachment {
  id?: number;
  file: File;
  preview?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'processing' | 'completed' | 'failed';
  contentType?: string;
  uploadedId?: number;
}

// Helper to get icon for attachment type
function getAttachmentIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text/plain')) return FileText;
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('json') ||
    mimeType.includes('python') || mimeType.includes('java') || mimeType.includes('html') || mimeType.includes('css')) return Code;
  return File;
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
  const [selectedBotIcon, setSelectedBotIcon] = useSelectedIcon();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [conversationsOffset, setConversationsOffset] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setConversationsOffset(0);
    loadConversations(showArchived, 0, true);
  }, [showArchived]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async (archived = false, offset = 0, initial = false) => {
    setIsLoadingHistory(true);
    try {
      const limit = 20;
      const response = await api.get(`/chat/conversations?archived=${archived}&limit=${limit}&offset=${offset}`);
      const newConvs = response.data;

      if (initial) {
        setConversations(newConvs);
      } else {
        setConversations(prev => [...prev, ...newConvs]);
      }

      setHasMoreConversations(newConvs.length === limit);
      setConversationsOffset(offset);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadMoreConversations = () => {
    const nextOffset = conversationsOffset + 20;
    loadConversations(showArchived, nextOffset);
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
    setAttachments([]);
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = Array.from(files).map(file => ({
      file,
      status: 'pending' as const,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));

    setAttachments(prev => [...prev, ...newAttachments]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove attachment
  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const newAttachments = [...prev];
      // Revoke preview URL if exists
      if (newAttachments[index].preview) {
        URL.revokeObjectURL(newAttachments[index].preview!);
      }
      newAttachments.splice(index, 1);
      return newAttachments;
    });
  };

  // Upload attachments before sending message (conversationId is optional)
  const uploadAttachments = async (conversationId?: number): Promise<number[]> => {
    if (attachments.length === 0) return [];

    setIsUploading(true);
    const uploadedIds: number[] = [];

    try {
      const formData = new FormData();
      if (conversationId) {
        formData.append('conversationId', conversationId.toString());
      }

      attachments.forEach(att => {
        formData.append('files', att.file);
      });

      const response = await api.post('/attachments/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data.attachments) {
        uploadedIds.push(...response.data.attachments.map((a: any) => a.id));
      }

      // Clear attachments after upload
      attachments.forEach(att => {
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setAttachments([]);

    } catch (err) {
      console.error('Failed to upload attachments:', err);
    } finally {
      setIsUploading(false);
    }

    return uploadedIds;
  };

  const deleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;

    try {
      await api.delete(`/chat/conversations/${id}`);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        startNewConversation();
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const toggleArchive = async (id: number, currentStatus: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.patch(`/chat/conversations/${id}/archive`, { archived: !currentStatus });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        startNewConversation();
      }
    } catch (err) {
      console.error('Failed to archive/unarchive conversation:', err);
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming || isUploading) return;

    const userMessage = input.trim();
    const hasAttachments = attachments.length > 0;
    const attachmentNames = attachments.map(a => a.file.name);

    setInput('');

    // Show user message with attachment indicator
    const displayMessage = hasAttachments
      ? `${userMessage}\n\n📎 Allegati: ${attachmentNames.join(', ')}`
      : userMessage;

    setMessages(prev => [...prev, { role: 'user', content: displayMessage }]);
    setIsStreaming(true);

    // Add empty assistant message for streaming
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      // Upload attachments first (works with or without conversationId)
      let attachmentIds: number[] = [];
      if (hasAttachments) {
        attachmentIds = await uploadAttachments(currentConversationId || undefined);
      }

      // Build message with attachment context
      let messageToSend = userMessage;
      // If we have attachments, we just send the message as is (or with a default prompt if empty)
      // The backend will inject the context based on attachmentIds
      if (hasAttachments) {
        if (!messageToSend) {
          messageToSend = `Analizza i file allegati: ${attachmentNames.join(', ')}`;
        } else {
          messageToSend = `[Allegati: ${attachmentNames.join(', ')}]\n\n${userMessage}`;
        }
      }

      await streamChat(
        selectedModel,
        messageToSend,
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
            loadConversations(showArchived);
          }
        },
        (error) => {
          setIsStreaming(false);
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage.role === 'assistant') {
              lastMessage.content = `Errore: ${error}`;
            }
            return newMessages;
          });
        },
        currentConversationId || undefined,
        undefined,
        attachmentIds.length > 0 ? attachmentIds : undefined
      );
    } catch (err) {
      setIsStreaming(false);
      console.error('Send message error:', err);
    }
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
              <div className="flex items-center justify-between px-2 mb-2 text-xs font-semibold text-surface-500 uppercase tracking-wider">
                <span>{showArchived ? 'Archived' : 'Recent Chats'}</span>
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="p-1 hover:bg-surface-800 rounded transition-colors"
                  title={showArchived ? 'Show current chats' : 'Show archived chats'}
                >
                  {showArchived ? <History className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                </button>
              </div>

              {isLoadingHistory ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-surface-500" />
                </div>
              ) : conversations.length === 0 ? (
                <p className="text-center text-xs text-surface-500 py-4 italic">
                  No {showArchived ? 'archived' : ''} conversations.
                </p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 group cursor-pointer transition-colors',
                      currentConversationId === conv.id
                        ? 'bg-surface-800'
                        : 'hover:bg-surface-800/50'
                    )}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0 text-surface-400" />
                    <span className="flex-1 truncate text-sm">{conv.title}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => toggleArchive(conv.id, conv.is_archived, e)}
                        className="p-1 hover:bg-surface-700 rounded transition-all"
                        title={showArchived ? 'Restore' : 'Archive'}
                      >
                        {showArchived ? (
                          <ArchiveRestore className="w-3.5 h-3.5 text-surface-400" />
                        ) : (
                          <Archive className="w-3.5 h-3.5 text-surface-400" />
                        )}
                      </button>
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="p-1 hover:bg-surface-700 rounded transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))
              )}

              {hasMoreConversations && conversations.length >= 20 && (
                <button
                  onClick={loadMoreConversations}
                  disabled={isLoadingHistory}
                  className="w-full py-2 mt-2 text-xs text-surface-500 hover:text-surface-300 transition-colors"
                >
                  {isLoadingHistory ? 'Loading...' : 'Load older chats...'}
                </button>
              )}
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
                <Link
                  to="/settings"
                  className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
                  title="Impostazioni Profilo"
                >
                  <Settings className="w-5 h-5 text-surface-400" />
                </Link>
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

          <div className="flex items-center gap-2">
            <IconSelector onIconChange={setSelectedBotIcon} />

            {user?.role === 'admin' && (
              <a
                href="/admin"
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm">Admin</span>
              </a>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 text-white">
                <BotIcon type={selectedBotIcon} size={32} />
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
                        <BotIcon type={selectedBotIcon} size={20} className="text-white" />
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
            {/* Attachments Preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-2 bg-surface-50 dark:bg-surface-900 rounded-lg">
                {attachments.map((att, index) => {
                  const IconComponent = getAttachmentIcon(att.file.type);
                  return (
                    <div
                      key={index}
                      className="relative flex items-center gap-2 px-3 py-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700 group"
                    >
                      {att.preview ? (
                        <img src={att.preview} alt="" className="w-8 h-8 object-cover rounded" />
                      ) : (
                        <IconComponent className="w-5 h-5 text-surface-500" />
                      )}
                      <span className="text-sm truncate max-w-[120px]">{att.file.name}</span>
                      <button
                        onClick={() => removeAttachment(index)}
                        className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-surface-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="relative flex items-end gap-2">
              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.html,.css,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp3,.wav,.ogg,.zip,.tar,.gz"
              />

              {/* Attach button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || isUploading}
                className="p-3 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
                title="Allega file"
              >
                {isUploading ? (
                  <Loader2 className="w-5 h-5 text-surface-500 animate-spin" />
                ) : (
                  <Paperclip className="w-5 h-5 text-surface-500" />
                )}
              </button>

              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={attachments.length > 0 ? "Aggiungi un messaggio per gli allegati..." : "Messaggio..."}
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
                  disabled={(!input.trim() && attachments.length === 0) || isStreaming || isUploading}
                  className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-center text-surface-400">
              {currentModel.name} può produrre informazioni imprecise
              {attachments.length > 0 && ` • ${attachments.length} allegat${attachments.length === 1 ? 'o' : 'i'} pront${attachments.length === 1 ? 'o' : 'i'}`}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
