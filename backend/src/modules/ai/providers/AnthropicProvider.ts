import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, CompletionOptions, CompletionResult, ProviderConfig, StreamChunk } from '../types.js';

// Anthropic Provider (supports both API key and OAuth token)
export class AnthropicProvider implements AIProvider {
  name: 'anthropic' = 'anthropic';
  private client: Anthropic | null = null;
  private oauthToken: string | null = null;
  private apiKey: string | null = null;

  constructor(config?: ProviderConfig) {
    // OAuth token takes priority over API key
    if (config?.apiKey?.startsWith('sk-ant-oat')) {
      // This is an OAuth token, use Bearer auth
      this.oauthToken = config.apiKey;
    } else if (config?.apiKey) {
      this.apiKey = config.apiKey;
      this.client = new Anthropic({ apiKey: config.apiKey });
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.apiKey = process.env.ANTHROPIC_API_KEY;
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  }

  // Helper to make API calls with OAuth token
  private async callWithOAuth(endpoint: string, body: any, stream: boolean = false): Promise<Response> {
    console.log(`[Anthropic OAuth] Calling ${endpoint}, stream=${stream}, model=${body.model}`);

    const response = await fetch(`https://api.anthropic.com/v1${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.oauthToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',  // Required for OAuth tokens
        'User-Agent': 'Claude-Code/2.1.5'  // Identify as Claude Code
      },
      body: JSON.stringify({ ...body, stream })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Anthropic OAuth] Error ${response.status}: ${errorText}`);
      let errorMessage = `Anthropic API error: ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch { }
      throw new Error(errorMessage);
    }

    console.log(`[Anthropic OAuth] Success ${response.status}`);
    return response;
  }

  /**
   * Format messages for Anthropic API: transforms tool/tool_calls messages.
   * Shared between complete() and streamComplete() to avoid divergence.
   */
  private formatAnthropicMessages(messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }>): any[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.tool_call_id,
                content: m.content
              }
            ]
          };
        }

        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });

        if (m.role === 'assistant' && (m as any).tool_calls) {
          (m as any).tool_calls.forEach((tc: any) => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function?.name || tc.name,
              input: typeof tc.function?.arguments === 'string'
                ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
                : (tc.function?.arguments || tc.input)
            });
          });
        }

        return {
          role: m.role as 'user' | 'assistant',
          content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
        };
      });
  }

  /** Inject document blocks into the first user message of formatted messages. */
  private injectDocumentBlocks(messages: any[], documentBlocks: any[]): void {
    if (!documentBlocks?.length) return;
    const firstUserIdx = messages.findIndex((m: any) => m.role === 'user');
    if (firstUserIdx < 0) return;
    const existing = messages[firstUserIdx].content;
    const existingContent = Array.isArray(existing)
      ? existing
      : [{ type: 'text', text: existing }];
    messages[firstUserIdx] = {
      ...messages[firstUserIdx],
      content: [...documentBlocks, ...existingContent],
    };
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    // Extract system message
    const systemMessage = options.messages.find(m => m.role === 'system');

    // v4.0: Build system with cache_control support
    const systemContent = systemMessage?.content
      ? (options.cacheControl
        ? [{ type: 'text', text: systemMessage.content, cache_control: { type: 'ephemeral' } }]
        : systemMessage.content)
      : undefined;

    const formattedMessages = this.formatAnthropicMessages(options.messages);
    this.injectDocumentBlocks(formattedMessages, options.documentBlocks || []);

    const requestBody: any = {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      system: systemContent,
      messages: formattedMessages,
      tools: options.tools as any
    };

    // tool_choice enforcement
    if (options.toolChoice && requestBody.tools) {
      if (options.toolChoice === 'any') {
        requestBody.tool_choice = { type: 'any' };
      } else if (options.toolChoice === 'auto') {
        requestBody.tool_choice = { type: 'auto' };
      } else if (typeof options.toolChoice === 'object' && options.toolChoice.name) {
        requestBody.tool_choice = { type: 'tool', name: options.toolChoice.name };
      }
    }

    // v4.0: Extended thinking (not compatible with tool_choice "any" or "tool")
    const toolChoiceBlocksThinking = requestBody.tool_choice && requestBody.tool_choice.type !== 'auto';
    if (options.thinking && !toolChoiceBlocksThinking) {
      requestBody.thinking = options.thinking.type === 'adaptive'
        ? { type: 'adaptive' }
        : { type: 'enabled', budget_tokens: options.thinking.budgetTokens || 16000 };
    }

    // v4.0: Structured outputs
    if (options.outputSchema) {
      requestBody.output_config = {
        format: {
          type: options.outputSchema.type,
          json_schema: options.outputSchema.jsonSchema,
        }
      };
    }

    // Use OAuth if available, otherwise use SDK
    if (this.oauthToken) {
      const response = await this.callWithOAuth('/messages', requestBody, false);
      const data = await response.json() as any;

      const textContent = data.content.find((c: any) => c.type === 'text');
      const thinkingBlock = data.content.find((c: any) => c.type === 'thinking');

      return {
        content: textContent?.text || '',
        tokensInput: data.usage.input_tokens,
        tokensOutput: data.usage.output_tokens,
        model: options.model,
        provider: 'anthropic',
        toolCalls: data.content.filter((c: any) => c.type === 'tool_use'),
        cacheCreationTokens: data.usage.cache_creation_input_tokens || 0,
        cacheReadTokens: data.usage.cache_read_input_tokens || 0,
        thinkingContent: thinkingBlock?.thinking || undefined,
        thinkingTokens: thinkingBlock ? (data.usage.thinking_tokens || 0) : undefined,
      };
    }

    // Use SDK with API key
    if (!this.client) {
      throw new Error('Anthropic provider not configured. Set API key or OAuth token.');
    }

    const response = await this.client.messages.create(requestBody);
    const textContent = response.content.find(c => c.type === 'text');
    const thinkingBlock = response.content.find((c: any) => c.type === 'thinking');

    return {
      content: textContent?.text || '',
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      model: options.model,
      provider: 'anthropic',
      toolCalls: response.content.filter(c => c.type === 'tool_use'),
      cacheCreationTokens: (response.usage as any).cache_creation_input_tokens || 0,
      cacheReadTokens: (response.usage as any).cache_read_input_tokens || 0,
      thinkingContent: (thinkingBlock as any)?.thinking || undefined,
      thinkingTokens: (response.usage as any).thinking_tokens || 0,
    };
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const systemMessage = options.messages.find(m => m.role === 'system');

    // Format tools for Anthropic API if provided
    const anthropicTools = options.tools?.map((t: any) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    }));

    // v4.0: Build system with cache_control support
    const systemContent = systemMessage?.content
      ? (options.cacheControl
        ? [{ type: 'text', text: systemMessage.content, cache_control: { type: 'ephemeral' } }]
        : systemMessage.content)
      : undefined;

    const streamFormattedMessages = this.formatAnthropicMessages(options.messages);
    this.injectDocumentBlocks(streamFormattedMessages, options.documentBlocks || []);

    const requestBody: any = {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      system: systemContent,
      messages: streamFormattedMessages,
      tools: anthropicTools && anthropicTools.length > 0 ? anthropicTools : undefined
    };

    // tool_choice enforcement (not compatible with extended thinking)
    if (options.toolChoice && requestBody.tools) {
      if (options.toolChoice === 'any') {
        requestBody.tool_choice = { type: 'any' };
      } else if (options.toolChoice === 'auto') {
        requestBody.tool_choice = { type: 'auto' };
      } else if (typeof options.toolChoice === 'object' && options.toolChoice.name) {
        requestBody.tool_choice = { type: 'tool', name: options.toolChoice.name };
      }
    }

    // v4.0: Extended thinking (not compatible with tool_choice "any" or "tool")
    const toolChoiceBlocksThinking = requestBody.tool_choice && requestBody.tool_choice.type !== 'auto';
    if (options.thinking && !toolChoiceBlocksThinking) {
      requestBody.thinking = options.thinking.type === 'adaptive'
        ? { type: 'adaptive' }
        : { type: 'enabled', budget_tokens: options.thinking.budgetTokens || 16000 };
    }

    // v4.0: Structured outputs
    if (options.outputSchema) {
      requestBody.output_config = {
        format: {
          type: options.outputSchema.type,
          json_schema: options.outputSchema.jsonSchema,
        }
      };
    }

    // Use OAuth if available
    if (this.oauthToken) {
      const response = await this.callWithOAuth('/messages', requestBody, true);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      // Track tool_use and thinking blocks being streamed
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      const accumulatedToolCalls: any[] = [];
      let isThinkingBlock = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as any;

              // v4.0: Thinking block handling
              if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
                isThinkingBlock = true;
              } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
                yield { content: '', done: false, thinking: event.delta.thinking || '' };
              } else if (event.type === 'content_block_stop' && isThinkingBlock) {
                isThinkingBlock = false;
                yield { content: '', done: false, thinkingDone: true };
              } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                // Start of a tool_use block
                currentToolUse = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  inputJson: ''
                };
              } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
                // Accumulate tool input JSON
                if (currentToolUse) {
                  currentToolUse.inputJson += event.delta.partial_json || '';
                }
              } else if (event.type === 'content_block_stop' && currentToolUse) {
                // End of tool_use block — emit accumulated tool call
                accumulatedToolCalls.push({
                  id: currentToolUse.id,
                  type: 'function',
                  function: {
                    name: currentToolUse.name,
                    arguments: currentToolUse.inputJson
                  }
                });
                currentToolUse = null;
              } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                yield { content: event.delta.text || '', done: false };
                // v4.0: Citations delta
              } else if (event.type === 'content_block_delta' && event.delta?.type === 'citations_delta') {
                yield { content: '', done: false, citations: [event.delta.citation] };
                // v4.0: Usage in message_delta (includes cache metrics)
              } else if (event.type === 'message_delta' && event.usage) {
                yield {
                  content: '', done: false,
                  usage: {
                    outputTokens: event.usage.output_tokens,
                    cacheCreationTokens: event.usage.cache_creation_input_tokens,
                    cacheReadTokens: event.usage.cache_read_input_tokens,
                  }
                };
              } else if (event.type === 'message_stop') {
                yield {
                  content: '',
                  done: true,
                  toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined
                };
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // If stream ended without message_stop but we have tool calls, yield them
      if (accumulatedToolCalls.length > 0) {
        yield { content: '', done: true, toolCalls: accumulatedToolCalls };
      }
      return;
    }

    // Use SDK with API key
    if (!this.client) {
      throw new Error('Anthropic provider not configured. Set API key or OAuth token.');
    }

    const stream = this.client.messages.stream(requestBody as any);

    // Track tool_use and thinking blocks being streamed (SDK path)
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
    const accumulatedToolCalls: any[] = [];
    let isThinkingBlock = false;

    for await (const event of stream) {
      // v4.0: Thinking block handling (SDK path)
      if (event.type === 'content_block_start' && (event as any).content_block?.type === 'thinking') {
        isThinkingBlock = true;
      } else if (event.type === 'content_block_delta' && (event as any).delta?.type === 'thinking_delta') {
        yield { content: '', done: false, thinking: (event as any).delta.thinking || '' };
      } else if (event.type === 'content_block_stop' && isThinkingBlock) {
        isThinkingBlock = false;
        yield { content: '', done: false, thinkingDone: true };
      } else if (event.type === 'content_block_start' && (event as any).content_block?.type === 'tool_use') {
        currentToolUse = {
          id: (event as any).content_block.id,
          name: (event as any).content_block.name,
          inputJson: ''
        };
      } else if (event.type === 'content_block_delta' && (event as any).delta?.type === 'input_json_delta') {
        if (currentToolUse) {
          currentToolUse.inputJson += (event as any).delta.partial_json || '';
        }
      } else if (event.type === 'content_block_stop' && currentToolUse) {
        accumulatedToolCalls.push({
          id: currentToolUse.id,
          type: 'function',
          function: {
            name: currentToolUse.name,
            arguments: currentToolUse.inputJson
          }
        });
        currentToolUse = null;
      } else if (event.type === 'content_block_delta' && (event as any).delta?.type === 'text_delta') {
        yield { content: (event as any).delta.text, done: false };
        // v4.0: Citations delta (SDK path)
      } else if (event.type === 'content_block_delta' && (event as any).delta?.type === 'citations_delta') {
        yield { content: '', done: false, citations: [(event as any).delta.citation] };
        // v4.0: Usage in message_delta (SDK path — includes cache + thinking metrics)
      } else if (event.type === 'message_delta' && (event as any).usage) {
        const u = (event as any).usage;
        yield {
          content: '', done: false,
          usage: {
            outputTokens: u.output_tokens,
            cacheCreationTokens: u.cache_creation_input_tokens,
            cacheReadTokens: u.cache_read_input_tokens,
            thinkingTokens: u.thinking_tokens,
          }
        };
      } else if (event.type === 'message_stop') {
        yield {
          content: '',
          done: true,
          toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined
        };
      }
    }
  }
}
