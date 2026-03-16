import React, { useState, useCallback, useEffect } from 'react';
import { useVsCodeMessage, usePostMessage } from '../shared/hooks/useVsCodeApi';
import { useAuth } from '../shared/hooks/useAuth';
import type { OrchestratorSlot, OrchestratorStatus, SseState } from '../shared/types';
import { SlotGrid } from './SlotGrid';
import { SlotDetail } from './SlotDetail';

type ExtensionMessage =
  | { type: 'setStatus'; payload: OrchestratorStatus }
  | { type: 'slotUpdated'; payload: { slot: OrchestratorSlot } }
  | { type: 'sseStatus'; payload: SseState }
  | { type: 'setAuthenticated'; payload: { user: { id: number; email: string; name: string; role: string } } }
  | { type: 'setUnauthenticated' };

export function OrchestratorApp() {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [sseStatus, setSseStatus] = useState<SseState>({ connected: false });
  const { isAuthenticated, setAuthenticated, setUnauthenticated } = useAuth();
  const postMessage = usePostMessage();

  useVsCodeMessage<ExtensionMessage>((msg) => {
    switch (msg.type) {
      case 'setStatus':
        setStatus(msg.payload);
        break;
      case 'slotUpdated': {
        const updatedSlot = msg.payload.slot;
        setStatus((prev) => {
          if (!prev) return prev;
          const newSlots = prev.slots.map((s) =>
            s.id === updatedSlot.id ? updatedSlot : s,
          );
          const activeSlots = newSlots.filter((s) => s.busy).length;
          return { ...prev, slots: newSlots, activeSlots };
        });
        break;
      }
      case 'sseStatus':
        setSseStatus(msg.payload);
        break;
      case 'setAuthenticated':
        setAuthenticated(msg.payload.user);
        break;
      case 'setUnauthenticated':
        setUnauthenticated();
        setStatus(null);
        setSelectedSlotId(null);
        break;
    }
  });

  const handleReleaseSlot = useCallback((slotId: number) => {
    postMessage({ type: 'releaseSlot', payload: { slotId } });
  }, [postMessage]);

  const handleTerminateSession = useCallback((sessionId: string) => {
    postMessage({ type: 'terminateSession', payload: { sessionId } });
  }, [postMessage]);

  useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  const selectedSlot = status?.slots.find((s) => s.id === selectedSlotId) ?? null;

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Login required. Use <strong>Enterprise AI: Login</strong> from the Command Palette.</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading orchestrator status...
      </div>
    );
  }

  const usage = status.totalSlots > 0 ? status.activeSlots / status.totalSlots : 0;
  const usageLabel = usage > 0.8 ? 'HIGH LOAD' : usage >= 0.5 ? 'Moderate' : 'Normal';
  const usageColor = usage > 0.8 ? '#f85149' : usage >= 0.5 ? '#d29922' : '#2ea043';

  return (
    <div style={{ padding: 16, height: '100vh', overflow: 'auto' }}>
      {!sseStatus.connected && sseStatus.message && (
        <div className="error-banner" style={{ marginBottom: 12 }}>
          {sseStatus.message}
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Orchestrator Dashboard
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14 }}>
            <strong>{status.activeSlots}</strong>/{status.totalSlots} slots
          </span>
          <span style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            background: usageColor,
            color: '#fff',
          }}>
            {usageLabel}
          </span>
        </div>
      </div>

      <SlotGrid
        slots={status.slots}
        selectedSlotId={selectedSlotId}
        onSelectSlot={setSelectedSlotId}
      />

      {selectedSlot && selectedSlot.busy && (
        <SlotDetail
          slot={selectedSlot}
          onRelease={handleReleaseSlot}
          onTerminate={handleTerminateSession}
        />
      )}
    </div>
  );
}
