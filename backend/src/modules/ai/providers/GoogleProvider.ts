import { GoogleGenAI } from '@google/genai';
import type { AIProvider, CompletionOptions, CompletionResult, ProviderConfig, StreamChunk } from '../types.js';

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
