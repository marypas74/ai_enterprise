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
export class VLLMProvider implements AIProvider {
  readonly name: 'vllm' = 'vllm';
  private readonly client: OpenAI;
  private readonly timeout: number;

  // All chat model aliases resolve to the single served model
  private static readonly SERVED_MODEL = process.env.VLLM_SERVED_MODEL || 'qwen25vl:32b';
  private static readonly MODEL_MAP: Record<string, string> = {
    'qwen-fast': VLLMProvider.SERVED_MODEL,
    'qwen-thinking': VLLMProvider.SERVED_MODEL,
    'gemma-fast': VLLMProvider.SERVED_MODEL,
    'phi-fast': VLLMProvider.SERVED_MODEL,
    'deepseek-think': VLLMProvider.SERVED_MODEL,
    'qwq-think': VLLMProvider.SERVED_MODEL,
    'coder': VLLMProvider.SERVED_MODEL,
    'gpt-oss': VLLMProvider.SERVED_MODEL,
    'llama4': VLLMProvider.SERVED_MODEL,
  };

  // Models that should use thinking/reasoning (slower, deeper answers)
  private static readonly THINKING_MODELS = new Set([
    'qwen-thinking', 'deepseek-think', 'qwq-think',
  ]);

  /** Resolve a model alias to the actual vLLM served model name */
  private resolveModel(model: string): string {
    return VLLMProvider.MODEL_MAP[model] || VLLMProvider.SERVED_MODEL;
  }

  /** Check if this model alias should use thinking mode */
  private isThinkingModel(model: string): boolean {
    return VLLMProvider.THINKING_MODELS.has(model);
  }

  /** Prepend /no_think system prompt for fast models to skip reasoning overhead */
  private applyThinkingMode(messages: any[], model: string): any[] {
    if (this.isThinkingModel(model)) return messages;
    // For fast models, inject a system message to disable thinking
    const noThinkSystem = { role: 'system' as const, content: '/no_think' };
    const first = messages[0];
    if (first?.role === 'system') {
      // Append /no_think to existing system prompt
      return [{ ...first, content: first.content + '\n/no_think' }, ...messages.slice(1)];
    }
    return [noThinkSystem, ...messages];
  }

  /** Strip <think>...</think> tags from content (leaked thinking in non-reasoning_content field) */
  private static stripThinkTags(text: string): string {
    // Handle both closed and unclosed think tags
    return text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*$/g, '') // unclosed tag at end
      .trim();
  }

  /** Convert Anthropic-style tools to OpenAI function-calling format */
  private convertTools(tools: any[]): OpenAI.ChatCompletionTool[] {
    return tools.map(t => {
      // Already in OpenAI format
      if (t.type === 'function' && t.function) return t;
      // Anthropic format: { name, description, input_schema }
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || t.parameters || { type: 'object', properties: {}, required: [] },
        },
      };
    });
  }

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

  /**
   * Retry wrapper for vLLM API calls that may fail with 502/503 during cold-start.
   * Uses exponential backoff: 1s → 3s → 8s (3 retries max).
   * Only retries on 502/503 (server-side transient errors), not on 4xx client errors.
   */
  private async retryCreate<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const delays = [1_000, 3_000, 8_000];
    let lastError: unknown = new Error('retryCreate: no attempts made');
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const status = error?.status ?? 0;
        const isTransient = status === 502 || status === 503;
        if (!isTransient || attempt === delays.length) {
          throw error;
        }
        lastError = error;
        if (signal?.aborted) throw error;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delays[attempt]);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(error);
          }, { once: true });
        });
      }
    }
    throw lastError;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    try {
      const resolvedModel = this.resolveModel(options.model);
      const messages = this.applyThinkingMode(options.messages, options.model);
      const response = await this.retryCreate(() =>
        this.client.chat.completions.create(
          {
            model: resolvedModel,
            messages: messages as OpenAI.ChatCompletionMessageParam[],
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7,
            ...(options.tools?.length ? { tools: this.convertTools(options.tools) } : {}),
          },
          // Forward AbortSignal if provided
          ...(options.signal ? [{ signal: options.signal }] : []),
        ),
        options.signal,
      );

      const message = response.choices[0]?.message;
      // vLLM returns reasoning in reasoning_content for thinking-capable models
      const reasoning = (message as any)?.reasoning_content as string | undefined;

      return {
        content: VLLMProvider.stripThinkTags(message?.content || ''),
        tokensInput: response.usage?.prompt_tokens || 0,
        tokensOutput: response.usage?.completion_tokens || 0,
        model: options.model,
        provider: 'vllm',
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
      const resolvedModel = this.resolveModel(options.model);
      const messages = this.applyThinkingMode(options.messages, options.model);
      const stream = await this.retryCreate(() =>
        this.client.chat.completions.create(
          {
            model: resolvedModel,
            messages: messages as OpenAI.ChatCompletionMessageParam[],
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7,
            stream: true,
            stream_options: { include_usage: true },
            ...(options.tools?.length ? { tools: this.convertTools(options.tools) } : {}),
          },
          // Forward AbortSignal if provided
          ...(options.signal ? [{ signal: options.signal }] : []),
        ),
        options.signal,
      );

      let isInThinking = false;
      // Sliding-window buffer to detect <think> and </think> tags (max 8 chars for </think>)
      let tagBuffer = '';
      let insideThinkTag = false;

      for await (const chunk of stream as AsyncIterable<any>) {
        const choice = chunk.choices?.[0];
        let content = choice?.delta?.content || '';
        const finishReason = choice?.finish_reason;
        // Treat 'length' as done too (max_tokens reached)
        const done = finishReason === 'stop' || finishReason === 'tool_calls' || finishReason === 'length';

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

        // Filter <think>...</think> tags that leak into content field
        if (content) {
          let filtered = '';
          for (const char of content) {
            if (insideThinkTag) {
              tagBuffer += char;
              if (tagBuffer.endsWith('</think>')) {
                // End of think block — discard entire buffer
                insideThinkTag = false;
                tagBuffer = '';
              } else if (tagBuffer.length > 1000) {
                // Safety: if think block exceeds 1000 chars, keep discarding
                // but reset buffer to just keep the last 8 chars (length of </think>)
                tagBuffer = tagBuffer.slice(-8);
              }
            } else if (tagBuffer.length > 0 || char === '<') {
              tagBuffer += char;
              if (tagBuffer === '<think>') {
                insideThinkTag = true;
                // Don't reset tagBuffer — we need it to detect </think>
                tagBuffer = '';
              } else if (!'<think>'.startsWith(tagBuffer)) {
                // Not a think tag prefix, flush buffer as content
                filtered += tagBuffer;
                tagBuffer = '';
              }
            } else {
              filtered += char;
            }
          }
          content = filtered;
        }

        // Flush any remaining tagBuffer on done (partial '<' or '<thi' at end of stream)
        if (done && tagBuffer.length > 0 && !insideThinkTag) {
          content += tagBuffer;
          tagBuffer = '';
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

      // Flush any remaining non-think buffer content at end of stream
      if (tagBuffer.length > 0 && !insideThinkTag) {
        yield { content: tagBuffer, done: true };
      }
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      const msg = error?.message || 'Unknown error';
      const errName = error?.name || 'UnknownError';
      const errCode = error?.code || error?.status || '';
      if (errName === 'TimeoutError' || msg.includes('timeout') || msg.includes('abort')) {
        throw new Error(`[vLLM] Request timed out after ${elapsed}ms (${errName}/${errCode}): ${msg.substring(0, 200)}`);
      }
      throw new Error(`[vLLM] streamComplete() failed for model "${options.model}" after ${elapsed}ms (${errName}/${errCode}): ${msg.substring(0, 300)}`);
    }
  }
}
