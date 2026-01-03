import React, { useState, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  language?: string;
  children: string;
  onCopy?: (code: string) => void;
  onRun?: (code: string, language: string) => void;
  onApply?: (code: string, language: string) => void;
}

// VS Code-themed syntax highlighting style
const vsCodeTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: 'var(--vscode-editor-background)',
    margin: 0,
    padding: '12px',
    fontSize: '13px',
    fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Courier New", monospace)',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
    fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Courier New", monospace)',
  },
};

const CodeBlock: React.FC<CodeBlockProps> = ({
  language = 'text',
  children,
  onCopy,
  onRun,
  onApply,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      onCopy?.(children);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [children, onCopy]);

  const handleRun = useCallback(() => {
    onRun?.(children, language);
  }, [children, language, onRun]);

  const handleApply = useCallback(() => {
    onApply?.(children, language);
  }, [children, language, onApply]);

  const isBashCommand = ['bash', 'sh', 'shell', 'zsh', 'terminal', 'cmd'].includes(
    language.toLowerCase()
  );
  const isCodeFile = !isBashCommand && language !== 'text' && language !== '';

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-language">{language || 'text'}</span>
        <div className="code-actions">
          <button
            className="code-action-btn"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? (
              <CheckIcon />
            ) : (
              <CopyIcon />
            )}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          {isBashCommand && onRun && (
            <button
              className="code-action-btn run"
              onClick={handleRun}
              title="Run in terminal"
            >
              <PlayIcon />
              <span>Run</span>
            </button>
          )}

          {isCodeFile && onApply && (
            <button
              className="code-action-btn apply"
              onClick={handleApply}
              title="Apply to editor"
            >
              <ApplyIcon />
              <span>Apply</span>
            </button>
          )}
        </div>
      </div>

      <SyntaxHighlighter
        language={language}
        style={vsCodeTheme}
        customStyle={{
          margin: 0,
          borderRadius: '0 0 6px 6px',
        }}
        showLineNumbers={children.split('\n').length > 5}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          color: 'var(--vscode-editorLineNumber-foreground)',
          userSelect: 'none',
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
};

// Icon components
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const ApplyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

export default CodeBlock;
