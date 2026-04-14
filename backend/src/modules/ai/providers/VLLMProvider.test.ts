import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CompletionOptions } from '../types.js';

// Mock OpenAI SDK — must be a proper class for `new OpenAI()` to work
const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_config?: any) { /* noop */ }
  }
  return { default: MockOpenAI };
});

import { VLLMProvider } from './VLLMProvider.js';

describe('VLLMProvider', () => {
  let provider: VLLMProvider;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new VLLMProvider({
      baseUrl: 'http://10.0.1.1:8087/vllm',
      apiKey: 'test-api-key',
      customHeaders: { 'X-Vllm-Key': 'test-auth-key' }
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('constructor', () => {
    it('should set provider name to vllm', () => {
      expect(provider.name).toBe('vllm');
    });

    it('should use env vars when config not provided', () => {
      process.env.VLLM_BASE_URL = 'http://env-url:8087/vllm';
      process.env.VLLM_API_KEY = 'env-api-key';
      process.env.VLLM_AUTH_KEY = 'env-auth-key';

      const p = new VLLMProvider({});
      expect(p.name).toBe('vllm');
    });

    it('should use defaults when no config or env', () => {
      delete process.env.VLLM_BASE_URL;
      delete process.env.VLLM_API_KEY;
      delete process.env.VLLM_AUTH_KEY;

      const p = new VLLMProvider();
      expect(p.name).toBe('vllm');
    });
  });

  describe('complete', () => {
    it('should return CompletionResult with provider=vllm', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hi there!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const options: CompletionOptions = {
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
        temperature: 0.7
      };

      const result = await provider.complete(options);

      expect(result.provider).toBe('vllm');
      expect(result.content).toBe('Hi there!');
      expect(result.tokensInput).toBe(10);
      expect(result.tokensOutput).toBe(5);
      expect(result.model).toBe('Qwen/Qwen3-14B');
    });

    it('should pass tool definitions to OpenAI SDK', async () => {
      const tools = [{ type: 'function', function: { name: 'test', parameters: {} } }];

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'result', tool_calls: [{ id: '1', function: { name: 'test', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const result = await provider.complete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }],
        tools
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tools })
      );
    });

    it('should handle empty response gracefully', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 5, completion_tokens: 0 }
      });

      const result = await provider.complete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(result.content).toBe('');
      expect(result.tokensInput).toBe(5);
      expect(result.tokensOutput).toBe(0);
    });

    it('should handle missing usage gracefully', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'text' } }],
        usage: undefined
      });

      const result = await provider.complete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(result.tokensInput).toBe(0);
      expect(result.tokensOutput).toBe(0);
    });
  });

  describe('streamComplete', () => {
    it('should yield StreamChunk objects with correct done flag', async () => {
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Hi' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: ' there!' }, finish_reason: 'stop' }] };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const chunks: any[] = [];
      for await (const chunk of provider.streamComplete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe('Hi');
      expect(chunks[0].done).toBe(false);
      expect(chunks[1].content).toBe(' there!');
      expect(chunks[1].done).toBe(true);
    });

    it('should include usage from final chunk', async () => {
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Hi' }, finish_reason: null }] };
        yield {
          choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 15, completion_tokens: 3 }
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const chunks: any[] = [];
      for await (const chunk of provider.streamComplete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      })) {
        chunks.push(chunk);
      }

      expect(chunks[1].usage).toEqual({
        inputTokens: 15,
        outputTokens: 3
      });
    });

    it('should handle tool calls in stream', async () => {
      const toolCall = { index: 0, id: 'tc_1', function: { name: 'test', arguments: '{}' } };
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: '', tool_calls: [toolCall] }, finish_reason: 'tool_calls' }] };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const chunks: any[] = [];
      for await (const chunk of provider.streamComplete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].done).toBe(true);
      expect(chunks[0].toolCalls).toEqual([toolCall]);
    });

    it('should request stream with include_usage', async () => {
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of provider.streamComplete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          stream_options: { include_usage: true }
        })
      );
    });
  });

  describe('error handling', () => {
    it('should wrap complete() errors with context', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(provider.complete({
        model: 'Qwen/Qwen3-14B',
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toThrow('[vLLM] complete() failed for model "Qwen/Qwen3-14B": Connection refused');
    });

    it('should wrap streamComplete() errors with context and elapsed time', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Server unavailable'));

      await expect(async () => {
        for await (const _chunk of provider.streamComplete({
          model: 'Qwen/Qwen3-14B',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })) {
          // consume
        }
      }).rejects.toThrow(/\[vLLM\] streamComplete\(\) failed for model "Qwen\/Qwen3-14B"/);
    });

    it('should detect timeout errors in streamComplete()', async () => {
      const timeoutErr = new Error('Request timed out');
      timeoutErr.name = 'TimeoutError';
      mockCreate.mockRejectedValueOnce(timeoutErr);

      await expect(async () => {
        for await (const _chunk of provider.streamComplete({
          model: 'Qwen/Qwen3-14B',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })) {
          // consume
        }
      }).rejects.toThrow(/timed out/);
    });
  });

  describe('thinking/reasoning support', () => {
    it('should extract reasoning_content from complete() response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Answer', reasoning_content: 'Let me think...' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 }
      });

      const result = await provider.complete({
        model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
        messages: [{ role: 'user', content: 'Solve this' }]
      });

      expect(result.thinkingContent).toBe('Let me think...');
      expect(result.content).toBe('Answer');
    });

    it('should stream reasoning_content as thinking chunks', async () => {
      const mockStream = (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'Step 1...' }, finish_reason: null }] };
        yield { choices: [{ delta: { reasoning_content: 'Step 2...' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'The answer is 42' }, finish_reason: 'stop' }] };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const chunks: any[] = [];
      for await (const chunk of provider.streamComplete({
        model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
        messages: [{ role: 'user', content: 'Think about this' }],
        stream: true
      })) {
        chunks.push(chunk);
      }

      // thinking chunk 1
      expect(chunks[0].thinking).toBe('Step 1...');
      expect(chunks[0].content).toBe('');
      // thinking chunk 2
      expect(chunks[1].thinking).toBe('Step 2...');
      // thinkingDone transition
      expect(chunks[2].thinkingDone).toBe(true);
      // content chunk
      expect(chunks[3].content).toBe('The answer is 42');
      expect(chunks[3].done).toBe(true);
    });

    it('should handle thinking without subsequent content', async () => {
      const mockStream = (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'Thinking...' }, finish_reason: null }] };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const chunks: any[] = [];
      for await (const chunk of provider.streamComplete({
        model: 'Qwen/QwQ-32B',
        messages: [{ role: 'user', content: 'Think' }],
        stream: true
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].thinking).toBe('Thinking...');
      // thinkingDone emitted as edge case
      expect(chunks[1].thinkingDone).toBe(true);
    });
  });

  describe('retry on 502/503 (cold-start backoff)', () => {
    const make502 = () => Object.assign(new Error('502 Bad Gateway'), { status: 502 });
    const make503 = () => Object.assign(new Error('503 Service Unavailable'), { status: 503 });
    const make400 = () => Object.assign(new Error('400 Bad Request'), { status: 400 });

    describe('complete()', () => {
      it('retries once on 502 and succeeds', async () => {
        vi.useFakeTimers();
        const successResponse = {
          choices: [{ message: { content: 'hello', tool_calls: undefined } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
        mockCreate
          .mockRejectedValueOnce(make502())
          .mockResolvedValueOnce(successResponse);

        const promise = provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.content).toBe('hello');
        expect(mockCreate).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });

      it('retries up to 3 times then throws on persistent 502', async () => {
        vi.useFakeTimers();
        mockCreate.mockRejectedValue(make502());

        const promise = provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] });
        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow(/complete\(\) failed/);
        expect(mockCreate).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
        vi.useRealTimers();
      });

      it('does NOT retry on 400 (client error)', async () => {
        mockCreate.mockRejectedValue(make400());

        await expect(
          provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] })
        ).rejects.toThrow(/complete\(\) failed/);
        expect(mockCreate).toHaveBeenCalledTimes(1); // no retry
      });

      it('retries on 503 as well', async () => {
        vi.useFakeTimers();
        const successResponse = {
          choices: [{ message: { content: 'ok', tool_calls: undefined } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        };
        mockCreate
          .mockRejectedValueOnce(make503())
          .mockResolvedValueOnce(successResponse);

        const promise = provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.content).toBe('ok');
        expect(mockCreate).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });
    });

    describe('streamComplete()', () => {
      it('retries stream creation once on 502 and succeeds', async () => {
        vi.useFakeTimers();

        const mockStream = (async function* () {
          yield { choices: [{ delta: { content: 'hello' }, finish_reason: null }] };
          yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
        })();

        mockCreate
          .mockRejectedValueOnce(make502())
          .mockResolvedValueOnce(mockStream);

        const chunks: string[] = [];
        const gen = provider.streamComplete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }], stream: true });
        const collectPromise = (async () => {
          for await (const chunk of gen) {
            if (chunk.content) chunks.push(chunk.content);
          }
        })();

        await vi.runAllTimersAsync();
        await collectPromise;

        expect(chunks.join('')).toBe('hello');
        expect(mockCreate).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });

      it('does NOT retry on 400 for stream', async () => {
        mockCreate.mockRejectedValue(make400());

        const gen = provider.streamComplete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }], stream: true });
        await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow(/streamComplete\(\) failed/);
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
