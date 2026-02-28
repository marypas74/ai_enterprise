import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

// Types
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface CompletionOptions {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[]; // Allow passing tools definitions
  // --- v4.0: Advanced provider features ---
  cacheControl?: boolean;              // Enable Anthropic prompt caching
  thinking?: {                          // Extended/adaptive thinking
    type: 'enabled' | 'adaptive';
    budgetTokens?: number;
  };
  outputSchema?: {                      // Structured outputs (JSON schema)
    type: 'json_schema';
    jsonSchema: Record<string, any>;
  };
  documentBlocks?: Array<{              // Native PDF/document blocks (Anthropic)
    type: 'document';
    source: { type: 'base64' | 'text'; media_type: string; data: string };
    title?: string;
    citations?: { enabled: boolean };
    cacheControl?: { type: 'ephemeral' };
  }>;
}

export interface CompletionResult {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  provider: ProviderType;
  toolCalls?: any[];
  // --- v4.0: Advanced metrics ---
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  thinkingContent?: string;
  thinkingTokens?: number;
  citations?: Array<{
    type: string;
    citedText: string;
    documentIndex: number;
    documentTitle?: string;
    startCharIndex?: number;
    endCharIndex?: number;
    startPageNumber?: number;
    endPageNumber?: number;
  }>;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  toolCalls?: any[];
  // --- v4.0: Extended thinking & citations ---
  thinking?: string;           // Thinking block content
  thinkingDone?: boolean;      // End of thinking phase
  citations?: any[];           // Citations delta
  usage?: {                    // Token usage from stream (Anthropic message_delta)
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  keepAlive?: string;
  customHeaders?: Record<string, string>;
}

// Model pricing (USD per 1K tokens) - Updated December 2025
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI - Latest models
  'gpt-4.1': { input: 0.002, output: 0.008 },          // Latest GPT-4.1
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },   // GPT-4.1 Mini
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },   // GPT-4.1 Nano
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  // OpenAI Reasoning models
  'o1': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
  'o1-preview': { input: 0.015, output: 0.06 },
  'o3-mini': { input: 0.0011, output: 0.0044 },
  // Anthropic - Claude 4.6 (Latest - Feb 2026)
  'claude-opus-4-6': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  // Anthropic - Claude 4.5
  'claude-opus-4-5-20251101': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  // Anthropic - Claude 4 (Current)
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  // Anthropic - Claude 3 (Legacy)
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  // Google Gemini
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gemini-2.0-flash-thinking': { input: 0.0001, output: 0.0004 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 }
};

// Calculate cost
export function calculateCost(model: string, tokensInput: number, tokensOutput: number): number {
  const pricing = MODEL_PRICING[model] || { input: 0.01, output: 0.03 };
  return (tokensInput * pricing.input + tokensOutput * pricing.output) / 1000;
}

// Provider interface (Strategy pattern)
export interface AIProvider {
  name: ProviderType;
  complete(options: CompletionOptions): Promise<CompletionResult>;
  streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk>;
}

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
    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      tools: options.tools as any
    });

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
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      stream: true,
      tools: options.tools as any
    });

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
        'User-Agent': 'Claude-Code/2.1.0'  // Identify as Claude Code
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
                ? JSON.parse(tc.function.arguments)
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

    // v4.0: Inject document blocks into first user message for native PDF/citations
    if (options.documentBlocks?.length) {
      const firstUserIdx = formattedMessages.findIndex((m: any) => m.role === 'user');
      if (firstUserIdx >= 0) {
        const existing = formattedMessages[firstUserIdx].content;
        const existingContent = Array.isArray(existing)
          ? existing
          : [{ type: 'text', text: existing }];
        formattedMessages[firstUserIdx] = {
          ...formattedMessages[firstUserIdx],
          content: [...options.documentBlocks, ...existingContent],
        };
      }
    }

    const requestBody: any = {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      system: systemContent,
      messages: formattedMessages,
      tools: options.tools as any
    };

    // v4.0: Extended thinking
    if (options.thinking) {
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

    // v4.0: Inject document blocks into first user message for native PDF/citations
    if (options.documentBlocks?.length) {
      const firstUserIdx = streamFormattedMessages.findIndex((m: any) => m.role === 'user');
      if (firstUserIdx >= 0) {
        const existing = streamFormattedMessages[firstUserIdx].content;
        const existingContent = Array.isArray(existing)
          ? existing
          : [{ type: 'text', text: existing }];
        streamFormattedMessages[firstUserIdx] = {
          ...streamFormattedMessages[firstUserIdx],
          content: [...options.documentBlocks, ...existingContent],
        };
      }
    }

    const requestBody: any = {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      system: systemContent,
      messages: streamFormattedMessages,
      tools: anthropicTools && anthropicTools.length > 0 ? anthropicTools : undefined
    };

    // v4.0: Extended thinking
    if (options.thinking) {
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
      // v4.0: Usage in message_delta (SDK path)
      } else if (event.type === 'message_delta' && (event as any).usage) {
        const u = (event as any).usage;
        yield {
          content: '', done: false,
          usage: {
            outputTokens: u.output_tokens,
            cacheCreationTokens: u.cache_creation_input_tokens,
            cacheReadTokens: u.cache_read_input_tokens,
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

// Google Gemini Provider (supports both API key and OAuth)
export class GoogleProvider implements AIProvider {
  name: 'google' = 'google';
  private client: GoogleGenAI;
  private userId?: number;

  constructor(config?: ProviderConfig & { userId?: number }) {
    this.userId = config?.userId;

    // Priority: OAuth token > API key in config > Environment variable
    if (config?.apiKey) {
      // Could be an OAuth access token or API key
      this.client = new GoogleGenAI({ apiKey: config.apiKey });
      console.log('[GoogleProvider] Using provided API key/OAuth token');
    } else if (process.env.GOOGLE_AI_API_KEY) {
      this.client = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
      console.log('[GoogleProvider] Using environment API key');
    } else {
      throw new Error('Google API key not configured. Set GOOGLE_AI_API_KEY or configure OAuth.');
    }
  }

  /**
   * Update the client with new credentials (e.g., refreshed OAuth token)
   */
  updateCredentials(apiKey: string): void {
    this.client = new GoogleGenAI({ apiKey });
    console.log('[GoogleProvider] Updated credentials');
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    // Build prompt with history
    const systemMessage = options.messages.find(m => m.role === 'system');
    const conversationMessages = options.messages.filter(m => m.role !== 'system');
    const lastMessage = conversationMessages[conversationMessages.length - 1];

    const response = await (this.client.models as any).generateContent({
      model: options.model,
      contents: conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      config: {
        systemInstruction: systemMessage?.content,
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7
      },
      tools: options.tools ? [{
        function_declarations: options.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }))
      }] : undefined
    });

    const candidate = response.candidates?.[0];
    const content = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';
    const toolCalls = candidate?.content?.parts
      ?.filter((p: any) => p.functionCall)
      ?.map((p: any) => ({
        id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'function',
        function: {
          name: p.functionCall?.name,
          arguments: JSON.stringify(p.functionCall?.args)
        }
      }));

    return {
      content,
      tokensInput: response.usageMetadata?.promptTokenCount || 0,
      tokensOutput: response.usageMetadata?.candidatesTokenCount || 0,
      model: options.model,
      provider: 'google',
      toolCalls
    };
  }

  async * streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const systemMessage = options.messages.find(m => m.role === 'system');
    const conversationMessages = options.messages.filter(m => m.role !== 'system');

    const stream = await (this.client.models as any).generateContentStream({
      model: options.model,
      contents: conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      config: {
        systemInstruction: systemMessage?.content,
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7
      },
      tools: options.tools ? [{
        function_declarations: options.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }))
      }] : undefined
    });

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      const content = parts.map((p: any) => p.text).join('') || '';
      const toolCalls = parts
        .filter((p: any) => p.functionCall)
        .map((p: any) => ({
          id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'function',
          function: {
            name: p.functionCall?.name,
            arguments: JSON.stringify(p.functionCall?.args)
          }
        }));

      yield { content, done: false, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
    }
    yield { content: '', done: true };
  }
}

// Ollama Provider (Local LLMs) - With Debug Logging
export class OllamaProvider implements AIProvider {
  name: 'ollama' = 'ollama';
  private baseUrl: string;
  private timeout: number;
  private keepAlive: string;

  constructor(config?: ProviderConfig) {
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.timeout = config?.timeout || 300000; // Default 5 minutes
    this.keepAlive = config?.keepAlive || '-1'; // Keep models loaded indefinitely
    console.log(`[Ollama] Initialized: baseUrl=${this.baseUrl}, timeout=${this.timeout}ms, keepAlive=${this.keepAlive}`);
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    // Model mapping for Ollama (handles aliases from DB → actual Ollama model names)
    const modelMapping: Record<string, string> = {
      'qwen-fast': 'qwen2.5:3b',
      'llama-fast': 'llama3.2:3b',
      'gemma-fast': 'gemma2:2b',
      'phi-fast': 'phi3:mini',
      'glm-4.7-flash': 'glm4:latest',
    };

    const targetModel = modelMapping[options.model] || options.model;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || ''
      },
      body: JSON.stringify({
        model: targetModel,
        messages: options.messages,
        stream: false,
        tools: options.tools,
        options: {
          num_predict: options.maxTokens || 4096,
          temperature: options.temperature || 0.7
        },
        keep_alive: this.keepAlive
      }),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content || '',
      tokensInput: data.prompt_eval_count || 0,
      tokensOutput: data.eval_count || 0,
      model: options.model,
      provider: 'ollama',
      toolCalls: (data as any).message?.tool_calls
    };
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const startTime = Date.now();

    // Model mapping for Ollama (handles aliases from DB → actual Ollama model names)
    const modelMapping: Record<string, string> = {
      'qwen-fast': 'qwen2.5:3b',
      'llama-fast': 'llama3.2:3b',
      'gemma-fast': 'gemma2:2b',
      'phi-fast': 'phi3:mini',
      'glm-4.7-flash': 'glm4:latest',
    };

    const targetModel = modelMapping[options.model] || options.model;

    console.log(`[Ollama] Starting stream request: model=${targetModel} (orig=${options.model}), timeout=${this.timeout}ms`);
    console.log(`[Ollama] Messages count: ${options.messages.length}, last message length: ${options.messages[options.messages.length - 1]?.content?.length || 0} chars`);

    // Helper to make the Ollama API call (may retry without tools)
    let useTools = options.tools;
    const makeRequest = async () => {
      return fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || ''
        },
        body: JSON.stringify({
          model: targetModel,
          messages: options.messages,
          stream: true,
          tools: useTools,
          options: {
            num_predict: options.maxTokens || 4096,
            temperature: options.temperature || 0.7
          },
          keep_alive: this.keepAlive
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
    };

    try {
      let response = await makeRequest();

      const connectTime = Date.now() - startTime;
      console.log(`[Ollama] Connection established in ${connectTime}ms, status=${response.status}`);

      // If model doesn't support tools, retry without them
      if (!response.ok && useTools) {
        const errorText = await response.text().catch(() => '');
        if (errorText.includes('does not support tools') || errorText.includes('tools is not supported')) {
          console.warn(`[Ollama] Model "${targetModel}" does not support tools, retrying without tools`);
          useTools = undefined;
          response = await makeRequest();
          console.log(`[Ollama] Retry without tools: status=${response.status}`);
        } else {
          console.error(`[Ollama] API error: ${response.status} ${response.statusText} - ${errorText}`);
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error');
        console.error(`[Ollama] API error: ${response.status} ${response.statusText} - ${errorText}`);
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;
      let totalContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const totalTime = Date.now() - startTime;
          console.log(`[Ollama] Stream complete: ${chunkCount} chunks, ${totalContent.length} chars, ${totalTime}ms total`);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as { message?: { content: string }; done: boolean; error?: string };
            if (data.error) throw new Error(data.error);
            chunkCount++;
            if (data.message?.content) {
              totalContent += data.message.content;
            }
            if (chunkCount === 1) {
              console.log(`[Ollama] First chunk received after ${Date.now() - startTime}ms`);
            }
            yield {
              content: data.message?.content || '',
              done: data.done,
              toolCalls: (data.message as any)?.tool_calls
            };
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[Ollama] Stream error after ${elapsed}ms: ${error.name} - ${error.message}`);
      if (error.name === 'TimeoutError' || error.message?.includes('abort')) {
        throw new Error(`Ollama request timed out after ${elapsed}ms. The model may be loading or the prompt is too complex.`);
      }
      throw error;
    }
  }
}

// Custom OpenAI-compatible Provider
export class CustomProvider implements AIProvider {
  name: 'custom' = 'custom';
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

// Provider Factory with dynamic configuration support
export class AIProviderFactory {
  private static providers: Map<string, AIProvider> = new Map();
  private static providerConfigs: Map<ProviderType, ProviderConfig> = new Map();

  // Set configuration for a provider (called when settings are loaded from DB)
  static setProviderConfig(providerType: ProviderType, config: ProviderConfig) {
    this.providerConfigs.set(providerType, config);
    // Clear cached provider to force recreation with new config
    this.providers.delete(providerType);
  }

  static getProvider(model: string, providerTypeOverride?: ProviderType): AIProvider {
    const providerName = providerTypeOverride || this.getProviderName(model);
    const config = this.providerConfigs.get(providerName);

    if (!this.providers.has(providerName)) {
      switch (providerName) {
        case 'openai':
          this.providers.set(providerName, new OpenAIProvider(config));
          break;
        case 'anthropic':
          this.providers.set(providerName, new AnthropicProvider(config));
          break;
        case 'google':
          this.providers.set(providerName, new GoogleProvider());
          break;
        case 'ollama':
          this.providers.set(providerName, new OllamaProvider(config));
          break;
        case 'custom':
          if (!config) throw new Error('Custom provider requires configuration');
          this.providers.set(providerName, new CustomProvider(config));
          break;
        default:
          throw new Error(`Unknown provider for model: ${model}`);
      }
    }

    return this.providers.get(providerName)!;
  }

  static getProviderName(model: string): ProviderType {
    if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gemini-')) return 'google';
    // Check for common Ollama model patterns
    if (model.match(/^(llama|llava|mistral|mixtral|codellama|phi|qwen|gemma|deepseek|vicuna|orca|neural|dolphin|openhermes|starling|yi|solar|glm|glm4|glm-|minicpm|nomic)/i)) {
      return 'ollama';
    }
    // Default to custom for unknown models
    return 'custom';
  }

  static getAvailableModels(): string[] {
    return Object.keys(MODEL_PRICING);
  }

  // Clear all cached providers (useful when reloading configuration)
  static clearProviders() {
    this.providers.clear();
  }
}
