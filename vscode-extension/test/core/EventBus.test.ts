import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

describe('EventBus', () => {
  it('should call listener when event is emitted', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('auth:login', listener);
    bus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(listener).toHaveBeenCalledWith({ userId: '1', email: 'test@test.com' });
  });

  it('should not call listener after off()', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('auth:login', listener);
    bus.off('auth:login', listener);
    bus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('should support once() listeners', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.once('auth:logout', listener);
    bus.emit('auth:logout', undefined);
    bus.emit('auth:logout', undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple listeners for same event', () => {
    const bus = new EventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    bus.on('config:changed', listener1);
    bus.on('config:changed', listener2);
    bus.emit('config:changed', { key: 'serverUrl', value: 'https://test.com' });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should return disposable from on()', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const disposable = bus.on('auth:login', listener);
    disposable.dispose();
    bus.emit('auth:login', { userId: '1', email: 'test@test.com' });
    expect(listener).not.toHaveBeenCalled();
  });
});
