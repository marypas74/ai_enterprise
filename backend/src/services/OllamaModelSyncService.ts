/**
 * OllamaModelSyncService - Syncs Ollama models via HTTP API
 *
 * Uses Ollama REST API (not CLI) so it works from K8s pods.
 * Supports auth header for proxied setups (X-Ollama-Key).
 */

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

export class OllamaModelSyncService {
  private baseUrl: string;
  private authKey: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.authKey = process.env.OLLAMA_AUTH_KEY || '';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authKey) headers['X-Ollama-Key'] = this.authKey;
    return headers;
  }

  /**
   * Get list of currently installed Ollama models
   */
  async getInstalledModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }
      const data = await response.json() as { models: OllamaModel[] };
      return data.models || [];
    } catch (error) {
      console.error('[OllamaSync] Failed to get installed models:', error);
      return [];
    }
  }

  /**
   * Get normalized names of installed models (without :latest suffix)
   */
  async getInstalledModelNames(): Promise<Set<string>> {
    const models = await this.getInstalledModels();
    const names = new Set<string>();
    for (const m of models) {
      names.add(m.name);
      names.add(m.name.replace(/:latest$/, ''));
      // Also add the base name without tag
      const baseName = m.name.split(':')[0];
      names.add(baseName);
    }
    return names;
  }

  /**
   * Check if a model is installed (handles aliases and tag variants)
   */
  async isModelInstalled(modelId: string): Promise<boolean> {
    const installedNames = await this.getInstalledModelNames();
    const normalized = modelId.replace(/:latest$/, '');
    return installedNames.has(modelId) || installedNames.has(normalized);
  }

  /**
   * Pull (download) a model from Ollama registry via HTTP API
   */
  async pullModel(modelId: string): Promise<{ success: boolean; message: string }> {
    if (!/^[a-zA-Z0-9.:_/-]+$/.test(modelId)) {
      return { success: false, message: 'Invalid model name' };
    }

    try {
      console.log(`[OllamaSync] Pulling model via API: ${modelId}`);

      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ name: modelId, stream: false }),
        signal: AbortSignal.timeout(600000) // 10 min
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      console.log(`[OllamaSync] Successfully pulled model: ${modelId}`);
      return { success: true, message: `Model ${modelId} pulled successfully` };
    } catch (error: any) {
      console.error(`[OllamaSync] Failed to pull model ${modelId}:`, error.message);
      return { success: false, message: error.message || 'Failed to pull model' };
    }
  }

  /**
   * Remove a model from Ollama via HTTP API
   */
  async removeModel(modelId: string): Promise<{ success: boolean; message: string }> {
    if (!/^[a-zA-Z0-9.:_/-]+$/.test(modelId)) {
      return { success: false, message: 'Invalid model name' };
    }

    try {
      console.log(`[OllamaSync] Removing model via API: ${modelId}`);

      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: this.getHeaders(),
        body: JSON.stringify({ name: modelId }),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      console.log(`[OllamaSync] Successfully removed model: ${modelId}`);
      return { success: true, message: `Model ${modelId} removed` };
    } catch (error: any) {
      console.error(`[OllamaSync] Failed to remove model ${modelId}:`, error.message);
      return { success: false, message: error.message || 'Failed to remove model' };
    }
  }

  /**
   * Sync a model based on its enabled state
   */
  async syncModel(modelId: string, isEnabled: boolean): Promise<{ success: boolean; message: string; action: 'pull' | 'remove' | 'none' }> {
    const isInstalled = await this.isModelInstalled(modelId);

    if (isEnabled && !isInstalled) {
      const result = await this.pullModel(modelId);
      return { ...result, action: 'pull' };
    }

    if (!isEnabled && isInstalled) {
      const result = await this.removeModel(modelId);
      return { ...result, action: 'remove' };
    }

    return {
      success: true,
      message: isEnabled ? `Model ${modelId} already installed` : `Model ${modelId} not installed`,
      action: 'none'
    };
  }

  /**
   * Check if Ollama service is reachable
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton
let ollamaServiceInstance: OllamaModelSyncService | null = null;

export function getOllamaModelSyncService(baseUrl?: string): OllamaModelSyncService {
  if (!ollamaServiceInstance || baseUrl) {
    ollamaServiceInstance = new OllamaModelSyncService(baseUrl);
  }
  return ollamaServiceInstance;
}
