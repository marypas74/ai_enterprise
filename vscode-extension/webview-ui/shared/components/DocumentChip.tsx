import React from 'react';

interface DocumentChipProps {
  name: string;
  onRemove: () => void;
}

export const DocumentChip: React.FC<DocumentChipProps> = ({ name, onRemove }) => {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: 'var(--vscode-badge-background)',
        color: 'var(--vscode-badge-foreground)',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        maxWidth: '200px',
      }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={name}
      >
        @{name}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: '0 2px',
          fontSize: '14px',
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
        }}
        title="Remove document"
        aria-label={`Remove ${name}`}
      >
        x
      </button>
    </span>
  );
};
