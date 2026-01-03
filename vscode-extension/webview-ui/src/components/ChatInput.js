"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const ChatInput = ({ onSend, disabled = false, placeholder = 'Type a message... (Shift+Enter for new line)', maxRows = 8, }) => {
    const [value, setValue] = (0, react_1.useState)('');
    const textareaRef = (0, react_1.useRef)(null);
    // Auto-resize textarea
    const adjustHeight = (0, react_1.useCallback)(() => {
        const textarea = textareaRef.current;
        if (!textarea)
            return;
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
    (0, react_1.useEffect)(() => {
        adjustHeight();
    }, [value, adjustHeight]);
    // Focus on mount and after sending
    (0, react_1.useEffect)(() => {
        textareaRef.current?.focus();
    }, []);
    const handleChange = (0, react_1.useCallback)((e) => {
        setValue(e.target.value);
    }, []);
    const handleSend = (0, react_1.useCallback)(() => {
        const trimmedValue = value.trim();
        if (!trimmedValue || disabled)
            return;
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
    const handleKeyDown = (0, react_1.useCallback)((e) => {
        // Send on Enter (without Shift)
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        // Allow Shift+Enter for new line (default behavior)
    }, [handleSend]);
    // Character count for long messages
    const charCount = value.length;
    const showCharCount = charCount > 500;
    return (<div className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea ref={textareaRef} value={value} onChange={handleChange} onKeyDown={handleKeyDown} placeholder={placeholder} disabled={disabled} className="chat-input" rows={1} aria-label="Message input"/>

        <div className="chat-input-actions">
          {showCharCount && (<span className="char-count">{charCount}</span>)}

          <button onClick={handleSend} disabled={!value.trim() || disabled} className="send-button" title="Send message (Enter)" aria-label="Send message">
            <SendIcon />
          </button>
        </div>
      </div>

      <div className="input-hint">
        <kbd>Enter</kbd> to send, <kbd>Shift</kbd>+<kbd>Enter</kbd> for new line
      </div>
    </div>);
};
// Send icon component
const SendIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>);
exports.default = ChatInput;
//# sourceMappingURL=ChatInput.js.map