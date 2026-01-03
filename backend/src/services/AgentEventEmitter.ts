import { EventEmitter } from 'events';

export interface AgentEvent {
  type: 'session_created' | 'session_updated' | 'session_completed' | 'session_failed' |
        'log_added' | 'task_queued' | 'task_completed' | 'worktree_created' |
        'worktree_merged' | 'conflict_detected' | 'conflict_resolved' |
        'terminal_assigned' | 'terminal_released' | 'iteration_started';
  sessionId?: number;
  terminalSlot?: number;
  data: any;
  timestamp: Date;
}

export interface SessionLogEvent {
  sessionId: number;
  logType: 'stdout' | 'stderr' | 'action' | 'decision' | 'tool_call' | 'tool_result' | 'error' | 'warning' | 'info' | 'qa_iteration';
  content: string;
  metadata?: any;
}

class AgentEventEmitterClass extends EventEmitter {
  private static instance: AgentEventEmitterClass;
  private sessionSubscribers: Map<number, Set<(event: AgentEvent) => void>> = new Map();
  private orchestratorSubscribers: Set<(event: AgentEvent) => void> = new Set();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): AgentEventEmitterClass {
    if (!AgentEventEmitterClass.instance) {
      AgentEventEmitterClass.instance = new AgentEventEmitterClass();
    }
    return AgentEventEmitterClass.instance;
  }

  // Subscribe to a specific session's events
  public subscribeToSession(sessionId: number, callback: (event: AgentEvent) => void): () => void {
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set());
    }
    this.sessionSubscribers.get(sessionId)!.add(callback);

    // Return unsubscribe function
    return () => {
      const subscribers = this.sessionSubscribers.get(sessionId);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          this.sessionSubscribers.delete(sessionId);
        }
      }
    };
  }

  // Subscribe to all orchestrator events
  public subscribeToOrchestrator(callback: (event: AgentEvent) => void): () => void {
    this.orchestratorSubscribers.add(callback);
    return () => {
      this.orchestratorSubscribers.delete(callback);
    };
  }

  // Emit an event to specific session subscribers
  public emitSessionEvent(event: AgentEvent): void {
    event.timestamp = new Date();

    // Notify session-specific subscribers
    if (event.sessionId) {
      const subscribers = this.sessionSubscribers.get(event.sessionId);
      if (subscribers) {
        subscribers.forEach(callback => {
          try {
            callback(event);
          } catch (err) {
            console.error(`Error in session subscriber: ${err}`);
          }
        });
      }
    }

    // Also emit to general event bus
    this.emit('session_event', event);
  }

  // Emit an event to orchestrator subscribers
  public emitOrchestratorEvent(event: AgentEvent): void {
    event.timestamp = new Date();

    this.orchestratorSubscribers.forEach(callback => {
      try {
        callback(event);
      } catch (err) {
        console.error(`Error in orchestrator subscriber: ${err}`);
      }
    });

    // Also emit to general event bus
    this.emit('orchestrator_event', event);
  }

  // Convenience methods for common events
  public sessionCreated(sessionId: number, data: any): void {
    this.emitSessionEvent({
      type: 'session_created',
      sessionId,
      data,
      timestamp: new Date()
    });
    this.emitOrchestratorEvent({
      type: 'session_created',
      sessionId,
      data,
      timestamp: new Date()
    });
  }

  public sessionUpdated(sessionId: number, data: any): void {
    this.emitSessionEvent({
      type: 'session_updated',
      sessionId,
      data,
      timestamp: new Date()
    });
  }

  public sessionCompleted(sessionId: number, data: any): void {
    this.emitSessionEvent({
      type: 'session_completed',
      sessionId,
      data,
      timestamp: new Date()
    });
    this.emitOrchestratorEvent({
      type: 'session_completed',
      sessionId,
      data,
      timestamp: new Date()
    });
  }

  public sessionFailed(sessionId: number, error: string): void {
    this.emitSessionEvent({
      type: 'session_failed',
      sessionId,
      data: { error },
      timestamp: new Date()
    });
    this.emitOrchestratorEvent({
      type: 'session_failed',
      sessionId,
      data: { error },
      timestamp: new Date()
    });
  }

  public logAdded(sessionId: number, log: SessionLogEvent): void {
    this.emitSessionEvent({
      type: 'log_added',
      sessionId,
      data: log,
      timestamp: new Date()
    });
  }

  public terminalAssigned(sessionId: number, slot: number): void {
    this.emitOrchestratorEvent({
      type: 'terminal_assigned',
      sessionId,
      terminalSlot: slot,
      data: { sessionId, slot },
      timestamp: new Date()
    });
  }

  public terminalReleased(slot: number): void {
    this.emitOrchestratorEvent({
      type: 'terminal_released',
      terminalSlot: slot,
      data: { slot },
      timestamp: new Date()
    });
  }

  public iterationStarted(sessionId: number, iteration: number): void {
    this.emitSessionEvent({
      type: 'iteration_started',
      sessionId,
      data: { iteration },
      timestamp: new Date()
    });
  }

  public conflictDetected(sessionId: number, files: string[]): void {
    this.emitSessionEvent({
      type: 'conflict_detected',
      sessionId,
      data: { files },
      timestamp: new Date()
    });
  }

  public conflictResolved(sessionId: number, file: string, tier: string): void {
    this.emitSessionEvent({
      type: 'conflict_resolved',
      sessionId,
      data: { file, tier },
      timestamp: new Date()
    });
  }
}

export const AgentEventEmitter = AgentEventEmitterClass.getInstance();
