import { EventEmitter } from 'events';

export interface JobEvent {
  type: 'job_complete' | 'job_error';
  jobId: string;
  userId: number;
  conversationId: number;
  messageId?: number;
  errorMessage?: string;
  timestamp: Date;
}

class JobEventEmitterClass extends EventEmitter {
  private static instance: JobEventEmitterClass;
  private userSubscribers: Map<number, Set<(event: JobEvent) => void>> = new Map();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): JobEventEmitterClass {
    if (!JobEventEmitterClass.instance) {
      JobEventEmitterClass.instance = new JobEventEmitterClass();
    }
    return JobEventEmitterClass.instance;
  }

  public subscribeToUser(userId: number, callback: (event: JobEvent) => void): () => void {
    if (!this.userSubscribers.has(userId)) {
      this.userSubscribers.set(userId, new Set());
    }
    this.userSubscribers.get(userId)!.add(callback);

    return () => {
      const subscribers = this.userSubscribers.get(userId);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          this.userSubscribers.delete(userId);
        }
      }
    };
  }

  public emitJobComplete(event: Omit<JobEvent, 'type' | 'timestamp'>): void {
    const fullEvent: JobEvent = { ...event, type: 'job_complete', timestamp: new Date() };
    this.notifyUser(fullEvent);
  }

  public emitJobError(event: Omit<JobEvent, 'type' | 'timestamp'>): void {
    const fullEvent: JobEvent = { ...event, type: 'job_error', timestamp: new Date() };
    this.notifyUser(fullEvent);
  }

  private notifyUser(event: JobEvent): void {
    const subscribers = this.userSubscribers.get(event.userId);
    if (subscribers) {
      subscribers.forEach(callback => {
        try { callback(event); }
        catch { /* subscriber error must not crash worker */ }
      });
    }
  }
}

export const JobEventEmitter = JobEventEmitterClass.getInstance();
