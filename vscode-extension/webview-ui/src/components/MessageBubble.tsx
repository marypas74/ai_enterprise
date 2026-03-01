import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import { ChatMessage } from '../types';
import { BotIcon, BotIconType } from './BotIcon';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  botIconType?: BotIconType;
  onCopyCode?: (code: string) => void;
  onRunCommand?: (command: string, language: string) => void;
  onApplyCode?: (code: string, language: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = memo(({
  message,
  isStreaming = false,
  botIconType = 'default',
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
              <BotIcon type={botIconType} size={16} />
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

      {/* AI Act: AI Generated Label (Art. 50.2) */}
      {!isUser && !isStreaming && message.content && (
        <div style={{
          fontSize: '10px',
          color: 'var(--vscode-descriptionForeground)',
          marginTop: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: 0.7
        }}>
          <span>✦</span>
          <span>Generato da AI{message.model ? ` · ${message.model}` : ''}</span>
        </div>
      )}
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

// Icon component for user
const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </svg>
);

export default MessageBubble;
