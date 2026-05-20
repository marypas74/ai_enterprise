/**
 * ModelFetcher - Dynamically fetches available models from AI provider APIs
 *
 * Instead of relying on a static database list, this service queries
 * each provider's API to get the actual available models.
 */

import fetch from 'node-fetch';

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

interface ProviderConfig {
  type: string;
  apiKey: string;
  baseUrl?: string;
}

// Cache for models (5 minute TTL)
const modelsCache: Map<string, { models: AvailableModel[], timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch models from OpenAI API
 */
async function fetchOpenAIModels(apiKey: string): Promise<AvailableModel[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      console.error(`OpenAI API error: ${response.status}`);
      return [];
    }

    const data = await response.json() as { data: Array<{ id: string; owned_by: string }> };

    // Filter to only chat-capable models
    const chatModels = data.data.filter(m =>
      m.id.startsWith('gpt-') ||
      m.id.startsWith('o1') ||
      m.id.startsWith('o3') ||
      m.id.includes('turbo')
    );

    // Map to our format with friendly names
    return chatModels.map(m => ({
      id: m.id,
      name: getOpenAIModelName(m.id),
      provider: 'openai',
      description: m.owned_by
    })).sort((a, b) => getModelPriority(a.id) - getModelPriority(b.id));
  } catch (error) {
    console.error('Failed to fetch OpenAI models:', error);
    return [];
  }
}

/**
 * Fetch models from Anthropic API
 */
async function fetchAnthropicModels(apiKey: string): Promise<AvailableModel[]> {
  // Anthropic doesn't have a models list endpoint, so we use known models
  // and verify the API key works
  try {
    console.log('[ModelFetcher] Verifying Anthropic API key...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    });

    console.log(`[ModelFetcher] Anthropic API response status: ${response.status}`);

    // If we get 401, the key is invalid
    if (response.status === 401) {
      console.error('[ModelFetcher] Anthropic API key is invalid (401)');
      return [];
    }

    // Key is valid (any non-401 response means auth succeeded)
    // Return known Claude models (Updated Feb 2026)
    // IDs from https://platform.claude.com/docs/en/about-claude/models/overview
    return [
      // Latest generation (Claude 4.6)
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
      // Claude 4.5
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },
      { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic' },
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
      // Claude 4
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic' },
      // Legacy
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Legacy)', provider: 'anthropic' },
    ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (error: any) {
    console.error(`[ModelFetcher] Failed to verify Anthropic API: ${error.message}`);
    return [];
  }
}

/**
 * Fetch models from Google/Gemini API
 */
async function fetchGoogleModels(apiKey: string): Promise<AvailableModel[]> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    );

    if (!response.ok) {
      console.error(`Google API error: ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      models: Array<{ name: string; displayName: string; description: string }>
    };

    // Filter to generative models only
    return data.models
      .filter(m => m.name.includes('gemini'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', ''),
        provider: 'google',
        description: m.description
      }));
  } catch (error) {
    console.error('Failed to fetch Google models:', error);
    return [];
  }
}

/**
 * Fetch models from Ollama (local)
 */
async function fetchOllamaModels(baseUrl: string): Promise<AvailableModel[]> {
  try {
    const url = baseUrl || 'http://localhost:11434';
    const authKey = process.env.OLLAMA_AUTH_KEY || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authKey) headers['X-Ollama-Key'] = authKey;

    // Attempt Ollama-native tags endpoint first
    let response = await fetch(`${url}/api/tags`, { headers });

    if (response.ok) {
      const data = await response.json() as { models: Array<{ name: string; size: number }> };
      if (data.models && data.models.length > 0) {
        return data.models.map(m => ({
          id: m.name,
          name: m.name.split(':')[0].charAt(0).toUpperCase() + m.name.split(':')[0].slice(1),
          provider: 'ollama'
        }));
      }
    }

    // Fallback: Attempt OpenAI-compatible models endpoint (for proxies like LiteLLM)
    console.log(`[ModelFetcher] Ollama /api/tags failed or empty, trying /v1/models fallback at ${url}`);
    response = await fetch(`${url}/v1/models`, { headers });

    if (response.ok) {
      const data = await response.json() as { data: Array<{ id: string }> };
      return data.data.map(m => ({
        id: m.id,
        name: m.id.split(':')[0].charAt(0).toUpperCase() + m.id.split(':')[0].slice(1),
        provider: 'ollama' // Keep as ollama for backend compatibility
      }));
    }

    console.error(`Ollama/LiteLLM API error: ${response.status}`);
    return [];
  } catch (error) {
    console.error('Failed to fetch Ollama/LiteLLM models:', error);
    return [];
  }
}

/**
 * Get friendly name for OpenAI models
 */
function getOpenAIModelName(modelId: string): string {
  const names: Record<string, string> = {
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o-2024-11-20': 'GPT-4o (Nov 2024)',
    'gpt-4o-2024-08-06': 'GPT-4o (Aug 2024)',
    'gpt-4o-2024-05-13': 'GPT-4o (May 2024)',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gpt-4-turbo-preview': 'GPT-4 Turbo Preview',
    'gpt-4': 'GPT-4',
    'gpt-4-0613': 'GPT-4 (0613)',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    'gpt-3.5-turbo-0125': 'GPT-3.5 Turbo (0125)',
    'o1': 'o1 (Reasoning)',
    'o1-mini': 'o1 Mini',
    'o1-preview': 'o1 Preview',
    'o3-mini': 'o3 Mini',
  };
  return names[modelId] || modelId;
}

/**
 * Get priority for model sorting (lower = higher priority)
 */
function getModelPriority(modelId: string): number {
  if (modelId === 'gpt-4o') return 1;
  if (modelId === 'gpt-4o-mini') return 2;
  if (modelId.startsWith('o1') || modelId.startsWith('o3')) return 3;
  if (modelId.startsWith('gpt-4')) return 10;
  if (modelId.startsWith('gpt-3')) return 20;
  return 100;
}

/**
 * Main function to fetch all models from all configured providers
 */
export async function fetchAllModels(providers: ProviderConfig[]): Promise<AvailableModel[]> {
  const allModels: AvailableModel[] = [];

  const fetchPromises = providers.map(async (provider) => {
    const apiKey = provider.apiKey || 'no-key';
    const cacheKey = `${provider.type}-${apiKey.substring(0, 8)}`;
    const cached = modelsCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.models;
    }

    let models: AvailableModel[] = [];

    switch (provider.type) {
      case 'openai':
        models = await fetchOpenAIModels(provider.apiKey);
        break;
      case 'anthropic':
        models = await fetchAnthropicModels(provider.apiKey);
        break;
      case 'google':
        models = await fetchGoogleModels(provider.apiKey);
        break;
      case 'ollama':
        models = await fetchOllamaModels(provider.baseUrl || 'http://localhost:11434');
        break;
    }

    // Cache the results
    if (models.length > 0) {
      modelsCache.set(cacheKey, { models, timestamp: Date.now() });
    }

    return models;
  });

  const results = await Promise.all(fetchPromises);
  results.forEach(models => allModels.push(...models));

  return allModels;
}

/**
 * Clear the models cache (useful when provider settings change)
 */
export function clearModelsCache(): void {
  modelsCache.clear();
}
