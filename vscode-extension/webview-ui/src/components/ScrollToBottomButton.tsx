import React from 'react';

interface ScrollToBottomButtonProps {
  onClick: () => void;
  visible: boolean;
  unreadCount?: number;
}

const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  onClick,
  visible,
  unreadCount = 0,
}) => {
  if (!visible) return null;

  return (
    <button
      className="scroll-to-bottom-btn"
      onClick={onClick}
      aria-label="Scroll to bottom"
      title="Scroll to bottom"
    >
      <ArrowDownIcon />
      {unreadCount > 0 && (
        <span className="unread-badge">{unreadCount}</span>
      )}
    </button>
  );
};

const ArrowDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default ScrollToBottomButton;
