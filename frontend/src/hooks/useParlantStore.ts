// Backward compatibility facade
import { useParlantAgentStore } from './parlant/useParlantAgentStore.js';
import { useParlantGuidelinesStore } from './parlant/useParlantGuidelinesStore.js';
import { useParlantSessionStore } from './parlant/useParlantSessionStore.js';

// Re-export types
export type {
  ParlantAgent,
  ParlantGuideline,
  ParlantSession,
  ParlantEvent,
  ParlantEvaluation
} from '../types/parlant.js';

// Re-export individual stores
export { useParlantAgentStore, useParlantGuidelinesStore, useParlantSessionStore };

// Legacy combined hook
export function useParlantStore() {
  const agents = useParlantAgentStore();
  const guidelines = useParlantGuidelinesStore();
  const sessions = useParlantSessionStore();

  return {
    ...agents,
    ...guidelines,
    ...sessions,
  };
}
