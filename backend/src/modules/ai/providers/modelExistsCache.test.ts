import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    buildCacheKey,
    getCachedExists,
    setCachedExists,
    __resetMemoryCacheForTests,
} from './modelExistsCache.js';

beforeEach(() => {
    __resetMemoryCacheForTests();
});

describe('modelExistsCache.buildCacheKey', () => {
    it('produces a stable, namespaced key', () => {
        expect(buildCacheKey('openai', 'gpt-4o')).toBe('model:exists:openai:gpt-4o');
        expect(buildCacheKey('anthropic', 'claude-opus-4-6')).toBe(
            'model:exists:anthropic:claude-opus-4-6',
        );
    });
});

describe('modelExistsCache memory fallback', () => {
    it('returns null on a miss', async () => {
        expect(await getCachedExists('openai', 'gpt-x')).toBeNull();
    });

    it('round-trips a value through memory when no Redis is provided', async () => {
        const result = { exists: true, fetchedAt: new Date('2026-04-28T10:00:00Z') };
        await setCachedExists('openai', 'gpt-4o', result);
        const cached = await getCachedExists('openai', 'gpt-4o');
        expect(cached).not.toBeNull();
        expect(cached!.exists).toBe(true);
    });

    it('expires entries past the TTL', async () => {
        const fixedNow = 1_000_000;
        const spy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
        await setCachedExists('openai', 'gpt-stale', { exists: true, fetchedAt: new Date() });
        // Move time 2 hours forward
        spy.mockReturnValue(fixedNow + 2 * 3600 * 1000);
        expect(await getCachedExists('openai', 'gpt-stale')).toBeNull();
        spy.mockRestore();
    });
});

describe('modelExistsCache Redis path', () => {
    function makeRedisStub() {
        const store = new Map<string, string>();
        return {
            store,
            get: vi.fn(async (k: string) => store.get(k) ?? null),
            set: vi.fn(async (k: string, v: string) => {
                store.set(k, v);
                return 'OK';
            }),
        };
    }

    it('reads from Redis before falling back to memory', async () => {
        const redis = makeRedisStub();
        const value = { exists: false, fetchedAt: new Date('2026-04-28T08:00:00Z'), reason: '404' };
        redis.store.set(buildCacheKey('anthropic', 'claude-x'), JSON.stringify(value));

        const cached = await getCachedExists('anthropic', 'claude-x', redis);
        expect(redis.get).toHaveBeenCalledWith('model:exists:anthropic:claude-x');
        expect(cached).not.toBeNull();
        expect(cached!.exists).toBe(false);
        expect(cached!.reason).toBe('404');
        expect(cached!.fetchedAt).toBeInstanceOf(Date);
    });

    it('writes to Redis with a 1-hour TTL', async () => {
        const redis = makeRedisStub();
        await setCachedExists('openai', 'gpt-4o', { exists: true, fetchedAt: new Date() }, redis);
        expect(redis.set).toHaveBeenCalledWith(
            'model:exists:openai:gpt-4o',
            expect.any(String),
            'EX',
            3600,
        );
    });

    it('survives a Redis read error and falls back to memory', async () => {
        const redis = {
            get: vi.fn(async () => {
                throw new Error('connection refused');
            }),
            set: vi.fn(async () => 'OK'),
        };
        await setCachedExists('openai', 'gpt-4o', { exists: true, fetchedAt: new Date() }); // memory only
        const cached = await getCachedExists('openai', 'gpt-4o', redis);
        expect(cached).not.toBeNull();
        expect(cached!.exists).toBe(true);
    });

    it('survives a Redis write error', async () => {
        const redis = {
            get: vi.fn(async () => null),
            set: vi.fn(async () => {
                throw new Error('disk full');
            }),
        };
        // Should not reject
        await expect(
            setCachedExists('openai', 'gpt-4o', { exists: true, fetchedAt: new Date() }, redis),
        ).resolves.toBeUndefined();
    });
});
