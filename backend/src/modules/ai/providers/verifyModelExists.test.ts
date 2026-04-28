/**
 * Integration-light tests for `verifyModelExists` on each provider.
 * We stub global `fetch` so no real network call is made.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { __resetMemoryCacheForTests } from './modelExistsCache.js';

beforeEach(() => {
    __resetMemoryCacheForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => handler(url, init)) as unknown as typeof fetch,
    );
}

describe('OpenAIProvider.verifyModelExists', () => {
    it('hits /v1/models/{id} and returns exists=true for 200', async () => {
        stubFetch((url) => {
            expect(url).toBe('https://api.openai.com/v1/models/gpt-4o');
            return new Response('{"id":"gpt-4o"}', { status: 200 });
        });
        const { OpenAIProvider } = await import('./OpenAIProvider.js');
        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const result = await provider.verifyModelExists!('gpt-4o');
        expect(result.exists).toBe(true);
    });

    it('returns exists=false on 404', async () => {
        stubFetch(() => new Response('{}', { status: 404 }));
        const { OpenAIProvider } = await import('./OpenAIProvider.js');
        const provider = new OpenAIProvider({ apiKey: 'sk-test' });
        const result = await provider.verifyModelExists!('gpt-not-real');
        expect(result.exists).toBe(false);
        expect(result.reason).toBe('http_404');
    });
});

describe('AnthropicProvider.verifyModelExists', () => {
    it('hits /v1/models/{id} with x-api-key header', async () => {
        stubFetch((url, init) => {
            expect(url).toBe('https://api.anthropic.com/v1/models/claude-opus-4-6');
            const headers = init?.headers as Record<string, string> | undefined;
            expect(headers?.['x-api-key']).toBe('sk-ant-test');
            expect(headers?.['anthropic-version']).toBe('2023-06-01');
            return new Response('{}', { status: 200 });
        });
        const { AnthropicProvider } = await import('./AnthropicProvider.js');
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
        const result = await provider.verifyModelExists!('claude-opus-4-6');
        expect(result.exists).toBe(true);
    });

    it('returns exists=false on 404', async () => {
        stubFetch(() => new Response('{}', { status: 404 }));
        const { AnthropicProvider } = await import('./AnthropicProvider.js');
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
        const result = await provider.verifyModelExists!('claude-fake');
        expect(result.exists).toBe(false);
    });
});

describe('GoogleProvider.verifyModelExists', () => {
    it('hits /v1beta/models/{id}?key=... and normalises the model id', async () => {
        stubFetch((url) => {
            expect(url).toMatch(
                /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.0-flash\?key=k-test$/,
            );
            return new Response('{}', { status: 200 });
        });
        const { GoogleProvider } = await import('./GoogleProvider.js');
        const provider = new GoogleProvider({ apiKey: 'k-test' });
        const result = await provider.verifyModelExists!('gemini-2.0-flash');
        expect(result.exists).toBe(true);
    });

    it('returns exists=false on 404', async () => {
        stubFetch(() => new Response('{}', { status: 404 }));
        const { GoogleProvider } = await import('./GoogleProvider.js');
        const provider = new GoogleProvider({ apiKey: 'k-test' });
        const result = await provider.verifyModelExists!('gemini-bogus');
        expect(result.exists).toBe(false);
    });
});

describe('OllamaProvider.verifyModelExists', () => {
    it('lists /api/tags and reports exists=true when found', async () => {
        stubFetch((url) => {
            expect(url).toBe('http://localhost:11434/api/tags');
            return new Response(
                JSON.stringify({ models: [{ name: 'qwen3:32b' }, { name: 'phi4:latest' }] }),
                { status: 200 },
            );
        });
        const { OllamaProvider } = await import('./OllamaProvider.js');
        const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
        const result = await provider.verifyModelExists!('qwen3:32b');
        expect(result.exists).toBe(true);
    });

    it('reports exists=false when model is not in /api/tags', async () => {
        stubFetch(() => new Response(JSON.stringify({ models: [] }), { status: 200 }));
        const { OllamaProvider } = await import('./OllamaProvider.js');
        const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
        const result = await provider.verifyModelExists!('not-installed:latest');
        expect(result.exists).toBe(false);
        expect(result.reason).toBe('not_in_tags');
    });

    it('resolves aliases via MODEL_MAPPING before checking', async () => {
        stubFetch(() =>
            new Response(JSON.stringify({ models: [{ name: 'qwen3:30b-a3b' }] }), { status: 200 }),
        );
        const { OllamaProvider } = await import('./OllamaProvider.js');
        const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
        const result = await provider.verifyModelExists!('qwen-fast');
        expect(result.exists).toBe(true);
    });
});
