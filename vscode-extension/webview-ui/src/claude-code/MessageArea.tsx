import React, { memo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface MessageAreaProps {
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  onCopy: (text: string) => void;
  onRun: (command: string) => void;
  onApply: (code: string, language: string) => void;
}

/**
 * MessageArea - Terminal-style message display
 * Auto-scrolls, supports Markdown and code highlighting
 */
const MessageArea: React.FC<MessageAreaProps> = ({
  messages,
  isLoading,
  streamingContent,
  onCopy,
  onRun,
  onApply,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (isAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  return (
    <div
      ref={containerRef}
      className="messages-area"
      onScroll={handleScroll}
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onCopy={onCopy}
          onRun={onRun}
          onApply={onApply}
        />
      ))}

      {/* Streaming message */}
      {streamingContent && (
        <div className="message-container message-assistant">
          <div className="message-icon">
            <AIMiniLogo />
          </div>
          <div className="message-content markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: ({ node, inline, className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const lang = match ? match[1] : '';
                  if (!inline && lang) {
                    return (
                      <CodeBlock
                        language={lang}
                        code={String(children).replace(/\n$/, '')}
                        onCopy={onCopy}
                        onRun={onRun}
                        onApply={onApply}
                      />
                    );
                  }
                  return <code className="inline-code" {...props}>{children}</code>;
                },
              }}
            >
              {streamingContent}
            </ReactMarkdown>
            <span className="streaming-cursor" />
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && !streamingContent && (
        <div className="thinking-indicator">
          <div className="thinking-icon">
            <AIMiniLogo />
          </div>
          <span className="thinking-text">
            Thinking
            <span className="thinking-dots">
              <span />
              <span />
              <span />
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Individual message bubble
 */
const MessageBubble = memo<{
  message: Message;
  onCopy: (text: string) => void;
  onRun: (command: string) => void;
  onApply: (code: string, language: string) => void;
}>(({ message, onCopy, onRun, onApply }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`message-container ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-icon">
        {isUser ? <UserIcon /> : <AIMiniLogo />}
      </div>
      <div className="message-content markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: ({ node, inline, className, children, ...props }: any) => {
              const match = /language-(\w+)/.exec(className || '');
              const lang = match ? match[1] : '';
              if (!inline && lang) {
                return (
                  <CodeBlock
                    language={lang}
                    code={String(children).replace(/\n$/, '')}
                    onCopy={onCopy}
                    onRun={onRun}
                    onApply={onApply}
                  />
                );
              }
              return <code className="inline-code" {...props}>{children}</code>;
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
});

/**
 * Code block with actions
 */
const CodeBlock: React.FC<{
  language: string;
  code: string;
  onCopy: (text: string) => void;
  onRun: (command: string) => void;
  onApply: (code: string, language: string) => void;
}> = ({ language, code, onCopy, onRun, onApply }) => {
  const [copied, setCopied] = React.useState(false);
  const isBash = ['bash', 'sh', 'shell', 'zsh'].includes(language.toLowerCase());

  const handleCopy = () => {
    onCopy(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <div className="code-block-actions">
          <button className="code-action-btn" onClick={handleCopy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {isBash && (
            <button className="code-action-btn primary" onClick={() => onRun(code)}>
              Run
            </button>
          )}
          {!isBash && (
            <button className="code-action-btn" onClick={() => onApply(code, language)}>
              Apply
            </button>
          )}
        </div>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '12px',
          background: '#0d0d0d',
          fontSize: '13px',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * Mini AI logo for messages - Cloud with Circuit icon
 */
const AIMiniLogo = () => (
  <svg width="20" height="16" viewBox="0 0 64 48">
    <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1 0-2 .1-3 .4C47 4 42.5 0 37 0c-6.5 0-12 5-12.5 11.5C20 12 16 16.5 16 22c0 6 5 11 11 11h25z" fill="#2196F3"/>
    <path d="M48 32c4 0 7.5-3 8-7H10c.5 4 4 7 8 7h30z" fill="#1976D2"/>
    <circle cx="32" cy="24" r="10" fill="#7C4DFF"/>
    <circle cx="32" cy="24" r="2" fill="white"/>
    <circle cx="26" cy="20" r="1.5" fill="white"/>
    <circle cx="38" cy="20" r="1.5" fill="white"/>
    <circle cx="26" cy="28" r="1.5" fill="white"/>
    <circle cx="38" cy="28" r="1.5" fill="white"/>
    <line x1="32" y1="24" x2="26" y2="20" stroke="white" strokeWidth="1.5"/>
    <line x1="32" y1="24" x2="38" y2="20" stroke="white" strokeWidth="1.5"/>
    <line x1="32" y1="24" x2="26" y2="28" stroke="white" strokeWidth="1.5"/>
    <line x1="32" y1="24" x2="38" y2="28" stroke="white" strokeWidth="1.5"/>
  </svg>
);

/**
 * User icon
 */
const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#A0A0A0">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </svg>
);

export default MessageArea;
