import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  KeyboardEvent,
  ChangeEvent,
} from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxRows?: number;
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Type a message... (Shift+Enter for new line)',
  maxRows = 8,
}) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to calculate scroll height
    textarea.style.height = 'auto';

    // Calculate line height
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
    const maxHeight = lineHeight * maxRows;

    // Set new height
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Show scrollbar if exceeding max
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxRows]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  // Focus on mount and after sending
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const handleSend = useCallback(() => {
    const trimmedValue = value.trim();
    if (!trimmedValue || disabled) return;

    onSend(trimmedValue);
    setValue('');

    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Refocus
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }

      // Allow Shift+Enter for new line (default behavior)
    },
    [handleSend]
  );

  // Character count for long messages
  const charCount = value.length;
  const showCharCount = charCount > 500;

  return (
    <div className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="chat-input"
          rows={1}
          aria-label="Message input"
        />

        <div className="chat-input-actions">
          {showCharCount && (
            <span className="char-count">{charCount}</span>
          )}

          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className="send-button"
            title="Send message (Enter)"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      <div className="input-hint">
        <kbd>Enter</kbd> to send, <kbd>Shift</kbd>+<kbd>Enter</kbd> for new line
      </div>
    </div>
  );
};

// Send icon component
const SendIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export default ChatInput;
