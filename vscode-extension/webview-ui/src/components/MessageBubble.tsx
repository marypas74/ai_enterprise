import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import { ChatMessage } from '../types';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onCopyCode?: (code: string) => void;
  onRunCommand?: (command: string, language: string) => void;
  onApplyCode?: (code: string, language: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = memo(({
  message,
  isStreaming = false,
  onCopyCode,
  onRunCommand,
  onApplyCode,
}) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // Format timestamp
  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isSystem) {
    return (
      <div className="message-system">
        <div className="system-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-header">
        <span className="message-role">
          {isUser ? (
            <>
              <UserIcon />
              <span>You</span>
            </>
          ) : (
            <>
              <AssistantIcon />
              <span>AI</span>
            </>
          )}
        </span>
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>

      <div className="message-content">
        {isUser ? (
          // User messages: plain text with code formatting
          <div className="user-text">
            {message.content.split('```').map((part, index) => {
              if (index % 2 === 1) {
                // Code block in user message
                const [lang, ...codeLines] = part.split('\n');
                const code = codeLines.join('\n');
                return (
                  <CodeBlock
                    key={index}
                    language={lang || 'text'}
                    onCopy={onCopyCode}
                  >
                    {code.trim()}
                  </CodeBlock>
                );
              }
              // Regular text
              return <span key={index}>{part}</span>;
            })}
          </div>
        ) : (
          // Assistant messages: full Markdown rendering
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Custom code block renderer
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';

                if (!inline && language) {
                  return (
                    <CodeBlock
                      language={language}
                      onCopy={onCopyCode}
                      onRun={onRunCommand}
                      onApply={onApplyCode}
                    >
                      {String(children).replace(/\n$/, '')}
                    </CodeBlock>
                  );
                }

                // Inline code
                return (
                  <code className="inline-code" {...props}>
                    {children}
                  </code>
                );
              },
              // Custom link renderer (open externally)
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      // Post message to extension to open external link
                      window.postMessage({ type: 'openExternal', url: href }, '*');
                    }}
                    className="markdown-link"
                  >
                    {children}
                  </a>
                );
              },
              // Custom table renderer
              table({ children }) {
                return (
                  <div className="table-wrapper">
                    <table>{children}</table>
                  </div>
                );
              },
              // Custom blockquote
              blockquote({ children }) {
                return <blockquote className="markdown-quote">{children}</blockquote>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="streaming-cursor" aria-hidden="true">
            ▋
          </span>
        )}
      </div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

// Icon components
const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </svg>
);

const AssistantIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </svg>
);

export default MessageBubble;
