import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CompletionOptions } from '../types.js';

// Mock fetch globally — OllamaProvider uses native fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { OllamaProvider } from './OllamaProvider.js';

function makeResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    statusText: status === 500 ? 'Internal Server Error' : 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGpuCrashBody(): string {
  return JSON.stringify({ error: 'llama runner process has terminated: GGML_ASSERT(buffer) failed' });
}

function makeOkStreamBody(): string {
  return JSON.stringify({ message: { content: 'ciao' }, done: false }) + '\n'
    + JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 3 }) + '\n';
}

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
    });
  });

  describe('GPU crash retry (500 GGML_ASSERT)', () => {
    describe('complete()', () => {
      it('retries once on 500 GPU crash then succeeds', async () => {
        vi.useFakeTimers();

        const successBody = JSON.stringify({
          message: { content: 'Risposta OK' },
          prompt_eval_count: 10,
          eval_count: 5,
        });

        mockFetch
          .mockResolvedValueOnce(makeResponse(500, makeGpuCrashBody()))
          .mockResolvedValueOnce(makeResponse(200, successBody));

        const options: CompletionOptions = {
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
        };

        const promise = provider.complete(options);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.content).toBe('Risposta OK');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });

      it('throws on 500 GPU crash after retry still fails', async () => {
        vi.useFakeTimers();

        mockFetch
          .mockResolvedValue(makeResponse(500, makeGpuCrashBody()));

        const promise = provider.complete({
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
        });
        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Ollama API error: 500');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });

      it('does NOT retry on 500 without GGML_ASSERT (generic server error)', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(500, JSON.stringify({ error: 'some other error' })));

        await expect(provider.complete({
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
        })).rejects.toThrow('Ollama API error: 500');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('streamComplete()', () => {
      it('retries once on 500 GPU crash and streams on retry', async () => {
        vi.useFakeTimers();

        const successResponse = new Response(makeOkStreamBody(), {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });

        mockFetch
          .mockResolvedValueOnce(makeResponse(500, makeGpuCrashBody()))
          .mockResolvedValueOnce(successResponse);

        const chunks: string[] = [];
        const gen = provider.streamComplete({
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
          stream: true,
        });

        const collectPromise = (async () => {
          for await (const chunk of gen) {
            if (chunk.content) chunks.push(chunk.content);
          }
        })();

        await vi.runAllTimersAsync();
        await collectPromise;

        expect(chunks.join('')).toBe('ciao');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });
    });
  });
});
