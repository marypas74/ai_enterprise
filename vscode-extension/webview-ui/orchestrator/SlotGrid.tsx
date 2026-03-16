import React from 'react';
import type { OrchestratorSlot } from '../shared/types';

interface SlotGridProps {
  slots: OrchestratorSlot[];
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
}

export function SlotGrid({ slots, selectedSlotId, onSelectSlot }: SlotGridProps) {
  // Ensure we always show 12 slots even if API returns fewer
  const normalizedSlots: OrchestratorSlot[] = Array.from({ length: 12 }, (_, i) => {
    const existing = slots.find((s) => s.id === i);
    return existing ?? { id: i, busy: false };
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 8,
      marginBottom: 16,
    }}>
      {normalizedSlots.map((slot) => (
        <div
          key={slot.id}
          onClick={() => onSelectSlot(slot.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelectSlot(slot.id); }}
          style={{
            padding: 12,
            borderRadius: 6,
            border: slot.id === selectedSlotId
              ? '2px solid var(--accent)'
              : '1px solid var(--border)',
            background: slot.busy
              ? 'var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.15))'
              : 'var(--bg-secondary)',
            cursor: slot.busy ? 'pointer' : 'default',
            transition: 'border-color 0.15s',
            minHeight: 80,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}>
              Slot {slot.id}
            </span>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: slot.busy ? '#2ea043' : '#484f58',
              flexShrink: 0,
            }} />
          </div>

          {slot.busy ? (
            <div style={{ marginTop: 6 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {slot.agentName ?? 'Agent'}
              </div>
              {slot.progress !== undefined && (
                <div style={{
                  marginTop: 4,
                  height: 3,
                  borderRadius: 2,
                  background: 'var(--vscode-progressBar-background, #0078d4)',
                  width: `${Math.min(100, Math.max(0, slot.progress))}%`,
                  transition: 'width 0.3s ease',
                }} />
              )}
              <div style={{
                fontSize: 10,
                color: 'var(--text-secondary)',
                marginTop: 4,
              }}>
                {slot.startedAt ? formatDuration(slot.startedAt) : ''}
              </div>
            </div>
          ) : (
            <div style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              marginTop: 6,
            }}>
              Free
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatDuration(startedAt: string): string {
  if (!startedAt) return '';
  try {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - start) / 1000);

    if (diffSec < 60) return `${diffSec}s`;
    const min = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    if (min < 60) return `${min}m ${sec}s`;
    const hrs = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hrs}h ${remMin}m`;
  } catch {
    return '';
  }
}
