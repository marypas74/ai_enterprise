import React from 'react';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss }) => {
  return (
    <div
      className="error-banner"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent',
          color: 'var(--error)',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 6px',
          fontSize: '1.1em',
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label="Dismiss error"
      >
        x
      </button>
    </div>
  );
};
