import type { AIProvider, ProviderConfig, ProviderType } from './types.js';
import { MODEL_PRICING } from './types.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { GoogleProvider } from './providers/GoogleProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';
import { VLLMProvider } from './providers/VLLMProvider.js';
import { CustomProvider } from './providers/CustomProvider.js';

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
        case 'vllm':
          this.providers.set(providerName, new VLLMProvider(config));
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
    // HuggingFace format (org/model) routes to vLLM
    if (model.includes('/')) return 'vllm';
    // Ollama: ONLY for vision and embedding models
    if (model.match(/^(minicpm-v|granite3\.2-vision|qwen2\.5vl|deepseek-ocr|glm-ocr)/i)) return 'ollama';
    if (model.match(/^(snowflake-arctic-embed|qwen3-embedding|nomic-embed|bge-m3)/i)) return 'ollama';
    // All local chat models route to vLLM (primary inference engine)
    if (model.match(/^(llama|llama4|mistral|mixtral|phi|phi4|qwen|qwq|gemma|deepseek|vicuna|orca|neural|dolphin|openhermes|starling|yi|solar|glm|glm4|glm-|minicpm|nomic|granite|magistral|kimi|gpt-oss|nemotron|translategemma|bge|coder)/i)) {
      return 'vllm';
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
