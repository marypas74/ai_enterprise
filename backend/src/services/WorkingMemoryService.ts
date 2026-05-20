/**
 * Working Memory Service — Per-session volatile state in Redis
 *
 * Stores per-user, per-conversation state that persists across turns
 * but is volatile (TTL-based).
 *
 * Stored state:
 *   - recall_query: the query used for memory retrieval
 *   - episodic_memories: recalled episodic results for current turn
 *   - declarative_memories: recalled declarative results
 *   - procedural_memories: recalled procedural results (tools/forms)
 *   - active_form: reference to currently active form session
 *   - model_interactions: log of LLM calls with token counts
 *   - agent_output: intermediate agent chain results
 */

import type { FastifyInstance } from 'fastify';
import type { MemoryPoint } from './VectorMemoryService.js';

export interface WorkingMemoryState {
  userId: number;
  conversationId: number;
  recallQuery: string | null;
  episodicMemories: MemoryPoint[];
  declarativeMemories: MemoryPoint[];
  proceduralMemories: MemoryPoint[];
  activeFormSessionId: number | null;
  agentOutput: AgentOutput | null;
  modelInteractions: ModelInteraction[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  customData: Record<string, any>;
  updatedAt: string;
}

export interface ModelInteraction {
  agent: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
  timestamp: string;
}

export interface AgentOutput {
  proceduresResult: {
    selectedAction: string | null;
    actionInput: string | null;
    toolOutput: string | null;
  } | null;
  intermediateSteps: string[];
  finalResponse: string | null;
}

const WORKING_MEMORY_PREFIX = 'wm:';
const WORKING_MEMORY_TTL = 60 * 60 * 2; // 2 hours

function wmKey(userId: number, conversationId: number): string {
  return `${WORKING_MEMORY_PREFIX}${userId}:${conversationId}`;
}

export class WorkingMemoryService {
  constructor(private fastify: FastifyInstance) {}

  private get redis() {
    return this.fastify.redis;
  }

  /** Create or reset working memory for a new turn */
  async initTurn(userId: number, conversationId: number): Promise<WorkingMemoryState> {
    const existing = await this.get(userId, conversationId);

    const state: WorkingMemoryState = {
      userId,
      conversationId,
      recallQuery: null,
      episodicMemories: [],
      declarativeMemories: [],
      proceduralMemories: [],
      activeFormSessionId: existing?.activeFormSessionId ?? null,
      agentOutput: null,
      modelInteractions: existing?.modelInteractions ?? [],
      customData: existing?.customData ?? {},
      updatedAt: new Date().toISOString(),
    };

    await this.save(state);
    return state;
  }

  /** Get current working memory state */
  async get(userId: number, conversationId: number): Promise<WorkingMemoryState | null> {
    try {
      const raw = await this.redis.get(wmKey(userId, conversationId));
      if (!raw) return null;
      return JSON.parse(raw) as WorkingMemoryState;
    } catch {
      return null;
    }
  }

  /** Save working memory state */
  async save(state: WorkingMemoryState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.redis.set(
      wmKey(state.userId, state.conversationId),
      JSON.stringify(state),
      'EX',
      WORKING_MEMORY_TTL,
    );
  }

  /** Update a specific field */
  async update(
    userId: number,
    conversationId: number,
    patch: Partial<WorkingMemoryState>,
  ): Promise<WorkingMemoryState | null> {
    const state = await this.get(userId, conversationId);
    if (!state) return null;
    Object.assign(state, patch);
    await this.save(state);
    return state;
  }

  /** Record a model interaction */
  async recordInteraction(
    userId: number,
    conversationId: number,
    interaction: ModelInteraction,
  ): Promise<void> {
    const state = await this.get(userId, conversationId);
    if (!state) return;
    state.modelInteractions.push(interaction);
    // Keep only last 20 interactions per session
    if (state.modelInteractions.length > 20) {
      state.modelInteractions = state.modelInteractions.slice(-20);
    }
    await this.save(state);
  }

  /** Store recall results */
  async storeRecallResults(
    userId: number,
    conversationId: number,
    query: string,
    episodic: MemoryPoint[],
    declarative: MemoryPoint[],
    procedural: MemoryPoint[],
  ): Promise<void> {
    await this.update(userId, conversationId, {
      recallQuery: query,
      episodicMemories: episodic,
      declarativeMemories: declarative,
      proceduralMemories: procedural,
    });
  }

  /** Store agent chain output */
  async storeAgentOutput(
    userId: number,
    conversationId: number,
    output: AgentOutput,
  ): Promise<void> {
    await this.update(userId, conversationId, { agentOutput: output });
  }

  /** Set/clear active form session */
  async setActiveForm(userId: number, conversationId: number, formSessionId: number | null): Promise<void> {
    await this.update(userId, conversationId, { activeFormSessionId: formSessionId });
  }

  /** Store custom plugin data */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  async setCustomData(userId: number, conversationId: number, key: string, value: any): Promise<void> {
    const state = await this.get(userId, conversationId);
    if (!state) return;
    state.customData[key] = value;
    await this.save(state);
  }

  /** Delete working memory for a conversation */
  async clear(userId: number, conversationId: number): Promise<void> {
    await this.redis.del(wmKey(userId, conversationId));
  }

  /** Get total token usage for current session */
  getSessionTokens(state: WorkingMemoryState): { input: number; output: number } {
    return state.modelInteractions.reduce(
      (acc, i) => ({
        input: acc.input + i.tokensInput,
        output: acc.output + i.tokensOutput,
      }),
      { input: 0, output: 0 },
    );
  }

  /** List all active working memory sessions for a user */
  async listUserSessions(userId: number): Promise<{ conversationId: number; updatedAt: string; tokenUsage: { input: number; output: number } }[]> {
    const pattern = `${WORKING_MEMORY_PREFIX}${userId}:*`;
    const keys = await this.redis.keys(pattern);
    const sessions: { conversationId: number; updatedAt: string; tokenUsage: { input: number; output: number } }[] = [];

    for (const key of keys) {
      try {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        const state = JSON.parse(raw) as WorkingMemoryState;
        sessions.push({
          conversationId: state.conversationId,
          updatedAt: state.updatedAt,
          tokenUsage: this.getSessionTokens(state),
        });
      } catch {
        // skip corrupt entries
      }
    }

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Clear all working memory sessions for a user */
  async clearAllUserSessions(userId: number): Promise<number> {
    const pattern = `${WORKING_MEMORY_PREFIX}${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length === 0) return 0;
    await this.redis.del(...keys);
    return keys.length;
  }

  /** Get summary stats across all active sessions */
  async getStats(): Promise<{ totalSessions: number; totalTokensInput: number; totalTokensOutput: number; uniqueUsers: number }> {
    const pattern = `${WORKING_MEMORY_PREFIX}*`;
    const keys = await this.redis.keys(pattern);
    const userIds = new Set<number>();
    let totalTokensInput = 0;
    let totalTokensOutput = 0;

    for (const key of keys) {
      try {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        const state = JSON.parse(raw) as WorkingMemoryState;
        userIds.add(state.userId);
        const tokens = this.getSessionTokens(state);
        totalTokensInput += tokens.input;
        totalTokensOutput += tokens.output;
      } catch {
        // skip
      }
    }

    return {
      totalSessions: keys.length,
      totalTokensInput,
      totalTokensOutput,
      uniqueUsers: userIds.size,
    };
  }
}
