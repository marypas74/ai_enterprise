import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { StreamingText } from './StreamingText';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ role, content, isStreaming = false }) => {
  const isUser = role === 'user';

  const bubbleStyle: React.CSSProperties = {
    maxWidth: '85%',
    padding: '10px 14px',
    borderRadius: '12px',
    marginBottom: '8px',
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
    color: isUser ? 'var(--accent-text)' : 'var(--text-primary)',
    wordBreak: 'break-word',
  };

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: isUser ? 'flex-end' : 'flex-start',
  };

  return (
    <div style={wrapperStyle}>
      <div style={bubbleStyle}>
        {isUser ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
        ) : isStreaming ? (
          <StreamingText content={content} isStreaming={true} />
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeText = String(children).replace(/\n$/, '');
                if (match) {
                  return <CodeBlock language={match[1]} value={codeText} />;
                }
                return (
                  <code
                    className={className}
                    style={{
                      background: 'var(--input-bg)',
                      padding: '2px 5px',
                      borderRadius: '3px',
                      fontSize: '0.9em',
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
};
