import { GoogleGenAI } from '@google/genai';
import type { AIProvider, CompletionOptions, CompletionResult, ModelExistsResult, ProviderConfig, StreamChunk } from '../types.js';
import { verifyModelExistsHttp } from './modelExistsHttp.js';

// Google Gemini Provider (supports both API key and OAuth)
export class GoogleProvider implements AIProvider {
  name: 'google' = 'google';
  private client: GoogleGenAI;
  private userId?: number;
  private apiKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  private redisClient?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  constructor(config?: ProviderConfig & { userId?: number; redisClient?: any }) {
    this.userId = config?.userId;
    this.redisClient = config?.redisClient;

    // Priority: OAuth token > API key in config > Environment variable
    const resolvedKey = config?.apiKey || process.env.GOOGLE_AI_API_KEY;
    if (!resolvedKey) {
      throw new Error('Google API key not configured. Set GOOGLE_AI_API_KEY or configure OAuth.');
    }
    this.apiKey = resolvedKey;
    this.client = new GoogleGenAI({ apiKey: resolvedKey });
    console.log(`[GoogleProvider] Using ${config?.apiKey ? 'provided API key/OAuth token' : 'environment API key'}`);
  }

  /**
   * Verify a Gemini model exists via `GET /v1beta/models/{id}?key=...`.
   * Note: model IDs may be passed without the `models/` prefix that the API
   * URL expects, so we normalise.
   */
  async verifyModelExists(modelId: string): Promise<ModelExistsResult> {
    const normalised = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${normalised}?key=${encodeURIComponent(this.apiKey)}`;
    return verifyModelExistsHttp({
      provider: 'google',
      modelId,
      url,
      redisClient: this.redisClient,
    });
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        function_declarations: options.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }))
      }] : undefined
    });

    const candidate = response.candidates?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const content = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';
    const toolCalls = candidate?.content?.parts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      ?.filter((p: any) => p.functionCall)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        function_declarations: options.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }))
      }] : undefined
    });

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const content = parts.map((p: any) => p.text).join('') || '';
      const toolCalls = parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        .filter((p: any) => p.functionCall)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
