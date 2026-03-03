import OpenAI from 'openai';
import type { AIProvider, CompletionOptions, CompletionResult, ProviderConfig, StreamChunk } from '../types.js';

/**
 * vLLM Provider — Local inference via vLLM OpenAI-compatible API.
 *
 * Uses the OpenAI SDK pointed at vLLM's endpoint through an nginx proxy.
 * Proxy auth via X-Vllm-Key header (separate from the API key).
 * Models are managed by Docker — no pull/remove support.
 *
 * Supports:
 *  - Chat completions (streaming + non-streaming)
 *  - Tool/function calling
 *  - Reasoning/thinking via vLLM's reasoning_content field
 */
// vLLM provider disabled - 'vllm' not in ProviderType until re-enabled
export class VLLMProvider implements AIProvider {
  readonly name = 'vllm' as any;
  private readonly client: OpenAI;
  private readonly timeout: number;

  constructor(config?: ProviderConfig) {
    const baseUrl = config?.baseUrl || process.env.VLLM_BASE_URL || 'http://localhost:8087/vllm';
    const apiKey = config?.apiKey || process.env.VLLM_API_KEY || 'dummy-key';
    const authKey = config?.customHeaders?.['X-Vllm-Key'] || process.env.VLLM_AUTH_KEY || '';
    this.timeout = config?.timeout || 300000;

    const defaultHeaders: Record<string, string> = {};
    if (authKey) {
      defaultHeaders['X-Vllm-Key'] = authKey;
    }
    if (config?.customHeaders) {
      for (const [key, value] of Object.entries(config.customHeaders)) {
        if (key !== 'X-Vllm-Key') {
          defaultHeaders[key] = value;
        }
      }
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      defaultHeaders,
      timeout: this.timeout,
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: options.model,
        messages: options.messages as OpenAI.ChatCompletionMessageParam[],
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        ...(options.tools ? { tools: options.tools } : {}),
      });

      const message = response.choices[0]?.message;
      // vLLM returns reasoning in reasoning_content for thinking-capable models
      const reasoning = (message as any)?.reasoning_content as string | undefined;

      return {
        content: message?.content || '',
        tokensInput: response.usage?.prompt_tokens || 0,
        tokensOutput: response.usage?.completion_tokens || 0,
        model: options.model,
        provider: 'vllm' as any,
        toolCalls: message?.tool_calls,
        thinkingContent: reasoning || undefined,
      };
    } catch (error: any) {
      const msg = error?.message || 'Unknown error';
      throw new Error(`[vLLM] complete() failed for model "${options.model}": ${msg}`);
    }
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const startTime = Date.now();
    try {
      const stream = await this.client.chat.completions.create({
        model: options.model,
        messages: options.messages as OpenAI.ChatCompletionMessageParam[],
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
        ...(options.tools ? { tools: options.tools } : {}),
      });

      let isInThinking = false;

      for await (const chunk of stream as AsyncIterable<any>) {
        const choice = chunk.choices?.[0];
        const content = choice?.delta?.content || '';
        const finishReason = choice?.finish_reason;
        const done = finishReason === 'stop' || finishReason === 'tool_calls';

        // vLLM streams reasoning in delta.reasoning_content for thinking models
        const reasoning = choice?.delta?.reasoning_content as string | undefined;

        if (reasoning) {
          if (!isInThinking) isInThinking = true;
          yield { content: '', done: false, thinking: reasoning };
          continue;
        }

        // Transition from thinking to content
        if (isInThinking && content) {
          isInThinking = false;
          yield { content: '', done: false, thinkingDone: true };
        }

        const usage = chunk.usage;
        yield {
          content,
          done,
          toolCalls: choice?.delta?.tool_calls,
          ...(usage ? {
            usage: {
              inputTokens: usage.prompt_tokens,
              outputTokens: usage.completion_tokens,
            }
          } : {}),
        };
      }

      // Edge case: thinking emitted but no content followed
      if (isInThinking) {
        yield { content: '', done: false, thinkingDone: true };
      }
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      const msg = error?.message || 'Unknown error';
      if (error?.name === 'TimeoutError' || msg.includes('timeout') || msg.includes('abort')) {
        throw new Error(`[vLLM] Request timed out after ${elapsed}ms. Model may be loading or prompt too complex.`);
      }
      throw new Error(`[vLLM] streamComplete() failed for model "${options.model}" after ${elapsed}ms: ${msg}`);
    }
  }
}
