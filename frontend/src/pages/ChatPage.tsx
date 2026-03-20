import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAuthStore } from '../hooks/useAuthStore';
import { useChatConversations } from '../hooks/useChatConversations';
import { useChatMessages } from '../hooks/useChatMessages';
import { useFileAttachments } from '../hooks/useFileAttachments';
import { useVoiceMode } from '../hooks/useVoiceMode';
import { usePDFEditorStore } from '../hooks/usePDFEditorStore';
import { useSelectedIcon } from '../components/IconSelector';
import {
  Menu,
  X,
  Settings,
  Sparkles,
  ChevronDown,
  RotateCcw,
  Brain,
  Database,
  Volume2,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';

const PDFEditorPanel = lazy(() => import('../components/chat/PDFEditorPanel'));
import { IconSelector } from '../components/IconSelector';
import ConversationalFormIndicator from '../components/ConversationalFormIndicator';
import MemoryPanel from '../components/MemoryPanel';
import AIDisclosureBanner from '../components/AIDisclosureBanner';
import ConsentModal from '../components/ConsentModal';
import ChatSidebar from '../components/chat/ChatSidebar';
import ChatMessageList from '../components/chat/ChatMessageList';
import ChatInputArea from '../components/chat/ChatInputArea';
import AvatarOrb from '../components/chat/AvatarOrb';
import { RagModeBadge } from '../components/chat/RagModeBadge';
import { useDocumentStore } from '../hooks/useDocumentStore';

export default function ChatPage() {
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [selectedBotIcon, setSelectedBotIcon] = useSelectedIcon();
  const { chatMode } = useDocumentStore();
  const isRagMode = chatMode === 'rag';

  const conversations = useChatConversations();
  const chatMessages = useChatMessages(conversations.currentConversationId);
  const fileAttachments = useFileAttachments();
  const voiceMode = useVoiceMode();
  const pdfEditor = usePDFEditorStore();
  const prevStreamingRef = useRef(false);
  const prevConversationIdRef = useRef<number | null>(conversations.currentConversationId);

  // Clear frontend state when conversation is deleted (id goes from non-null to null)
  useEffect(() => {
    const prevId = prevConversationIdRef.current;
    const currId = conversations.currentConversationId;
    prevConversationIdRef.current = currId;

    if (prevId !== null && currId === null) {
      chatMessages.setMessages([]);
      fileAttachments.clearAttachments();
      useDocumentStore.getState().clearSelection();
    }
  }, [conversations.currentConversationId]);

  // Drive voice mode state machine from streaming state
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = chatMessages.isStreaming;

    if (chatMessages.isStreaming && !wasStreaming) {
      voiceMode.onStreamStart();
    }
    if (!chatMessages.isStreaming && wasStreaming) {
      const last = chatMessages.messages[chatMessages.messages.length - 1];
      if (last?.role === 'assistant' && last.content) {
        voiceMode.onStreamDone(last.content);
      } else {
        voiceMode.onStreamError();
      }
    }
  }, [chatMessages.isStreaming, chatMessages.messages, voiceMode.onStreamStart, voiceMode.onStreamDone, voiceMode.onStreamError]);

  // Drive thinking state
  useEffect(() => {
    const last = chatMessages.messages[chatMessages.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (last.thinking && !last.thinkingDone) {
      voiceMode.onThinkingStart();
    } else if (last.thinkingDone) {
      voiceMode.onThinkingDone();
    }
  }, [chatMessages.messages, voiceMode.onThinkingStart, voiceMode.onThinkingDone]);

  // When a conversation is selected, load its messages
  const handleLoadConversation = async (id: number) => {
    try {
      const { messages, conversation, attachments } = await conversations.loadConversation(id);
      // Enrich user messages with attachment metadata for PDF edit buttons
      const pdfAttachments = (attachments || [])
        .filter((a: any) => a.mime_type === 'application/pdf')
        .map((a: any) => ({ id: a.id, name: a.original_name, mimeType: a.mime_type }));
      const enrichedMessages = messages.map((msg: any) => {
        if (msg.role === 'user' && pdfAttachments.length > 0 && msg.content?.includes('.pdf')) {
          return { ...msg, attachments: pdfAttachments };
        }
        return msg;
      });
      chatMessages.setMessages(enrichedMessages);
      chatMessages.setSelectedModel(conversation.model);

      // Restore chat mode and selected documents
      if (conversation.chat_mode) {
        useDocumentStore.getState().setChatMode(conversation.chat_mode);
      }

      if (conversation.document_ids) {
        const docIds = typeof conversation.document_ids === 'string'
          ? JSON.parse(conversation.document_ids)
          : conversation.document_ids;

        // Reset and apply new selection
        useDocumentStore.getState().clearSelection();
        if (Array.isArray(docIds)) {
          docIds.forEach((docId: number) => useDocumentStore.getState().toggleDocumentId(docId));
        }
      } else if (conversation.chat_mode === 'rag') {
        useDocumentStore.getState().clearSelection();
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
      conversations.setCurrentConversationId(null);
    }
  };

  // NOTE: No auto-restore of last conversation on mount.
  // Users always start with a fresh chat. They can resume via sidebar.

  // When starting a new conversation, clear messages and attachments
  const handleNewConversation = () => {
    conversations.startNewConversation();
    chatMessages.setMessages([]);
    fileAttachments.clearAttachments();
    useDocumentStore.getState().clearSelection();
  };

  // Send message wrapper
  const handleSendMessage = (overrideMessage?: string) => {
    chatMessages.sendMessage(
      conversations.currentConversationId,
      conversations.showArchived,
      (newConversationId: number) => {
        conversations.setCurrentConversationId(newConversationId);
        conversations.loadConversations(conversations.showArchived, 0, true);
      },
      fileAttachments.attachments,
      fileAttachments.uploadAttachments,
      overrideMessage,
    );
  };

  // Voice transcription → auto-send immediately
  const handleVoiceTranscription = (text: string) => {
    handleSendMessage(text);
  };

  // Undo last message
  const handleUndoLastMessage = () => {
    chatMessages.undoLastMessage(conversations.currentConversationId);
  };

  // Generate document
  const handleGenerateDocument = (msgIndex: number, format: 'docx' | 'pdf') => {
    chatMessages.handleGenerateDocument(msgIndex, format, conversations.currentConversationId);
  };

  // Toggle thinking expansion
  const handleToggleThinking = (index: number) => {
    chatMessages.setExpandedThinking(prev => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col bg-surface-900 text-white transition-all duration-300 z-50',
          'md:relative md:z-auto',
          sidebarOpen
            ? 'fixed inset-y-0 left-0 w-72 md:relative'
            : 'w-0'
        )}
      >
        <ChatSidebar
          sidebarOpen={sidebarOpen}
          user={user}
          conversations={conversations.conversations}
          currentConversationId={conversations.currentConversationId}
          showArchived={conversations.showArchived}
          isLoadingHistory={conversations.isLoadingHistory}
          hasMoreConversations={conversations.hasMoreConversations}
          onToggleArchived={() => conversations.setShowArchived(!conversations.showArchived)}
          onNewConversation={handleNewConversation}
          onLoadConversation={handleLoadConversation}
          onDeleteConversation={conversations.deleteConversation}
          onToggleArchive={conversations.toggleArchive}
          onArchiveAll={conversations.archiveAllConversations}
          onDeleteAll={conversations.deleteAllConversations}
          onLoadMore={conversations.loadMoreConversations}
          onLogout={logout}
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex bg-white dark:bg-surface-950 relative overflow-hidden">
        <div className={clsx('flex-1 flex flex-col min-w-0 transition-all duration-300', pdfEditor.isOpen && 'md:w-[45%] md:flex-none')}>
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
                onClick={() => chatMessages.setShowModelSelect(!chatMessages.showModelSelect)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-primary-500 shrink-0" />
                <span className="font-medium truncate max-w-[120px] sm:max-w-[200px]">{chatMessages.currentModel.name}</span>
                <ChevronDown className="w-4 h-4 text-surface-400 shrink-0" />
              </button>

              {chatMessages.showModelSelect && (
                <div className="fixed left-2 right-2 top-16 sm:absolute sm:top-full sm:left-0 sm:right-auto mt-1 sm:w-96 card p-2 shadow-lg z-50 max-h-[70vh] overflow-y-auto">
                  {chatMessages.modelsLoading ? (
                    <p className="px-3 py-2 text-sm text-surface-500">Loading models...</p>
                  ) : chatMessages.models.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-surface-500">No models configured</p>
                  ) : (
                    <>
                      {chatMessages.recommendedModel && (
                        <div className="px-3 py-2 mb-1 text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700 flex items-center gap-2">
                          <Sparkles className="w-3 h-3 text-amber-500" />
                          <span>Carico: <strong className={chatMessages.recommendedModel.load.tier === 'low' ? 'text-green-500' : chatMessages.recommendedModel.load.tier === 'medium' ? 'text-amber-500' : 'text-red-500'}>{chatMessages.recommendedModel.load.tierLabel}</strong> ({chatMessages.recommendedModel.load.activeUsers} utenti attivi)</span>
                        </div>
                      )}
                      {chatMessages.models.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => {
                            chatMessages.setSelectedModel(model.id);
                            chatMessages.setShowModelSelect(false);
                          }}
                          className={clsx(
                            'w-full flex items-start justify-between px-3 py-2.5 rounded-lg text-left transition-colors',
                            chatMessages.selectedModel === model.id
                              ? 'bg-primary-50 dark:bg-primary-900/20'
                              : 'hover:bg-surface-100 dark:hover:bg-surface-800'
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{model.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500">{model.provider}</span>
                              {chatMessages.recommendedModel?.id === model.id && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Consigliato</span>
                              )}
                            </div>
                            {model.description && (
                              <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 leading-relaxed">{model.description}</p>
                            )}
                          </div>
                          {chatMessages.selectedModel === model.id && (
                            <div className="w-2 h-2 rounded-full bg-primary-500 mt-1.5 ml-2 shrink-0" />
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RAG Mode Badge */}
          <div className="hidden md:block">
            <RagModeBadge />
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {!isRagMode && (
              <div className="hidden sm:block">
                <IconSelector onIconChange={setSelectedBotIcon} />
              </div>
            )}

            <div className="hidden sm:flex items-center gap-1">
              {conversations.currentConversationId && chatMessages.messages.length > 0 && (
                <button
                  onClick={handleUndoLastMessage}
                  disabled={chatMessages.isStreaming}
                  className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors text-surface-500 hover:text-primary-500"
                  title="Annulla ultimo messaggio e rifai"
                >
                  <RotateCcw className={clsx('w-5 h-5', chatMessages.isStreaming && 'animate-spin')} />
                </button>
              )}

              <button
                onClick={() => chatMessages.setShowVectorMemory(!chatMessages.showVectorMemory)}
                className={clsx(
                  'relative p-2 rounded-lg transition-colors',
                  chatMessages.showVectorMemory
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-cyan-400'
                )}
                title="Vector Memory"
              >
                <Database className="w-5 h-5" />
              </button>

              <button
                onClick={() => {
                  chatMessages.setShowMemoryPanel(!chatMessages.showMemoryPanel);
                  if (!chatMessages.showMemoryPanel) chatMessages.loadMemoryObservations();
                }}
                className={clsx(
                  'relative p-2 rounded-lg transition-colors',
                  chatMessages.showMemoryPanel
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-purple-400'
                )}
                title="Memory"
              >
                <Brain className="w-5 h-5" />
                {chatMessages.memoryContextActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-purple-500 rounded-full" />
                )}
              </button>
            </div>

            {!isRagMode && (
              <button
                onClick={voiceMode.toggleVoiceMode}
                className={clsx(
                  'relative p-2 rounded-lg transition-colors',
                  voiceMode.voiceModeEnabled
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-violet-400'
                )}
                title={voiceMode.voiceModeEnabled ? 'Disattiva voce' : 'Attiva voce'}
              >
                <Volume2 className="w-5 h-5" />
                {voiceMode.voiceModeEnabled && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-violet-500 rounded-full" />
                )}
              </button>
            )}

            {user?.role === 'admin' && (
              <a
                href="/admin"
                className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm">Admin</span>
              </a>
            )}
          </div>
        </header>

        {/* AI Act: Disclosure Banner (GAP-1) */}
        <AIDisclosureBanner modelName={chatMessages.currentModel.name} conversationId={conversations.currentConversationId} />

        {/* Memory Panel Overlay */}
        {chatMessages.showMemoryPanel && (
          <div className="absolute right-4 top-16 z-40 w-80 max-h-[60vh] bg-surface-900 border border-surface-700 rounded-lg shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-white">Memory</span>
                {chatMessages.memoryContextActive && (
                  <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">active</span>
                )}
              </div>
              <button onClick={() => chatMessages.setShowMemoryPanel(false)} className="text-surface-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(60vh-48px)] p-2 space-y-1.5">
              {chatMessages.memoryObservations.length === 0 ? (
                <p className="text-center text-xs text-surface-500 py-6">No observations yet</p>
              ) : (
                chatMessages.memoryObservations.map(obs => (
                  <div key={obs.id} className="px-3 py-2 bg-surface-800 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-300">{obs.observation_type}</span>
                      <span className="text-[10px] text-yellow-400">{'*'.repeat(Math.min(obs.importance, 5))}</span>
                      <span className="text-[10px] text-surface-500 ml-auto">
                        {new Date(obs.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-surface-300 line-clamp-3">{obs.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <ChatMessageList
            messages={chatMessages.messages}
            isStreaming={chatMessages.isStreaming}
            selectedBotIcon={selectedBotIcon}
            currentModelName={chatMessages.currentModel.name}
            currentConversationId={conversations.currentConversationId}
            generatingDoc={chatMessages.generatingDoc}
            expandedThinking={chatMessages.expandedThinking}
            messagesEndRef={chatMessages.messagesEndRef}
            onToggleThinking={handleToggleThinking}
            onGenerateDocument={handleGenerateDocument}
          />
        </div>

        {/* Conversational Form Indicator */}
        <ConversationalFormIndicator
          session={chatMessages.activeFormSession}
          onCancel={chatMessages.handleFormCancel}
          onConfirm={chatMessages.handleFormConfirm}
        />

        {/* Input */}
        <ChatInputArea
          input={chatMessages.input}
          isStreaming={chatMessages.isStreaming}
          isUploading={fileAttachments.isUploading}
          attachments={fileAttachments.attachments}
          currentModelName={chatMessages.currentModel.name}
          inputRef={chatMessages.inputRef}
          fileInputRef={fileAttachments.fileInputRef}
          onInputChange={chatMessages.setInput}
          onKeyDown={(e) => chatMessages.handleKeyDown(e, handleSendMessage)}
          onSend={handleSendMessage}
          onFileSelect={fileAttachments.handleFileSelect}
          onRemoveAttachment={fileAttachments.removeAttachment}
          onOpenFilePicker={() => fileAttachments.fileInputRef.current?.click()}
          onAddFile={fileAttachments.addFile}
          onVoiceTranscription={handleVoiceTranscription}
          onModeChange={() => {
            // Reset conversation when switching between free and rag mode
            conversations.startNewConversation();
            chatMessages.setMessages([]);
            // Keep attachments only when switching TO free mode (may be useful)
            // Clear document selection when leaving rag mode
          }}
        />
        </div>

        {/* PDF Editor Panel */}
        {pdfEditor.isOpen && pdfEditor.attachmentId && (
          <Suspense fallback={<div className="w-[55%] bg-surface-950 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>}>
            <PDFEditorPanel
              attachmentId={pdfEditor.attachmentId}
              filename={pdfEditor.filename}
              onClose={pdfEditor.closeEditor}
              onSaved={(newId, newFilename) => {
                pdfEditor.closeEditor();
                chatMessages.setMessages(prev => [...prev, {
                  role: 'assistant' as const,
                  content: `PDF salvato con successo: **${newFilename}** (ID: ${newId})`,
                  timestamp: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                }]);
              }}
            />
          </Suspense>
        )}
      </main>

      {/* Vector Memory Sidebar */}
      {chatMessages.showVectorMemory && (
        <MemoryPanel
          memories={chatMessages.vectorMemories}
          onClose={() => chatMessages.setShowVectorMemory(false)}
        />
      )}

      {/* Avatar Orb Overlay (Voice Mode) */}
      {voiceMode.orbState !== 'hidden' && (
        <AvatarOrb
          state={voiceMode.orbState}
          onDismiss={voiceMode.dismissOrb}
          onStopSpeaking={voiceMode.stopSpeaking}
          botIcon={selectedBotIcon}
          modelName={chatMessages.currentModel.name}
        />
      )}

      {/* AI Act: Consent Modal (GAP-4) */}
      {chatMessages.showConsentModal && (
        <ConsentModal onConsented={() => chatMessages.setShowConsentModal(false)} />
      )}

      {/* Confirmation Modal */}
      {conversations.confirmAction && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-surface-900 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Conferma</h3>
            <p className="text-sm text-surface-600 dark:text-surface-400">{conversations.confirmAction.label}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => conversations.setConfirmAction(null)}
                className="px-4 py-2 rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 text-sm font-medium"
              >
                Annulla
              </button>
              <button
                onClick={async () => {
                  try { await conversations.confirmAction!.action(); } catch { /* error handled in action */ }
                  conversations.setConfirmAction(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
