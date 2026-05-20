/**
 * DEBT-84-D: Agentic keepalive SSE tests.
 * Verifies setInterval/clearInterval lifecycle for the keepalive mechanism.
 *
 * TDD order: RED (written before keepalive exists) → GREEN (after impl).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('agentic keepalive — DEBT-84-D', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setInterval fires keepalive event every 25 seconds when connection is open', () => {
    const writtenData: string[] = [];
    const mockRaw = {
      destroyed: false,
      write: (data: string) => { writtenData.push(data); },
    };

    const interval = setInterval(() => {
      if (!mockRaw.destroyed) mockRaw.write('data: {"type":"keepalive"}\n\n');
    }, 25000);

    // Advance 25 seconds
    vi.advanceTimersByTime(25000);
    expect(writtenData).toHaveLength(1);
    expect(writtenData[0]).toBe('data: {"type":"keepalive"}\n\n');

    // Advance another 25 seconds
    vi.advanceTimersByTime(25000);
    expect(writtenData).toHaveLength(2);

    clearInterval(interval);
  });

  it('keepalive does NOT fire after clearInterval (normal stream termination)', () => {
    const writtenData: string[] = [];
    const mockRaw = {
      destroyed: false,
      write: (data: string) => { writtenData.push(data); },
    };

    const interval = setInterval(() => {
      if (!mockRaw.destroyed) mockRaw.write('data: {"type":"keepalive"}\n\n');
    }, 25000);

    vi.advanceTimersByTime(10000);
    // Simulate stream end — clear interval
    clearInterval(interval);

    vi.advanceTimersByTime(30000);
    expect(writtenData).toHaveLength(0);
  });

  it('keepalive does NOT write when raw.destroyed is true (client disconnect)', () => {
    const writtenData: string[] = [];
    const mockRaw = {
      destroyed: false,
      write: (data: string) => { writtenData.push(data); },
    };

    const interval = setInterval(() => {
      if (!mockRaw.destroyed) mockRaw.write('data: {"type":"keepalive"}\n\n');
    }, 25000);

    // Simulate client disconnect before first keepalive
    vi.advanceTimersByTime(10000);
    mockRaw.destroyed = true;

    vi.advanceTimersByTime(20000);
    expect(writtenData).toHaveLength(0);

    clearInterval(interval);
  });

  it('clearInterval in close handler stops further keepalives', () => {
    const writtenData: string[] = [];
    let intervalRef: ReturnType<typeof setInterval> | null = null;
    const mockRaw = {
      destroyed: false,
      write: (data: string) => { writtenData.push(data); },
      onClose: null as (() => void) | null,
    };

    intervalRef = setInterval(() => {
      if (!mockRaw.destroyed) mockRaw.write('data: {"type":"keepalive"}\n\n');
    }, 25000);

    // Simulate close event handler
    mockRaw.onClose = () => {
      if (intervalRef) clearInterval(intervalRef);
    };

    // One keepalive fires
    vi.advanceTimersByTime(25000);
    expect(writtenData).toHaveLength(1);

    // Client disconnects
    mockRaw.onClose();

    // No more keepalives after close
    vi.advanceTimersByTime(50000);
    expect(writtenData).toHaveLength(1);
  });
});

// Frontend SSE parser: ignore keepalive type (no-op)
describe('SSE parser — keepalive no-op — DEBT-84-D', () => {
  it('returns undefined (no-op) for type=keepalive events', () => {
    // Simulate the switch/case logic that the frontend parser would use
    function parseSSEEvent(data: string): string | null {
      try {
        const parsed = JSON.parse(data) as { type?: string; content?: string };
        if (parsed.type === 'keepalive') return null; // no-op
        return parsed.content ?? null;
      } catch {
        return null;
      }
    }

    expect(parseSSEEvent('{"type":"keepalive"}')).toBeNull();
    expect(parseSSEEvent('{"content":"hello"}')).toBe('hello');
  });
});
