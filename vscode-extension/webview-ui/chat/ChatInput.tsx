import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ModelPicker } from '../shared/components/ModelPicker';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ChatInputProps {
  models: Model[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  models,
  selectedModel,
  onModelChange,
  onSend,
  onAbort,
  isStreaming,
  disabled,
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || disabled) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ModelPicker
          models={models}
          selected={selectedModel}
          onChange={onModelChange}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Please log in first...' : 'Type a message... (Shift+Enter for newline)'}
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
            disabled={disabled || !input.trim()}
            style={{ flexShrink: 0 }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
