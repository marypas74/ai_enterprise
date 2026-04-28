import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyModelExistsHttp } from './modelExistsHttp.js';
import { __resetMemoryCacheForTests } from './modelExistsCache.js';

beforeEach(() => {
    __resetMemoryCacheForTests();
});

function makeFetch(status: number, body: unknown = {}): typeof fetch {
    return vi.fn(async () =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
}

describe('verifyModelExistsHttp — status classification', () => {
    it('returns exists=true for 200', async () => {
        const result = await verifyModelExistsHttp({
            provider: 'openai',
            modelId: 'gpt-4o',
            url: 'https://api.openai.com/v1/models/gpt-4o',
            fetchImpl: makeFetch(200, { id: 'gpt-4o' }),
        });
        expect(result.exists).toBe(true);
        expect(result.fetchedAt).toBeInstanceOf(Date);
        expect(result.reason).toBeUndefined();
    });

    it('returns exists=false for 404', async () => {
        const result = await verifyModelExistsHttp({
            provider: 'openai',
            modelId: 'gpt-nope',
            url: 'https://api.openai.com/v1/models/gpt-nope',
            fetchImpl: makeFetch(404, { error: { code: 'model_not_found' } }),
        });
        expect(result.exists).toBe(false);
        expect(result.reason).toBe('http_404');
    });

    it('returns exists=false for 410 (retired)', async () => {
        const result = await verifyModelExistsHttp({
            provider: 'openai',
            modelId: 'gpt-3-old',
            url: 'https://api.openai.com/v1/models/gpt-3-old',
            fetchImpl: makeFetch(410),
        });
        expect(result.exists).toBe(false);
        expect(result.reason).toBe('http_410');
    });

    it('returns exists=true (uncached) for 5xx so admin can retry', async () => {
        const result = await verifyModelExistsHttp({
            provider: 'openai',
            modelId: 'gpt-flaky',
            url: 'https://api.openai.com/v1/models/gpt-flaky',
            fetchImpl: makeFetch(500),
        });
        expect(result.exists).toBe(true);
        expect(result.reason).toBe('http_500_uncached');
    });

    it('returns exists=true on network error so a transient outage does not block save', async () => {
        const fetchImpl = vi.fn(async () => {
            throw Object.assign(new Error('connect timeout'), { name: 'AbortError' });
        }) as unknown as typeof fetch;

        const result = await verifyModelExistsHttp({
            provider: 'anthropic',
            modelId: 'claude-x',
            url: 'https://api.anthropic.com/v1/models/claude-x',
            fetchImpl,
        });
        expect(result.exists).toBe(true);
        expect(result.reason).toMatch(/network_error/);
    });
});

describe('verifyModelExistsHttp — caching', () => {
    it('does not call fetch on a second positive call within TTL', async () => {
        const fetchImpl = makeFetch(200, { id: 'gpt-4o' });
        const args = {
            provider: 'openai',
            modelId: 'gpt-4o',
            url: 'https://api.openai.com/v1/models/gpt-4o',
            fetchImpl,
        };
        await verifyModelExistsHttp(args);
        await verifyModelExistsHttp(args);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('caches negative results so a typo is reported quickly the second time', async () => {
        const fetchImpl = makeFetch(404);
        const args = {
            provider: 'openai',
            modelId: 'gpt-typo',
            url: 'https://api.openai.com/v1/models/gpt-typo',
            fetchImpl,
        };
        const a = await verifyModelExistsHttp(args);
        const b = await verifyModelExistsHttp(args);
        expect(a.exists).toBe(false);
        expect(b.exists).toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does NOT cache 5xx results', async () => {
        const fetchImpl = makeFetch(503);
        const args = {
            provider: 'openai',
            modelId: 'gpt-flaky',
            url: 'https://api.openai.com/v1/models/gpt-flaky',
            fetchImpl,
        };
        await verifyModelExistsHttp(args);
        await verifyModelExistsHttp(args);
        // Both calls should hit the network
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
