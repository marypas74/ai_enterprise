import React, { useEffect, useRef } from 'react';
import { MessageBubble } from '../shared/components/MessageBubble';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageAreaProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
}

export const MessageArea: React.FC<MessageAreaProps> = ({ messages, streamingContent, isStreaming }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      {messages.length === 0 && !isStreaming && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--text-secondary)',
          }}
        >
          <p>Start a conversation by typing a message below.</p>
        </div>
      )}
      {messages.map((msg, index) => (
        <MessageBubble key={index} role={msg.role} content={msg.content} />
      ))}
      {isStreaming && streamingContent && (
        <MessageBubble role="assistant" content={streamingContent} isStreaming={true} />
      )}
      <div ref={bottomRef} />
    </div>
  );
};
