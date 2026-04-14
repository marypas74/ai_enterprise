import { useEffect, useRef } from 'react';
import { useAuthStore } from './useAuthStore';
import { useJobStore } from '../stores/useJobStore';

/**
 * Connects to /ws/jobs WebSocket and updates useJobStore on job events.
 * Mount once at app level (ChatPage or App).
 */
export function useJobNotifications(
  onJobComplete?: (conversationId: number, messageId?: number) => void
) {
  const { accessToken, isAuthenticated } = useAuthStore();
  const { removeJob } = useJobStore();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/jobs?token=${encodeURIComponent(accessToken)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job_complete') {
          removeJob(data.jobId);
          onJobComplete?.(data.conversationId, data.messageId);
        }
        if (data.type === 'job_error') {
          removeJob(data.jobId);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      // silently ignore — will reconnect on next mount
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isAuthenticated, accessToken]);
}
