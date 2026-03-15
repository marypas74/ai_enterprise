import React from 'react';

interface StreamingTextProps {
  content: string;
  isStreaming: boolean;
}

export const StreamingText: React.FC<StreamingTextProps> = ({ content, isStreaming }) => {
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {content}
      {isStreaming && (
        <span
          style={{
            animation: 'blink 1s step-end infinite',
            marginLeft: '1px',
          }}
        >
          {'\u2588'}
        </span>
      )}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </span>
  );
};
