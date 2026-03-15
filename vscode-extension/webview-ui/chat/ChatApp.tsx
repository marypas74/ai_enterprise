import React, { useState, useEffect, useCallback } from 'react';
import { useVsCodeMessage, usePostMessage } from '../shared/hooks/useVsCodeApi';
import { useAuth } from '../shared/hooks/useAuth';
import { useModels } from '../shared/hooks/useModels';
import { useStreaming } from '../shared/hooks/useStreaming';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import { MessageArea } from './MessageArea';
import { ChatInput } from './ChatInput';
import { ConversationList } from './ConversationList';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
}

interface IncomingMessage {
  type: string;
  [key: string]: unknown;
}

export const ChatApp: React.FC = () => {
  const postMessage = usePostMessage();
  const { isAuthenticated, user, setAuthenticated, setUnauthenticated } = useAuth();
  const { models, selectedModel, setSelectedModel, updateModels } = useModels();
  const streaming = useStreaming();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  useVsCodeMessage<IncomingMessage>((msg) => {
    switch (msg.type) {
      case 'authenticated':
        setAuthenticated(msg.user as { id: number; email: string; name: string; role: string });
        break;
      case 'unauthenticated':
        setUnauthenticated();
        setMessages([]);
        break;
      case 'models':
        updateModels(msg.models as { id: string; name: string; provider: string }[]);
        break;
      case 'streamStart':
        streaming.startStream();
        break;
      case 'streamChunk':
        streaming.appendChunk(msg.text as string);
        break;
      case 'streamEnd': {
        const finalContent = streaming.content || (msg.content as string) || '';
        streaming.endStream();
        if (finalContent) {
          setMessages((prev) => [...prev, { role: 'assistant', content: finalContent }]);
        }
        break;
      }
      case 'streamError':
        streaming.setError(msg.error as string);
        setError(msg.error as string);
        break;
      case 'conversations':
        setConversations(msg.conversations as Conversation[]);
        break;
      case 'conversationLoaded':
        setMessages(msg.messages as ChatMessage[]);
        break;
      case 'addContext':
        postMessage({
          type: 'sendMessage',
          message: `[Context: ${msg.filename}]\n\`\`\`${msg.language || ''}\n${msg.code}\n\`\`\``,
          model: selectedModel,
        });
        break;
      case 'prefillMessage':
        // Handled by ChatInput via a separate mechanism if needed
        break;
      case 'error':
        setError(msg.message as string);
        break;
      default:
        break;
    }
  });

  const handleSend = useCallback((message: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    postMessage({ type: 'sendMessage', message, model: selectedModel });
  }, [postMessage, selectedModel]);

  const handleAbort = useCallback(() => {
    postMessage({ type: 'abortStream' });
    streaming.endStream();
  }, [postMessage, streaming]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    streaming.endStream();
    postMessage({ type: 'newChat' });
  }, [postMessage, streaming]);

  const handleLoadConversation = useCallback((id: string) => {
    postMessage({ type: 'loadConversation', conversationId: id });
    setSidebarOpen(false);
  }, [postMessage]);

  const handleDeleteConversation = useCallback((id: string) => {
    postMessage({ type: 'deleteConversation', conversationId: id });
  }, [postMessage]);

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', padding: '24px' }}>
        <h2 style={{ color: 'var(--text-primary)' }}>Enterprise AI Chat</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Please log in to start chatting.</p>
        <button onClick={() => postMessage({ type: 'login' })}>Login</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {sidebarOpen && (
        <ConversationList
          conversations={conversations}
          onSelect={handleLoadConversation}
          onDelete={handleDeleteConversation}
          onNewChat={handleNewChat}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', gap: '8px' }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: 'transparent', color: 'var(--text-primary)', padding: '4px 8px', fontSize: '1.1em' }}
            title="Toggle conversations"
          >
            {'\u2630'}
          </button>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>
            {user?.name || user?.email}
          </span>
        </div>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <MessageArea
          messages={messages}
          streamingContent={streaming.content}
          isStreaming={streaming.isStreaming}
        />
        <ChatInput
          models={models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={streaming.isStreaming}
          disabled={!isAuthenticated}
        />
      </div>
    </div>
  );
};
