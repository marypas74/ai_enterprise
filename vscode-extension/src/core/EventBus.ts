import type { EventMap } from './types';

type Listener<T> = (data: T) => void;

interface Disposable {
  dispose(): void;
}

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): Disposable {
    const set = this.listeners.get(event as string) ?? new Set();
    set.add(listener as Listener<unknown>);
    this.listeners.set(event as string, set);
    return {
      dispose: () => this.off(event, listener),
    };
  }

  once<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): Disposable {
    const wrapper: Listener<EventMap[K]> = (data) => {
      this.off(event, wrapper);
      listener(data);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    const set = this.listeners.get(event as string);
    if (set) {
      set.delete(listener as Listener<unknown>);
      if (set.size === 0) {
        this.listeners.delete(event as string);
      }
    }
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (set) {
      for (const listener of [...set]) {
        listener(data);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
