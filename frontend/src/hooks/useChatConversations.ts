import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export interface Conversation {
  id: number;
  title: string;
  model: string;
  is_archived: boolean;
  updated_at: string;
  chat_mode?: 'free' | 'rag' | 'brainstorm' | null;
}

interface ConfirmAction {
  type: string;
  id?: number;
  label: string;
  action: () => Promise<void>;
}

interface UseChatConversationsReturn {
  conversations: Conversation[];
  currentConversationId: number | null;
  showArchived: boolean;
  isLoadingHistory: boolean;
  hasMoreConversations: boolean;
  confirmAction: ConfirmAction | null;
  setCurrentConversationId: (id: number | null) => void;
  setShowArchived: (show: boolean) => void;
  setConfirmAction: (action: ConfirmAction | null) => void;
  loadConversations: (archived?: boolean, offset?: number, initial?: boolean) => Promise<void>;
  loadMoreConversations: () => void;
  loadConversation: (id: number) => Promise<{ messages: any[]; conversation: any; attachments: any[] }>;
  startNewConversation: () => void;
  deleteConversation: (id: number, e: React.MouseEvent) => void;
  toggleArchive: (id: number, currentStatus: boolean, e: React.MouseEvent) => Promise<void>;
  archiveAllConversations: (archive: boolean) => void;
  deleteAllConversations: () => void;
}

const LAST_CONVERSATION_KEY = 'last-conversation-id';

function loadLastConversationId(): number | null {
  try {
    const stored = localStorage.getItem(LAST_CONVERSATION_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch { /* ignore */ }
  return null;
}

export function useChatConversations(): UseChatConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Always start with a fresh chat on site access (don't auto-restore last conversation)
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [conversationsOffset, setConversationsOffset] = useState(0);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // Persist currentConversationId to localStorage
  useEffect(() => {
    try {
      if (currentConversationId !== null) {
        localStorage.setItem(LAST_CONVERSATION_KEY, String(currentConversationId));
      } else {
        localStorage.removeItem(LAST_CONVERSATION_KEY);
      }
    } catch { /* ignore */ }
  }, [currentConversationId]);

  const loadConversations = useCallback(async (archived = false, offset = 0, initial = false) => {
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
  }, []);

  // Load conversations when archived filter changes
  useEffect(() => {
    setConversationsOffset(0);
    loadConversations(showArchived, 0, true);
  }, [showArchived, loadConversations]);

  const loadMoreConversations = useCallback(() => {
    const nextOffset = conversationsOffset + 20;
    loadConversations(showArchived, nextOffset);
  }, [conversationsOffset, showArchived, loadConversations]);

  const loadConversation = useCallback(async (id: number): Promise<{ messages: any[]; conversation: any; attachments: any[] }> => {
    const response = await api.get(`/chat/conversations/${id}/messages`);
    setCurrentConversationId(id);
    return {
      messages: response.data.messages.filter((m: any) => m.role !== 'system'),
      conversation: response.data.conversation,
      attachments: response.data.attachments || [],
    };
  }, []);

  const startNewConversation = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  const deleteConversation = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction({
      type: 'delete-conversation',
      id,
      label: 'Eliminare questa conversazione?',
      action: async () => {
        await api.delete(`/chat/conversations/${id}`);
        setConversations(prev => prev.filter(c => c.id !== id));
        setCurrentConversationId(prev => (prev === id ? null : prev));
      },
    });
  }, []);

  const toggleArchive = useCallback(async (id: number, currentStatus: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.patch(`/chat/conversations/${id}/archive`, { archived: !currentStatus });
      setConversations(prev => prev.filter(c => c.id !== id));
      setCurrentConversationId(prev => (prev === id ? null : prev));
    } catch (err) {
      console.error('Failed to archive/unarchive conversation:', err);
    }
  }, []);

  const archiveAllConversations = useCallback((archive: boolean) => {
    setConfirmAction({
      type: 'archive-all',
      label: archive ? 'Archiviare tutte le conversazioni?' : 'Ripristinare tutte le conversazioni?',
      action: async () => {
        await api.patch('/chat/conversations/archive', { all: true, archived: archive });
        setConversations([]);
        setCurrentConversationId(null);
      },
    });
  }, []);

  const deleteAllConversations = useCallback(() => {
    setConfirmAction({
      type: 'delete-all',
      label: 'ELIMINARE PERMANENTEMENTE tutte le conversazioni? Questa azione è irreversibile.',
      action: async () => {
        await api.delete('/chat/conversations', { data: { all: true } });
        setConversations([]);
        setCurrentConversationId(null);
      },
    });
  }, []);

  return {
    conversations,
    currentConversationId,
    showArchived,
    isLoadingHistory,
    hasMoreConversations,
    confirmAction,
    setCurrentConversationId,
    setShowArchived,
    setConfirmAction,
    loadConversations,
    loadMoreConversations,
    loadConversation,
    startNewConversation,
    deleteConversation,
    toggleArchive,
    archiveAllConversations,
    deleteAllConversations,
  };
}
