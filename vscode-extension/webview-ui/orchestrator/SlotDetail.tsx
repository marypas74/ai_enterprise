import React, { useState } from 'react';
import type { OrchestratorSlot } from '../shared/types';

interface SlotDetailProps {
  slot: OrchestratorSlot;
  onRelease: (slotId: number) => void;
  onTerminate: (sessionId: string) => void;
}

export function SlotDetail({ slot, onRelease, onTerminate }: SlotDetailProps) {
  const [confirmAction, setConfirmAction] = useState<'release' | 'terminate' | null>(null);

  const handleRelease = () => {
    if (confirmAction === 'release') {
      onRelease(slot.id);
      setConfirmAction(null);
    } else {
      setConfirmAction('release');
    }
  };

  const handleTerminate = () => {
    if (confirmAction === 'terminate' && slot.sessionId) {
      onTerminate(slot.sessionId);
      setConfirmAction(null);
    } else {
      setConfirmAction('terminate');
    }
  };

  const handleCancelConfirm = () => {
    setConfirmAction(null);
  };

  return (
    <div style={{
      padding: 16,
      border: '1px solid var(--border)',
      borderRadius: 6,
      background: 'var(--bg-secondary)',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 14 }}>
        Slot {slot.id} Detail
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Agent:</span>
        <span>{slot.agentName ?? 'Unknown'}</span>

        <span style={{ color: 'var(--text-secondary)' }}>Session ID:</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{slot.sessionId ?? '\u2014'}</span>

        <span style={{ color: 'var(--text-secondary)' }}>Started:</span>
        <span>{slot.startedAt ? new Date(slot.startedAt).toLocaleString() : '\u2014'}</span>

        <span style={{ color: 'var(--text-secondary)' }}>Progress:</span>
        <span>{slot.progress !== undefined ? `${slot.progress}%` : '\u2014'}</span>
      </div>

      {slot.progress !== undefined && (
        <div style={{
          marginTop: 12,
          height: 6,
          borderRadius: 3,
          background: 'var(--vscode-editor-background)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            borderRadius: 3,
            background: 'var(--vscode-progressBar-background, #0078d4)',
            width: `${Math.min(100, Math.max(0, slot.progress))}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          onClick={handleRelease}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            background: confirmAction === 'release'
              ? 'var(--vscode-inputValidation-warningBackground)'
              : 'var(--vscode-button-secondaryBackground)',
            color: confirmAction === 'release'
              ? 'var(--vscode-editorWarning-foreground)'
              : 'var(--vscode-button-secondaryForeground)',
          }}
          title={confirmAction === 'release' ? 'Click again to confirm' : 'Release this slot'}
        >
          {confirmAction === 'release' ? 'Confirm Release' : 'Release Slot'}
        </button>

        {slot.sessionId && (
          <button
            onClick={handleTerminate}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              background: confirmAction === 'terminate'
                ? 'var(--vscode-inputValidation-errorBackground)'
                : 'var(--vscode-button-secondaryBackground)',
              color: confirmAction === 'terminate'
                ? 'var(--error)'
                : 'var(--vscode-button-secondaryForeground)',
            }}
            title={confirmAction === 'terminate' ? 'Click again to confirm' : 'Terminate the associated session'}
          >
            {confirmAction === 'terminate' ? 'Confirm Terminate' : 'Terminate Session'}
          </button>
        )}

        {confirmAction && (
          <button
            onClick={handleCancelConfirm}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
