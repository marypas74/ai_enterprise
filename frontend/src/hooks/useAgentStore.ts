// Backward compatibility facade - prefer using individual stores directly
import { useSessionStore } from './useSessionStore.js';
import { useTemplateStore } from './useTemplateStore.js';
import { useOrchestratorStore } from './useOrchestratorStore.js';
import { useWorktreeStore } from './useWorktreeStore.js';

// Re-export types
export type {
  AgentSession,
  SessionConfig,
  SessionLog,
  AgentTemplate,
  CreateSessionData,
} from '../types/agent.js';

export type {
  TerminalSlot,
  OrchestratorMetrics,
  WorktreeStatus,
  ConflictContent,
} from '../types/orchestrator.js';

// Re-export individual stores
export { useSessionStore, useTemplateStore, useOrchestratorStore, useWorktreeStore };

// Legacy combined hook for backward compatibility
export function useAgentStore() {
  const sessions = useSessionStore();
  const templates = useTemplateStore();
  const orchestrator = useOrchestratorStore();
  const worktree = useWorktreeStore();

  return {
    ...sessions,
    ...templates,
    ...orchestrator,
    ...worktree,
    // Provide a combined fetchDashboard that updates all stores (matching original behavior)
    fetchDashboard: async () => {
      const result = await orchestrator.fetchDashboard();
      if (result) {
        const { user, templates: dashTemplates } = result;
        useSessionStore.setState({
          activeSessions: user.activeSessions,
          sessions: user.recentSessions,
        });
        useTemplateStore.setState({
          templates: dashTemplates,
        });
      }
      return result;
    },
    // Provide a combined connectWebSocket that dispatches events to session store
    connectWebSocket: (sessionId?: number) => {
      // The orchestrator store handles its own WS events (terminal_assigned, terminal_released, initial)
      // For session-related events (log_added, session_updated, etc.), we hook into the WS
      // by using the orchestrator's connectWebSocket and providing cross-store updates
      orchestrator.connectWebSocket(sessionId);
    },
  };
}
