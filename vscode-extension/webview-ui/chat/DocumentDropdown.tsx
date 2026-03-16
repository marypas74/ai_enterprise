import React, { useEffect, useRef, useCallback } from 'react';

interface Document {
  id: number;
  name: string;
  type: string;
  size: number;
}

interface DocumentDropdownProps {
  documents: Document[];
  query: string;
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (doc: Document) => void;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getTypeIcon(type: string): string {
  const iconMap: Record<string, string> = {
    pdf: 'file-pdf',
    docx: 'file-text',
    doc: 'file-text',
    xlsx: 'file-excel',
    xls: 'file-excel',
    pptx: 'file-presentation',
    ppt: 'file-presentation',
    txt: 'file-text',
    md: 'markdown',
    csv: 'file-csv',
  };
  return iconMap[type.toLowerCase()] ?? 'file';
}

export const DocumentDropdown: React.FC<DocumentDropdownProps> = ({
  documents,
  query,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    if (!isVisible) { return; }

    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  const highlightMatch = useCallback(
    (name: string) => {
      if (!query) { return name; }

      const lowerName = name.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const parts: React.ReactNode[] = [];
      let queryIdx = 0;

      for (let i = 0; i < name.length; i++) {
        if (queryIdx < lowerQuery.length && lowerName[i] === lowerQuery[queryIdx]) {
          parts.push(
            <strong key={i} style={{ color: 'var(--vscode-list-highlightForeground)' }}>
              {name[i]}
            </strong>,
          );
          queryIdx++;
        } else {
          parts.push(name[i]);
        }
      }

      return <>{parts}</>;
    },
    [query],
  );

  if (!isVisible || documents.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        maxHeight: '240px',
        overflowY: 'auto',
        background: 'var(--vscode-editorSuggestWidget-background)',
        border: '1px solid var(--vscode-editorSuggestWidget-border)',
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        zIndex: 1000,
      }}
      role="listbox"
      aria-label="Document suggestions"
    >
      {documents.map((doc, index) => (
        <div
          key={doc.id}
          ref={index === selectedIndex ? selectedRef : undefined}
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => onSelect(doc)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            background:
              index === selectedIndex
                ? 'var(--vscode-list-activeSelectionBackground)'
                : 'transparent',
            color:
              index === selectedIndex
                ? 'var(--vscode-list-activeSelectionForeground)'
                : 'var(--vscode-editorSuggestWidget-foreground)',
          }}
          onMouseEnter={(e) => {
            if (index !== selectedIndex) {
              e.currentTarget.style.background =
                'var(--vscode-list-hoverBackground)';
            }
          }}
          onMouseLeave={(e) => {
            if (index !== selectedIndex) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <span
            className={`codicon codicon-${getTypeIcon(doc.type)}`}
            style={{ fontSize: '16px', flexShrink: 0 }}
          />
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {highlightMatch(doc.name)}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--vscode-descriptionForeground)',
              flexShrink: 0,
            }}
          >
            {formatSize(doc.size)}
          </span>
        </div>
      ))}
    </div>
  );
};
