/**
 * EventBus Service - Pipeline Hook System
 * Provides a publish/subscribe system with priority-based hook execution.
 * Hooks are "piped" - each handler receives the output of the previous one.
 */

// Hook names - all the interception points in the pipeline
export type HookName =
  // Message pipeline
  | 'before_message_read'
  | 'after_message_read'
  | 'before_llm_call'
  | 'after_llm_response'
  | 'before_message_send'
  | 'after_message_send'
  // Memory recall (Cheshire Cat)
  | 'cat_recall_query'
  | 'before_cat_recalls_memories'
  | 'before_cat_recalls_episodic_memories'
  | 'before_cat_recalls_declarative_memories'
  | 'before_cat_recalls_procedural_memories'
  | 'after_cat_recalls_memories'
  | 'before_cat_stores_episodic_memory'
  // Legacy recall aliases
  | 'before_rag_recall'
  | 'after_rag_recall'
  // Memory store
  | 'before_memory_store'
  // Agent chain (Cheshire Cat)
  | 'before_agent_starts'
  | 'agent_fast_reply'
  | 'agent_prompt_prefix'
  | 'agent_prompt_suffix'
  | 'agent_prompt_instructions'
  | 'agent_allowed_tools'
  // Tool execution
  | 'before_tool_execute'
  | 'after_tool_execute'
  // Document pipeline
  | 'on_document_upload'
  | 'on_document_chunked'
  // Rabbit Hole (hookable ingestion)
  | 'before_splits_text'
  | 'after_splits_text'
  | 'before_stores_documents'
  | 'after_stored_documents'
  // White Rabbit (scheduler)
  | 'on_scheduled_action'
  // System
  | 'on_bootstrap'
  | 'fast_reply';

export interface HookContext {
  userId: number;
  conversationId?: number;
  messageId?: number;
  [key: string]: any;
}

export interface HookHandler {
  id: string;
  name: string;
  hookName: HookName;
  priority: number;
  pluginId?: number;
  enabled: boolean;
  handler: (data: any, context: HookContext) => Promise<any> | any;
}

export interface HookResult {
  data: any;
  handlers_executed: string[];
  short_circuited: boolean;
}

export interface HookTraceEntry {
  id: number;
  hookName: string;
  type: 'pipe' | 'emit';
  handlerId: string;
  handlerName: string;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: string;
  userId?: number;
  conversationId?: number;
}

class EventBusService {
  private handlers: Map<HookName, HookHandler[]> = new Map();
  private static instance: EventBusService;
  private traceEnabled = false;
  private traceBuffer: HookTraceEntry[] = [];
  private traceMaxEntries = 500;
  private traceIdCounter = 0;

  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  register(handler: HookHandler): void {
    const existing = this.handlers.get(handler.hookName) || [];
    const filtered = existing.filter(h => h.id !== handler.id);
    filtered.push(handler);
    filtered.sort((a, b) => a.priority - b.priority);
    this.handlers.set(handler.hookName, filtered);
    console.log(`[EventBus] Registered handler "${handler.name}" on hook "${handler.hookName}" priority=${handler.priority}`);
  }

  unregister(handlerId: string): void {
    for (const [hookName, handlers] of this.handlers) {
      const before = handlers.length;
      const filtered = handlers.filter(h => h.id !== handlerId);
      if (filtered.length !== before) {
        this.handlers.set(hookName, filtered);
      }
    }
  }

  unregisterPlugin(pluginId: number): void {
    for (const [hookName, handlers] of this.handlers) {
      this.handlers.set(hookName, handlers.filter(h => h.pluginId !== pluginId));
    }
  }

  toggleHandler(handlerId: string, enabled: boolean): boolean {
    for (const [, handlers] of this.handlers) {
      const handler = handlers.find(h => h.id === handlerId);
      if (handler) {
        handler.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  private static HANDLER_TIMEOUT_MS = 5000;

  private async runWithTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number, label: string): Promise<T> {
    return Promise.race([
      Promise.resolve(fn()),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Handler "${label}" timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  async pipe(hookName: HookName, data: any, context: HookContext): Promise<HookResult> {
    const handlers = (this.handlers.get(hookName) || []).filter(h => h.enabled);
    const executed: string[] = [];
    let currentData = data;

    for (const handler of handlers) {
      const start = performance.now();
      try {
        const result = await this.runWithTimeout(
          () => handler.handler(currentData, context),
          EventBusService.HANDLER_TIMEOUT_MS,
          handler.id,
        );
        executed.push(handler.id);
        this.recordTrace(hookName, 'pipe', handler.id, handler.name, performance.now() - start, true, undefined, context);

        if (hookName === 'fast_reply' && result !== null && result !== undefined) {
          return { data: result, handlers_executed: executed, short_circuited: true };
        }

        if (result !== undefined) {
          currentData = result;
        }
      } catch (error: any) {
        this.recordTrace(hookName, 'pipe', handler.id, handler.name, performance.now() - start, false, error.message, context);
        console.error(`[EventBus] Hook ${hookName} handler ${handler.id} error:`, error.message);
      }
    }

    return { data: currentData, handlers_executed: executed, short_circuited: false };
  }

  async emit(hookName: HookName, data: any, context: HookContext): Promise<void> {
    const handlers = (this.handlers.get(hookName) || []).filter(h => h.enabled);
    await Promise.allSettled(
      handlers.map(async h => {
        const start = performance.now();
        try {
          await Promise.resolve(h.handler(data, context));
          this.recordTrace(hookName, 'emit', h.id, h.name, performance.now() - start, true, undefined, context);
        } catch (err: any) {
          this.recordTrace(hookName, 'emit', h.id, h.name, performance.now() - start, false, err.message, context);
          console.error(`[EventBus] Emit ${hookName} handler ${h.id} error:`, err.message);
        }
      })
    );
  }

  getRegisteredHandlers(): Record<string, { id: string; name: string; priority: number; pluginId?: number; enabled: boolean }[]> {
    const result: Record<string, any[]> = {};
    for (const [hookName, handlers] of this.handlers) {
      result[hookName] = handlers.map(h => ({
        id: h.id, name: h.name, priority: h.priority, pluginId: h.pluginId, enabled: h.enabled,
      }));
    }
    return result;
  }

  getAvailableHooks(): { name: string; description: string; type: 'pipe' | 'emit' }[] {
    return [
      // Message pipeline
      { name: 'before_message_read', description: 'Pre-process user message before pipeline', type: 'pipe' },
      { name: 'after_message_read', description: 'Post-process user message after reading', type: 'emit' },
      { name: 'before_llm_call', description: 'Modify prompt/parameters before LLM call', type: 'pipe' },
      { name: 'after_llm_response', description: 'Modify LLM output after response', type: 'pipe' },
      { name: 'before_message_send', description: 'Before sending response to user', type: 'pipe' },
      { name: 'after_message_send', description: 'After response sent (logging/analytics)', type: 'emit' },
      // Memory recall (Cheshire Cat)
      { name: 'cat_recall_query', description: 'Edit the semantic search query before recall', type: 'pipe' },
      { name: 'before_cat_recalls_memories', description: 'Intercept before any memory search', type: 'emit' },
      { name: 'before_cat_recalls_episodic_memories', description: 'Configure episodic recall params (k, threshold)', type: 'pipe' },
      { name: 'before_cat_recalls_declarative_memories', description: 'Configure declarative recall params (k, threshold)', type: 'pipe' },
      { name: 'before_cat_recalls_procedural_memories', description: 'Configure procedural recall params (k, threshold)', type: 'pipe' },
      { name: 'after_cat_recalls_memories', description: 'After all memory searches complete', type: 'emit' },
      { name: 'before_cat_stores_episodic_memory', description: 'Edit document before episodic storage', type: 'pipe' },
      // Legacy aliases
      { name: 'before_rag_recall', description: 'Before vector memory recall (legacy)', type: 'pipe' },
      { name: 'after_rag_recall', description: 'After recall — modify context (legacy)', type: 'pipe' },
      // Memory store
      { name: 'before_memory_store', description: 'Before storing to episodic memory', type: 'pipe' },
      // Agent chain (Cheshire Cat)
      { name: 'before_agent_starts', description: 'Edit agent input before chain execution', type: 'pipe' },
      { name: 'agent_fast_reply', description: 'Short-circuit after recall, before agent chain', type: 'pipe' },
      { name: 'agent_prompt_prefix', description: 'Edit system prompt personality section', type: 'pipe' },
      { name: 'agent_prompt_suffix', description: 'Edit system prompt context section', type: 'pipe' },
      { name: 'agent_prompt_instructions', description: 'Edit tool/form selection instructions', type: 'pipe' },
      { name: 'agent_allowed_tools', description: 'Filter which tools reach the agent prompt', type: 'pipe' },
      // Tool execution
      { name: 'before_tool_execute', description: 'Before tool execution', type: 'pipe' },
      { name: 'after_tool_execute', description: 'After tool execution', type: 'pipe' },
      // Document pipeline
      { name: 'on_document_upload', description: 'When a document is uploaded', type: 'emit' },
      { name: 'on_document_chunked', description: 'After document chunking', type: 'emit' },
      // Rabbit Hole (hookable ingestion)
      { name: 'before_splits_text', description: 'Edit text before chunking in ingestion pipeline', type: 'pipe' },
      { name: 'after_splits_text', description: 'Edit chunks after splitting in ingestion pipeline', type: 'pipe' },
      { name: 'before_stores_documents', description: 'Edit chunks before embedding/storing in vector memory', type: 'pipe' },
      { name: 'after_stored_documents', description: 'After documents stored in vector memory', type: 'emit' },
      // White Rabbit (scheduler)
      { name: 'on_scheduled_action', description: 'Plugin action triggered by scheduler', type: 'emit' },
      // System
      { name: 'on_bootstrap', description: 'Server startup', type: 'emit' },
      { name: 'fast_reply', description: 'Short-circuit opportunity for immediate reply', type: 'pipe' },
    ];
  }

  // ---- Tracing ----

  setTracing(enabled: boolean): void {
    this.traceEnabled = enabled;
    if (!enabled) this.traceBuffer = [];
  }

  isTracingEnabled(): boolean {
    return this.traceEnabled;
  }

  getTraceLog(limit?: number): HookTraceEntry[] {
    const entries = [...this.traceBuffer].reverse(); // newest first
    return limit ? entries.slice(0, limit) : entries;
  }

  clearTraceLog(): void {
    this.traceBuffer = [];
    this.traceIdCounter = 0;
  }

  getTraceStats(): { totalExecutions: number; totalErrors: number; avgDurationMs: number; hookBreakdown: Record<string, { count: number; errors: number; avgMs: number }> } {
    const breakdown: Record<string, { count: number; errors: number; totalMs: number }> = {};
    let totalErrors = 0;
    let totalMs = 0;

    for (const entry of this.traceBuffer) {
      if (!breakdown[entry.hookName]) {
        breakdown[entry.hookName] = { count: 0, errors: 0, totalMs: 0 };
      }
      breakdown[entry.hookName].count++;
      breakdown[entry.hookName].totalMs += entry.durationMs;
      if (!entry.success) {
        breakdown[entry.hookName].errors++;
        totalErrors++;
      }
      totalMs += entry.durationMs;
    }

    const hookBreakdown: Record<string, { count: number; errors: number; avgMs: number }> = {};
    for (const [hook, stats] of Object.entries(breakdown)) {
      hookBreakdown[hook] = {
        count: stats.count,
        errors: stats.errors,
        avgMs: stats.count > 0 ? Number((stats.totalMs / stats.count).toFixed(2)) : 0,
      };
    }

    return {
      totalExecutions: this.traceBuffer.length,
      totalErrors,
      avgDurationMs: this.traceBuffer.length > 0 ? Number((totalMs / this.traceBuffer.length).toFixed(2)) : 0,
      hookBreakdown,
    };
  }

  private recordTrace(hookName: string, type: 'pipe' | 'emit', handlerId: string, handlerName: string, durationMs: number, success: boolean, error: string | undefined, context: HookContext): void {
    if (!this.traceEnabled) return;

    this.traceBuffer.push({
      id: ++this.traceIdCounter,
      hookName,
      type,
      handlerId,
      handlerName,
      durationMs: Number(durationMs.toFixed(2)),
      success,
      error,
      timestamp: new Date().toISOString(),
      userId: context.userId,
      conversationId: context.conversationId,
    });

    // Keep buffer bounded
    if (this.traceBuffer.length > this.traceMaxEntries) {
      this.traceBuffer = this.traceBuffer.slice(-this.traceMaxEntries);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = EventBusService.getInstance();
export default eventBus;
