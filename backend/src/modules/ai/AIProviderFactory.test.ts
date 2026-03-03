import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all providers as proper classes (they get `new`-ed in the factory)
vi.mock('./providers/OpenAIProvider.js', () => ({
  OpenAIProvider: class { name = 'openai'; constructor(_c?: any) {} }
}));
vi.mock('./providers/AnthropicProvider.js', () => ({
  AnthropicProvider: class { name = 'anthropic'; constructor(_c?: any) {} }
}));
vi.mock('./providers/GoogleProvider.js', () => ({
  GoogleProvider: class { name = 'google'; constructor(_c?: any) {} }
}));
vi.mock('./providers/OllamaProvider.js', () => ({
  OllamaProvider: class { name = 'ollama'; constructor(_c?: any) {} }
}));
vi.mock('./providers/CustomProvider.js', () => ({
  CustomProvider: class { name = 'custom'; constructor(_c?: any) {} }
}));
vi.mock('./providers/VLLMProvider.js', () => ({
  VLLMProvider: class { name = 'vllm'; constructor(_c?: any) {} }
}));

import { AIProviderFactory } from './AIProviderFactory.js';

describe('AIProviderFactory', () => {
  beforeEach(() => {
    AIProviderFactory.clearProviders();
  });

  describe('getProviderName', () => {
    it('should route OpenAI models to openai', () => {
      expect(AIProviderFactory.getProviderName('gpt-4o')).toBe('openai');
      expect(AIProviderFactory.getProviderName('o1-mini')).toBe('openai');
      expect(AIProviderFactory.getProviderName('o3-mini')).toBe('openai');
    });

    it('should route Claude models to anthropic', () => {
      expect(AIProviderFactory.getProviderName('claude-sonnet-4-6')).toBe('anthropic');
    });

    it('should route Gemini models to google', () => {
      expect(AIProviderFactory.getProviderName('gemini-2.0-flash')).toBe('google');
    });

    it('should route Ollama models to ollama', () => {
      expect(AIProviderFactory.getProviderName('qwen3:14b')).toBe('ollama');
      expect(AIProviderFactory.getProviderName('llama4:scout')).toBe('ollama');
      expect(AIProviderFactory.getProviderName('deepseek-r1:32b')).toBe('ollama');
      expect(AIProviderFactory.getProviderName('phi4:latest')).toBe('ollama');
      expect(AIProviderFactory.getProviderName('gemma3:12b')).toBe('ollama');
      expect(AIProviderFactory.getProviderName('bge-m3:latest')).toBe('ollama');
    });

    it('should route HuggingFace format models (with /) to vllm', () => {
      expect(AIProviderFactory.getProviderName('Qwen/Qwen3-14B')).toBe('vllm');
      expect(AIProviderFactory.getProviderName('google/gemma-3-12b-it')).toBe('vllm');
      expect(AIProviderFactory.getProviderName('microsoft/phi-4')).toBe('vllm');
      expect(AIProviderFactory.getProviderName('deepseek-ai/DeepSeek-R1-Distill-Qwen-14B')).toBe('vllm');
      expect(AIProviderFactory.getProviderName('BAAI/bge-m3')).toBe('vllm');
    });

    it('should route vllm: prefixed models to vllm', () => {
      expect(AIProviderFactory.getProviderName('vllm:custom-model')).toBe('vllm');
    });

    it('should NOT route Ollama models with : to vllm', () => {
      // Models like 'qwen3:14b' contain : but not / — should still be Ollama
      expect(AIProviderFactory.getProviderName('qwen3:14b')).toBe('ollama');
      expect(AIProviderFactory.getProviderName('mixtral:latest')).toBe('ollama');
    });

    it('should fallback unknown models to custom', () => {
      expect(AIProviderFactory.getProviderName('some-unknown-model')).toBe('custom');
    });
  });

  describe('getProvider', () => {
    it('should create VLLMProvider for HuggingFace model IDs', () => {
      AIProviderFactory.setProviderConfig('vllm', {
        baseUrl: 'http://test:8087/vllm',
        apiKey: 'test-key'
      });

      const provider = AIProviderFactory.getProvider('Qwen/Qwen3-14B');
      expect(provider.name).toBe('vllm');
    });

    it('should cache provider instances', () => {
      AIProviderFactory.setProviderConfig('vllm', {
        baseUrl: 'http://test:8087/vllm',
        apiKey: 'test-key'
      });

      const p1 = AIProviderFactory.getProvider('Qwen/Qwen3-14B');
      const p2 = AIProviderFactory.getProvider('google/gemma-3-12b-it');
      expect(p1).toBe(p2); // Same provider instance for same type
    });

    it('should respect providerTypeOverride', () => {
      AIProviderFactory.setProviderConfig('vllm', {
        baseUrl: 'http://test:8087/vllm',
        apiKey: 'test-key'
      });

      // Force vllm even for a model that would normally route to ollama
      const provider = AIProviderFactory.getProvider('qwen3:14b', 'vllm');
      expect(provider.name).toBe('vllm');
    });

    it('should clear cached provider when config changes', () => {
      AIProviderFactory.setProviderConfig('vllm', { baseUrl: 'http://old:8087' });
      const p1 = AIProviderFactory.getProvider('Qwen/Qwen3-14B');

      AIProviderFactory.setProviderConfig('vllm', { baseUrl: 'http://new:8087' });
      const p2 = AIProviderFactory.getProvider('Qwen/Qwen3-14B');

      expect(p1).not.toBe(p2); // New instance after config change
    });
  });
});
