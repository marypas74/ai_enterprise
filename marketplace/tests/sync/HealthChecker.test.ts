import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthChecker } from '../../src/sync/HealthChecker.js';

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
    vi.restoreAllMocks();
  });

  it('should return true when aitmpl.com is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const result = await checker.check();

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.aitmpl.com/',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('should return false when not reachable (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await checker.check();

    expect(result).toBe(false);
  });

  it('should return false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const result = await checker.check();

    expect(result).toBe(false);
  });

  it('should suspend after 3 consecutive failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await checker.check();
    expect(checker.isSuspended()).toBe(false);
    expect(checker.getConsecutiveFailures()).toBe(1);

    await checker.check();
    expect(checker.isSuspended()).toBe(false);
    expect(checker.getConsecutiveFailures()).toBe(2);

    await checker.check();
    expect(checker.isSuspended()).toBe(true);
    expect(checker.getConsecutiveFailures()).toBe(3);
  });

  it('should reset consecutive failures on success', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Two failures
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    await checker.check();
    await checker.check();
    expect(checker.getConsecutiveFailures()).toBe(2);

    // One success resets
    mockFetch.mockResolvedValueOnce({ ok: true });
    await checker.check();
    expect(checker.getConsecutiveFailures()).toBe(0);
    expect(checker.isSuspended()).toBe(false);
  });

  it('should allow resume() to reset suspension state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await checker.check();
    await checker.check();
    await checker.check();
    expect(checker.isSuspended()).toBe(true);

    checker.resume();
    expect(checker.isSuspended()).toBe(false);
    expect(checker.getConsecutiveFailures()).toBe(0);
  });
});
