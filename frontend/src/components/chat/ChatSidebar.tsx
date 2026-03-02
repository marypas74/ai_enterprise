import { Link } from 'react-router-dom';
import {
  Plus,
  Settings,
  LogOut,
  MessageSquare,
  Trash2,
  Download,
  BookOpen,
  Loader2,
  Archive,
  History as HistoryIcon,
  ArchiveRestore,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../services/api';
import { downloadBlob } from '../../utils/fileDownload';
import { isNativePlatform } from '../../utils/platform';
import type { Conversation } from '../../hooks/useChatConversations';

interface ChatSidebarProps {
  sidebarOpen: boolean;
  user: { name: string; email: string; role: string } | null;
  conversations: Conversation[];
  currentConversationId: number | null;
  showArchived: boolean;
  isLoadingHistory: boolean;
  hasMoreConversations: boolean;
  onToggleArchived: () => void;
  onNewConversation: () => void;
  onLoadConversation: (id: number) => void;
  onDeleteConversation: (id: number, e: React.MouseEvent) => void;
  onToggleArchive: (id: number, currentStatus: boolean, e: React.MouseEvent) => void;
  onArchiveAll: (archive: boolean) => void;
  onDeleteAll: () => void;
  onLoadMore: () => void;
  onLogout: () => void;
}

export default function ChatSidebar({
  sidebarOpen,
  user,
  conversations,
  currentConversationId,
  showArchived,
  isLoadingHistory,
  hasMoreConversations,
  onToggleArchived,
  onNewConversation,
  onLoadConversation,
  onDeleteConversation,
  onToggleArchive,
  onArchiveAll,
  onDeleteAll,
  onLoadMore,
  onLogout,
}: ChatSidebarProps) {
  const downloadExtension = async () => {
    try {
      const response = await api.get('/downloads/vscode-extension/latest', {
        responseType: 'blob',
      });

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'enterprise-ai-chat.vsix';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      await downloadBlob(new Blob([response.data]), filename);
    } catch (err) {
      console.error('Failed to download extension:', err);
      alert('Failed to download VS Code extension');
    }
  };

  const openGuide = async (type: 'user' | 'admin') => {
    try {
      const response = await api.get(`/downloads/guides/${type}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/html' }));
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to open guide:', err);
    }
  };

  if (!sidebarOpen) return null;

  return (
    <>
      {/* New Chat Button */}
      <div className="p-4">
        <button
          onClick={onNewConversation}
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
            onClick={onToggleArchived}
            className="p-1 hover:bg-surface-800 rounded transition-colors"
            title={showArchived ? 'Show current chats' : 'Show archived chats'}
          >
            {showArchived ? <HistoryIcon className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
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
              onClick={() => onLoadConversation(conv.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 group cursor-pointer transition-colors',
                currentConversationId === conv.id
                  ? 'bg-surface-800'
                  : 'hover:bg-surface-800/50'
              )}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0 text-surface-400" />
              <span className="flex-1 truncate text-sm mr-2">{conv.title}</span>
              <div className="flex items-center gap-1 transition-opacity">
                <button
                  onClick={(e) => onToggleArchive(conv.id, conv.is_archived, e)}
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
                  onClick={(e) => onDeleteConversation(conv.id, e)}
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
            onClick={onLoadMore}
            disabled={isLoadingHistory}
            className="w-full py-2 mt-2 text-xs text-surface-500 hover:text-surface-300 transition-colors"
          >
            {isLoadingHistory ? 'Loading...' : 'Load older chats...'}
          </button>
        )}
      </div>

      {/* Bulk Actions */}
      <div className="px-4 pb-2">
        <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Gestione</div>
        <div className="flex gap-2">
          <button
            onClick={() => onArchiveAll(!showArchived)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-surface-700 hover:bg-surface-800 transition-colors text-xs"
            title={showArchived ? 'Unarchive All' : 'Archive All'}
          >
            <Archive className="w-3.5 h-3.5" />
            <span>{showArchived ? 'Ripristina' : 'Archivia'} Tutti</span>
          </button>
          <button
            onClick={onDeleteAll}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-900/30 hover:bg-red-900/20 text-red-400 transition-colors text-xs"
            title="Delete All"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Elimina Tutti</span>
          </button>
        </div>
      </div>

      {/* VS Code Extension Download (hidden on mobile) */}
      {!isNativePlatform() && (
        <div className="px-4 pb-2">
          <button
            onClick={downloadExtension}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-surface-700 hover:bg-surface-800 transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            <span>VS Code Extension</span>
          </button>
        </div>
      )}

      {/* Guide Downloads */}
      <div className="px-4 pb-2">
        <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Guide</div>
        <div className="flex gap-2">
          <button
            onClick={() => openGuide('user')}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-surface-700 hover:bg-surface-800 transition-colors text-xs"
            title="Apri Guida Utente"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Utente</span>
          </button>
          {user?.role === 'admin' && (
            <button
              onClick={() => openGuide('admin')}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-amber-900/30 hover:bg-amber-900/20 text-amber-400 transition-colors text-xs"
              title="Apri Guida Amministratore"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>
          )}
        </div>
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
            onClick={onLogout}
            className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5 text-surface-400" />
          </button>
        </div>
      </div>
    </>
  );
}
