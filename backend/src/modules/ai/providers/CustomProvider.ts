import OpenAI from 'openai';
import type { AIProvider, CompletionOptions, CompletionResult, ProviderConfig, StreamChunk } from '../types.js';

// Custom OpenAI-compatible Provider
export class CustomProvider implements AIProvider {
  name = 'custom' as const;
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || 'dummy-key',
      baseURL: config.baseUrl,
      defaultHeaders: config.customHeaders
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      messages: options.messages as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      tools: options.tools
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokensInput: response.usage?.prompt_tokens || 0,
      tokensOutput: response.usage?.completion_tokens || 0,
      model: options.model,
      provider: 'custom'
    };
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: options.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      messages: options.messages as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      stream: true,
      tools: options.tools
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      const done = chunk.choices[0]?.finish_reason === 'stop';
      yield { content, done };
    }
  }
}
