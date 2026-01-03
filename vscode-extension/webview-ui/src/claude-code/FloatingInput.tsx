import React, { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';

interface FloatingInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * FloatingInput - Enterprise AI style floating input at bottom center
 * Features:
 * - Floating container with max-width 700px
 * - "Ask before edits" pill toggle
 * - Auto-growing textarea
 * - Orange send button
 */
const FloatingInput: React.FC<FloatingInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Ask Enterprise AI anything...',
}) => {
  const [value, setValue] = useState('');
  const [askBeforeEdits, setAskBeforeEdits] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, [value]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Global keyboard shortcut: Ctrl+Esc to focus
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && e.ctrlKey) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue('');

    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Refocus
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="floating-input-wrapper">
      <div className="floating-input-container">
        {/* Top hint */}
        <div className="input-hint-top">
          <kbd>ctrl</kbd> <kbd>esc</kbd> to focus or unfocus Enterprise AI
        </div>

        {/* Main input area */}
        <div className="input-main">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="input-textarea"
            rows={1}
            aria-label="Message input"
          />
        </div>

        {/* Bottom action bar */}
        <div className="input-bottom-row">
          {/* Left: Options */}
          <div className="input-options">
            {/* Ask before edits pill */}
            <button
              className={`pill-button ${askBeforeEdits ? 'active' : ''}`}
              onClick={() => setAskBeforeEdits(!askBeforeEdits)}
              title="Toggle ask before edits"
            >
              <span className="checkmark">
                {askBeforeEdits && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <polyline
                      points="20 6 9 17 4 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    />
                  </svg>
                )}
              </span>
              Ask before edits
            </button>

            {/* File context indicator */}
            <span className="context-indicator">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
              Untitled-1
            </span>
          </div>

          {/* Right: Send button */}
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className="send-button"
            title="Send message (Enter)"
            aria-label="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M22 2L11 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M22 2L15 22L11 13L2 9L22 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FloatingInput;
