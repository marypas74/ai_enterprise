import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getVsCodeApi } from '../shared/hooks/useVsCodeApi';
import { DocumentChip } from '../shared/components/DocumentChip';
import { DocumentDropdown } from './DocumentDropdown';
import { ModelPicker } from '../shared/components/ModelPicker';

interface Document {
  id: number;
  name: string;
  type: string;
  size: number;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ChatInputProps {
  models: Model[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  onSend: (message: string, documentIds: number[]) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled: boolean;
  documents: Document[];
}

export const ChatInput: React.FC<ChatInputProps> = ({
  models,
  selectedModel,
  onModelChange,
  onSend,
  onAbort,
  isStreaming,
  disabled,
  documents,
}) => {
  const [message, setMessage] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<Document[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownQuery, setDropdownQuery] = useState('');
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  // Filter documents based on dropdown query
  const filteredDocs = useMemo(() => {
    if (!dropdownQuery) { return documents; }
    const lower = dropdownQuery.toLowerCase();
    return documents.filter((doc) => {
      const lowerName = doc.name.toLowerCase();
      let qi = 0;
      for (let i = 0; i < lowerName.length && qi < lower.length; i++) {
        if (lowerName[i] === lower[qi]) { qi++; }
      }
      return qi === lower.length;
    });
  }, [documents, dropdownQuery]);

  // Request documents from extension when dropdown opens
  useEffect(() => {
    if (showDropdown && documents.length === 0) {
      getVsCodeApi().postMessage({ type: 'loadDocuments' });
    }
  }, [showDropdown, documents.length]);

  // Detect @document trigger
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setMessage(value);

      // Auto-resize
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;

      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = value.slice(0, cursorPos);

      // Look for @ trigger
      const atIndex = textBeforeCursor.lastIndexOf('@');
      if (atIndex >= 0) {
        const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' ';
        // Only trigger if @ is at start or preceded by whitespace
        if (atIndex === 0 || /\s/.test(charBefore)) {
          const query = textBeforeCursor.slice(atIndex + 1);
          // Don't trigger if there's a space in the query (user moved on)
          if (!query.includes(' ') && !query.includes('\n')) {
            setShowDropdown(true);
            setDropdownQuery(query);
            setTriggerPosition(atIndex);
            setDropdownIndex(0);

            // Request search if we have a query
            if (query.length > 0) {
              getVsCodeApi().postMessage({
                type: 'searchDocuments',
                payload: { query },
              });
            }
            return;
          }
        }
      }

      // No valid trigger found
      if (showDropdown) {
        setShowDropdown(false);
        setDropdownQuery('');
        setTriggerPosition(-1);
      }
    },
    [showDropdown],
  );

  // Handle document selection from dropdown
  const handleDocumentSelect = useCallback(
    (doc: Document) => {
      // Replace the @query with empty string (document shown as chip)
      const before = message.slice(0, triggerPosition);
      const cursorPos = textareaRef.current?.selectionStart ?? message.length;
      const after = message.slice(cursorPos);
      const newMessage = before + after;

      setMessage(newMessage);
      setSelectedDocs((prev) => {
        if (prev.some((d) => d.id === doc.id)) { return prev; }
        return [...prev, doc];
      });
      setShowDropdown(false);
      setDropdownQuery('');
      setTriggerPosition(-1);

      // Focus back on textarea
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [message, triggerPosition],
  );

  // Remove selected document
  const handleRemoveDoc = useCallback((docId: number) => {
    setSelectedDocs((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  // Close dropdown
  const handleCloseDropdown = useCallback(() => {
    setShowDropdown(false);
    setDropdownQuery('');
    setTriggerPosition(-1);
  }, []);

  // Send message
  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed && selectedDocs.length === 0) { return; }
    if (isStreaming || disabled) { return; }

    onSend(trimmed, selectedDocs.map((d) => d.id));
    setMessage('');
    setSelectedDocs([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [message, selectedDocs, isStreaming, disabled, onSend]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown) {
        const filtered = filteredDocs;
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setDropdownIndex((prev) =>
              prev < filtered.length - 1 ? prev + 1 : 0,
            );
            return;
          case 'ArrowUp':
            e.preventDefault();
            setDropdownIndex((prev) =>
              prev > 0 ? prev - 1 : filtered.length - 1,
            );
            return;
          case 'Enter':
          case 'Tab':
            e.preventDefault();
            if (filtered[dropdownIndex]) {
              handleDocumentSelect(filtered[dropdownIndex]);
            }
            return;
          case 'Escape':
            e.preventDefault();
            handleCloseDropdown();
            return;
        }
      }

      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showDropdown, dropdownIndex, filteredDocs, handleDocumentSelect, handleCloseDropdown, handleSend],
  );

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Selected documents chips */}
      {selectedDocs.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
          }}
        >
          {selectedDocs.map((doc) => (
            <DocumentChip
              key={doc.id}
              name={doc.name}
              onRemove={() => handleRemoveDoc(doc.id)}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ModelPicker
          models={models}
          selected={selectedModel}
          onChange={onModelChange}
        />
      </div>

      {/* Input area with dropdown */}
      <div style={{ position: 'relative' }}>
        <DocumentDropdown
          documents={filteredDocs}
          query={dropdownQuery}
          isVisible={showDropdown}
          selectedIndex={dropdownIndex}
          onSelect={handleDocumentSelect}
          onClose={handleCloseDropdown}
        />

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Please log in first...' : 'Type a message... (@ for documents, Shift+Enter for newline)'}
            disabled={disabled || isStreaming}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              minHeight: '36px',
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          />
          {isStreaming ? (
            <button
              onClick={onAbort}
              style={{
                background: 'var(--error)',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={disabled || (!message.trim() && selectedDocs.length === 0)}
              style={{ flexShrink: 0 }}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
