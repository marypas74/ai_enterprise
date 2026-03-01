import type { AIProvider, CompletionOptions, CompletionResult, ProviderConfig, StreamChunk } from '../types.js';

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

  // Model mapping for Ollama (handles aliases from DB -> actual Ollama model names)
  private static readonly MODEL_MAPPING: Record<string, string> = {
    'qwen-fast': 'qwen3:30b-a3b',       // MoE ultra-fast
    'qwen-thinking': 'qwen3:32b',       // Qwen3 32B with native thinking
    'gemma-fast': 'gemma3:12b',          // Gemma 3 12B
    'phi-fast': 'phi4:latest',           // Phi-4
    'glm-4.7-flash': 'glm-4.7-flash:latest',
    'deepseek-think': 'deepseek-r1:32b', // DeepSeek R1 32B reasoning
    'qwq-think': 'qwq:32b',             // QwQ 32B reasoning
    'coder': 'qwen2.5-coder:32b',       // Best local coding model
    'gpt-oss': 'gpt-oss:latest',        // OpenAI open-source
    'llama4': 'llama4:scout',           // Llama 4 Scout MoE
    'doc-vision': 'granite3.2-vision:latest', // Document understanding
  };

  private resolveModel(model: string): string {
    return OllamaProvider.MODEL_MAPPING[model] || model;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const targetModel = this.resolveModel(options.model);
    const useThinking = !!options.thinking;

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
        ...(useThinking ? { think: true } : {}),
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
      message: { content: string; thinking?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content || '',
      tokensInput: data.prompt_eval_count || 0,
      tokensOutput: data.eval_count || 0,
      model: options.model,
      provider: 'ollama',
      toolCalls: (data as any).message?.tool_calls,
      thinkingContent: data.message?.thinking || undefined,
    };
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const startTime = Date.now();
    const targetModel = this.resolveModel(options.model);
    const useThinking = !!options.thinking;

    console.log(`[Ollama] Starting stream request: model=${targetModel} (orig=${options.model}), thinking=${useThinking}, timeout=${this.timeout}ms`);
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
          ...(useThinking ? { think: true } : {}),
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
      let isInThinking = false;
      let thinkingEmitted = false;

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
            const data = JSON.parse(line) as {
              message?: { content: string; thinking?: string };
              done: boolean;
              error?: string;
            };
            if (data.error) throw new Error(data.error);
            chunkCount++;

            if (chunkCount === 1) {
              console.log(`[Ollama] First chunk received after ${Date.now() - startTime}ms`);
            }

            // Handle thinking content from Ollama API (think: true)
            if (data.message?.thinking) {
              if (!isInThinking) {
                isInThinking = true;
              }
              thinkingEmitted = true;
              yield {
                content: '',
                done: false,
                thinking: data.message.thinking,
              };
              continue;
            }

            // Transition from thinking to content
            if (isInThinking && data.message?.content) {
              isInThinking = false;
              yield { content: '', done: false, thinkingDone: true };
            }

            if (data.message?.content) {
              totalContent += data.message.content;
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

      // If thinking was emitted but thinkingDone never sent (edge case: model only thinks, no content)
      if (thinkingEmitted && isInThinking) {
        yield { content: '', done: false, thinkingDone: true };
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
