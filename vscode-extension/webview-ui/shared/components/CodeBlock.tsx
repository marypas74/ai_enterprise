import React, { useCallback, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  language: string;
  value: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <div style={{ position: 'relative', margin: '8px 0' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#1e1e1e',
          padding: '4px 12px',
          borderRadius: '6px 6px 0 0',
          fontSize: '0.8em',
          color: '#888',
        }}
      >
        <span>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'transparent',
            color: '#888',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: '0.85em',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          borderRadius: '0 0 6px 6px',
          fontSize: '0.9em',
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};
