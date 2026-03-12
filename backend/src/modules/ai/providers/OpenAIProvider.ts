import OpenAI from 'openai';
import type { AIProvider, CompletionOptions, CompletionResult, StreamChunk } from '../types.js';

// OpenAI Provider
export class OpenAIProvider implements AIProvider {
  name: 'openai' = 'openai';
  private client: OpenAI;

  constructor(config?: { apiKey?: string }) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    this.client = new OpenAI({ apiKey });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const createOpts: any = {
      model: options.model,
      messages: options.messages as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      tools: options.tools as any
    };
    // tool_choice enforcement for OpenAI
    if (options.toolChoice && createOpts.tools) {
      if (options.toolChoice === 'required' || options.toolChoice === 'any') {
        createOpts.tool_choice = 'required';
      } else if (options.toolChoice === 'auto') {
        createOpts.tool_choice = 'auto';
      } else if (typeof options.toolChoice === 'object' && options.toolChoice.name) {
        createOpts.tool_choice = { type: 'function', function: { name: options.toolChoice.name } };
      }
    }
    const response = await this.client.chat.completions.create(createOpts);

    return {
      content: response.choices[0]?.message?.content || '',
      tokensInput: response.usage?.prompt_tokens || 0,
      tokensOutput: response.usage?.completion_tokens || 0,
      model: options.model,
      provider: 'openai',
      toolCalls: response.choices[0]?.message?.tool_calls
    };
  }

  async * streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const createOpts: any = {
      model: options.model,
      messages: options.messages as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      stream: true,
      tools: options.tools as any
    };
    // tool_choice enforcement for OpenAI
    if (options.toolChoice && createOpts.tools) {
      if (options.toolChoice === 'required' || options.toolChoice === 'any') {
        createOpts.tool_choice = 'required';
      } else if (options.toolChoice === 'auto') {
        createOpts.tool_choice = 'auto';
      } else if (typeof options.toolChoice === 'object' && options.toolChoice.name) {
        createOpts.tool_choice = { type: 'function', function: { name: options.toolChoice.name } };
      }
    }
    // SECURITY: Forward abort signal to cancel upstream request on client disconnect
    const stream = await this.client.chat.completions.create(createOpts, {
      signal: options.signal,
    }) as unknown as AsyncIterable<any>;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      const done = chunk.choices[0]?.finish_reason === 'stop' || chunk.choices[0]?.finish_reason === 'tool_calls';
      yield {
        content,
        done,
        toolCalls: chunk.choices[0]?.delta?.tool_calls
      };
    }
  }
}
