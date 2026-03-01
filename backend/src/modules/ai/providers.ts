// Barrel re-export file for backward compatibility.
// All types, interfaces, providers, and the factory are split into separate modules.
// Import from this file continues to work for all existing consumers.

export type {
  ProviderType,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
  ProviderConfig,
  AIProvider,
} from './types.js';

export { MODEL_PRICING, calculateCost } from './types.js';

export { OpenAIProvider } from './providers/OpenAIProvider.js';
export { AnthropicProvider } from './providers/AnthropicProvider.js';
export { GoogleProvider } from './providers/GoogleProvider.js';
export { OllamaProvider } from './providers/OllamaProvider.js';
export { CustomProvider } from './providers/CustomProvider.js';

export { AIProviderFactory } from './AIProviderFactory.js';
