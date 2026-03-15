import React from 'react';

interface Conversation {
  id: string;
  title: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  onSelect,
  onDelete,
  onNewChat,
}) => {
  return (
    <div
      style={{
        width: '220px',
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <button
        onClick={onNewChat}
        style={{ margin: '8px', fontSize: '0.85em' }}
      >
        + New Chat
      </button>
      {conversations.map((conv) => (
        <div
          key={conv.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 10px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            onClick={() => onSelect(conv.id)}
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '0.85em',
              color: 'var(--text-primary)',
            }}
            title={conv.title}
          >
            {conv.title}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              fontSize: '0.8em',
              flexShrink: 0,
            }}
            title="Delete conversation"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};
