import React from 'react';

/**
 * WelcomeHero - Centered empty state with Enterprise AI logo
 */
const WelcomeHero: React.FC = () => {
  return (
    <div className="welcome-hero">
      {/* Enterprise AI Logo - Cloud with Circuit */}
      <div className="welcome-logo">
        <svg viewBox="0 0 64 48" className="pixel-logo">
          {/* Cloud shape */}
          <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1 0-2 .1-3 .4C47 4 42.5 0 37 0c-6.5 0-12 5-12.5 11.5C20 12 16 16.5 16 22c0 6 5 11 11 11h25z" fill="#2196F3"/>
          <path d="M48 32c4 0 7.5-3 8-7H10c.5 4 4 7 8 7h30z" fill="#1976D2"/>
          {/* Purple circle with circuit */}
          <circle cx="32" cy="24" r="10" fill="#7C4DFF"/>
          {/* Circuit pattern inside */}
          <circle cx="32" cy="24" r="2" fill="white"/>
          <circle cx="26" cy="20" r="1.5" fill="white"/>
          <circle cx="38" cy="20" r="1.5" fill="white"/>
          <circle cx="26" cy="28" r="1.5" fill="white"/>
          <circle cx="38" cy="28" r="1.5" fill="white"/>
          <line x1="32" y1="24" x2="26" y2="20" stroke="white" strokeWidth="1.5"/>
          <line x1="32" y1="24" x2="38" y2="20" stroke="white" strokeWidth="1.5"/>
          <line x1="32" y1="24" x2="26" y2="28" stroke="white" strokeWidth="1.5"/>
          <line x1="32" y1="24" x2="38" y2="28" stroke="white" strokeWidth="1.5"/>
        </svg>
      </div>

      {/* Title */}
      <h1 className="welcome-title">Enterprise AI</h1>

      {/* Subtitle */}
      <p className="welcome-subtitle">
        Your AI-powered coding assistant connected to the enterprise backend
      </p>

      {/* Keyboard hint */}
      <div className="welcome-hint">
        Press <kbd>Ctrl</kbd> + <kbd>Esc</kbd> to focus the input
      </div>

      {/* Quick actions */}
      <div className="welcome-actions">
        <button className="welcome-action-btn" onClick={() => {
          const vscode = (window as any).acquireVsCodeApi?.();
          vscode?.postMessage({ type: 'send', message: 'Explain the selected code' });
        }}>
          <span className="action-icon">{'</>'}</span>
          Explain code
        </button>
        <button className="welcome-action-btn" onClick={() => {
          const vscode = (window as any).acquireVsCodeApi?.();
          vscode?.postMessage({ type: 'send', message: 'Find and fix bugs in my code' });
        }}>
          <span className="action-icon">🐛</span>
          Fix bugs
        </button>
        <button className="welcome-action-btn" onClick={() => {
          const vscode = (window as any).acquireVsCodeApi?.();
          vscode?.postMessage({ type: 'send', message: 'Write unit tests for this code' });
        }}>
          <span className="action-icon">✓</span>
          Write tests
        </button>
      </div>
    </div>
  );
};

export default WelcomeHero;
