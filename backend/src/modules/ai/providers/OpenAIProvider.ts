import OpenAI from 'openai';
import type { AIProvider, CompletionOptions, CompletionResult, ModelExistsResult, StreamChunk } from '../types.js';
import { verifyModelExistsHttp } from './modelExistsHttp.js';

// Models that use max_completion_tokens and don't support temperature
const REASONING_MODELS = /^(o1|o3|o4|gpt-5|gpt-4\.5)/i;

// Convert Anthropic-format tool definitions to OpenAI format.
// Anthropic: { name, description, input_schema }
// OpenAI:    { type: 'function', function: { name, description, parameters } }
function toOpenAITools(tools: any[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema ?? t.parameters ?? { type: 'object', properties: {}, required: [] },
    },
  }));
}

function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.test(model);
}

function buildTokenParam(model: string, maxTokens?: number): Record<string, number> {
  const tokens = maxTokens || 4096;
  if (isReasoningModel(model)) {
    return { max_completion_tokens: tokens };
  }
  return { max_tokens: tokens };
}

// OpenAI Provider
export class OpenAIProvider implements AIProvider {
  name: 'openai' = 'openai';
  private client: OpenAI;
  private apiKey: string;
  private baseUrl: string;
  private redisClient?: any;

  constructor(config?: { apiKey?: string; baseUrl?: string; redisClient?: any }) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    // 120s timeout to prevent hanging on slow/new models
    this.client = new OpenAI({ apiKey, timeout: 120000 });
    this.apiKey = apiKey;
    this.baseUrl = (config?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.redisClient = config?.redisClient;
  }

  /**
   * Verify a model exists on OpenAI via `GET /v1/models/{id}`.
   * Result is cached (Redis if available) for 1 hour.
   */
  async verifyModelExists(modelId: string): Promise<ModelExistsResult> {
    return verifyModelExistsHttp({
      provider: 'openai',
      modelId,
      url: `${this.baseUrl}/models/${encodeURIComponent(modelId)}`,
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      redisClient: this.redisClient,
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const reasoning = isReasoningModel(options.model);
    const createOpts: any = {
      model: options.model,
      messages: options.messages as any,
      ...buildTokenParam(options.model, options.maxTokens),
      tools: options.tools ? toOpenAITools(options.tools as any[]) : undefined,
    };
    // temperature not supported by reasoning models
    if (!reasoning) {
      createOpts.temperature = options.temperature || 0.7;
    }
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
    const reasoning = isReasoningModel(options.model);
    const createOpts: any = {
      model: options.model,
      messages: options.messages as any,
      ...buildTokenParam(options.model, options.maxTokens),
      stream: true,
      tools: options.tools ? toOpenAITools(options.tools as any[]) : undefined,
    };
    // temperature not supported by reasoning models
    if (!reasoning) {
      createOpts.temperature = options.temperature || 0.7;
    }
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
