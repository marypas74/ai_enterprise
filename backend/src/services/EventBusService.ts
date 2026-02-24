/**
 * EventBus Service - Pipeline Hook System
 * Provides a publish/subscribe system with priority-based hook execution.
 * Hooks are "piped" - each handler receives the output of the previous one.
 */

// Hook names - all the interception points in the pipeline
export type HookName =
  | 'before_message_read'
  | 'after_message_read'
  | 'before_llm_call'
  | 'after_llm_response'
  | 'before_rag_recall'
  | 'after_rag_recall'
  | 'before_memory_store'
  | 'before_message_send'
  | 'after_message_send'
  | 'before_tool_execute'
  | 'after_tool_execute'
  | 'on_document_upload'
  | 'on_document_chunked'
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

class EventBusService {
  private handlers: Map<HookName, HookHandler[]> = new Map();
  private static instance: EventBusService;

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
      try {
        const result = await this.runWithTimeout(
          () => handler.handler(currentData, context),
          EventBusService.HANDLER_TIMEOUT_MS,
          handler.id,
        );
        executed.push(handler.id);

        if (hookName === 'fast_reply' && result !== null && result !== undefined) {
          return { data: result, handlers_executed: executed, short_circuited: true };
        }

        if (result !== undefined) {
          currentData = result;
        }
      } catch (error: any) {
        console.error(`[EventBus] Hook ${hookName} handler ${handler.id} error:`, error.message);
      }
    }

    return { data: currentData, handlers_executed: executed, short_circuited: false };
  }

  async emit(hookName: HookName, data: any, context: HookContext): Promise<void> {
    const handlers = (this.handlers.get(hookName) || []).filter(h => h.enabled);
    await Promise.allSettled(
      handlers.map(h =>
        Promise.resolve(h.handler(data, context)).catch(err =>
          console.error(`[EventBus] Emit ${hookName} handler ${h.id} error:`, err.message)
        )
      )
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
      { name: 'before_message_read', description: 'Pre-process user message before pipeline', type: 'pipe' },
      { name: 'after_message_read', description: 'Post-process user message after reading', type: 'pipe' },
      { name: 'before_llm_call', description: 'Modify prompt/parameters before LLM call', type: 'pipe' },
      { name: 'after_llm_response', description: 'Modify LLM output after response', type: 'pipe' },
      { name: 'before_rag_recall', description: 'Before vector memory recall', type: 'pipe' },
      { name: 'after_rag_recall', description: 'After recall — modify context', type: 'pipe' },
      { name: 'before_memory_store', description: 'Before storing to episodic memory', type: 'pipe' },
      { name: 'before_message_send', description: 'Before sending response to user', type: 'pipe' },
      { name: 'after_message_send', description: 'After response sent (logging/analytics)', type: 'emit' },
      { name: 'before_tool_execute', description: 'Before tool execution', type: 'pipe' },
      { name: 'after_tool_execute', description: 'After tool execution', type: 'pipe' },
      { name: 'on_document_upload', description: 'When a document is uploaded', type: 'emit' },
      { name: 'on_document_chunked', description: 'After document chunking', type: 'emit' },
      { name: 'on_bootstrap', description: 'Server startup', type: 'emit' },
      { name: 'fast_reply', description: 'Short-circuit opportunity for immediate reply', type: 'pipe' },
    ];
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = EventBusService.getInstance();
export default eventBus;
