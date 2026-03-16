import { create } from 'zustand';
import { api } from '../services/api';
import type { AgentSession, AgentTemplate, TerminalSlot, OrchestratorMetrics, SessionLog } from '../types/index.js';

interface OrchestratorState {
  terminalSlots: TerminalSlot[];
  orchestratorMetrics: OrchestratorMetrics | null;
  wsConnection: WebSocket | null;
  isLoading: boolean;
  error: string | null;

  fetchTerminalSlots: () => Promise<void>;
  fetchOrchestratorMetrics: () => Promise<void>;
  fetchDashboard: () => Promise<any>;
  connectWebSocket: (sessionId?: number) => void;
  disconnectWebSocket: () => void;
  clearError: () => void;
}

const orchestratorApi = {
  status: () => api.get('/orchestrator/status'),
  terminals: () => api.get('/orchestrator/terminals'),
  dashboard: () => api.get('/orchestrator/dashboard'),
  health: () => api.get('/orchestrator/health'),
};

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  terminalSlots: [],
  orchestratorMetrics: null,
  wsConnection: null,
  isLoading: false,
  error: null,

  fetchTerminalSlots: async () => {
    try {
      const response = await orchestratorApi.terminals();
      set({ terminalSlots: response.data.slots });
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch terminal slots' });
    }
  },

  fetchOrchestratorMetrics: async () => {
    try {
      const response = await orchestratorApi.status();
      set({ orchestratorMetrics: response.data });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to fetch metrics';
      const details = err.response?.data?.details;
      const fullError = details ? `${errorMsg}: ${JSON.stringify(details)}` : errorMsg;
      console.error('[OrchestratorStore] fetchOrchestratorMetrics error:', fullError);
      set({ error: fullError });
    }
  },

  fetchDashboard: async () => {
    try {
      const response = await orchestratorApi.dashboard();
      const { orchestrator, user, templates } = response.data;
      set({
        orchestratorMetrics: orchestrator,
      });
      return response.data;
    } catch (err: any) {
      set({ error: err.response?.data?.error || 'Failed to fetch dashboard' });
      return null;
    }
  },

  connectWebSocket: (sessionId) => {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let intentionalClose = false;

    const connect = () => {
      const wsUrl = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
      const path = sessionId ? `/ws/agents/${sessionId}` : '/ws/orchestrator';

      const ws = new WebSocket(`${wsUrl}${path}`);

      ws.onopen = () => {
        console.log('[WS] Connected to', path);
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'log_added':
              // Note: log_added events are handled by consumers who also use useSessionStore
              break;
            case 'session_updated':
            case 'session_completed':
            case 'session_failed':
              // Session updates are handled by consumers who also use useSessionStore
              break;
            case 'terminal_assigned':
            case 'terminal_released':
              get().fetchTerminalSlots();
              break;
            case 'initial':
              set({ orchestratorMetrics: data });
              break;
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        set({ wsConnection: null });

        if (!intentionalClose && reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts++;
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };

      set({ wsConnection: ws });
    };

    connect();

    set({
      disconnectWebSocket: () => {
        intentionalClose = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const { wsConnection } = get();
        if (wsConnection) {
          wsConnection.close();
          set({ wsConnection: null });
        }
      },
    });
  },

  disconnectWebSocket: () => {
    const { wsConnection } = get();
    if (wsConnection) {
      wsConnection.close();
      set({ wsConnection: null });
    }
  },

  clearError: () => set({ error: null }),
}));
