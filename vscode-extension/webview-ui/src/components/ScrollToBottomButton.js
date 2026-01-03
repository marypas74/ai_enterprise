"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const ScrollToBottomButton = ({ onClick, visible, unreadCount = 0, }) => {
    if (!visible)
        return null;
    return (<button className="scroll-to-bottom-btn" onClick={onClick} aria-label="Scroll to bottom" title="Scroll to bottom">
      <ArrowDownIcon />
      {unreadCount > 0 && (<span className="unread-badge">{unreadCount}</span>)}
    </button>);
};
const ArrowDownIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9"/>
  </svg>);
exports.default = ScrollToBottomButton;
//# sourceMappingURL=ScrollToBottomButton.js.map