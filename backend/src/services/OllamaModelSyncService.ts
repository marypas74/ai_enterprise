/**
 * OllamaModelSyncService - Automatically syncs Ollama models based on admin settings
 *
 * When a model is enabled in the admin console, this service pulls it from Ollama.
 * When a model is disabled, this service removes it from Ollama.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export class OllamaModelSyncService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  /**
   * Get list of currently installed Ollama models
   */
  async getInstalledModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }
      const data = await response.json() as { models: OllamaModel[] };
      return data.models || [];
    } catch (error) {
      console.error('Failed to get installed Ollama models:', error);
      return [];
    }
  }

  /**
   * Check if a model is installed
   */
  async isModelInstalled(modelId: string): Promise<boolean> {
    const models = await this.getInstalledModels();
    // Normalize model names (remove :latest suffix for comparison)
    const normalizedModelId = modelId.replace(/:latest$/, '');
    return models.some(m => {
      const normalizedName = m.name.replace(/:latest$/, '');
      return normalizedName === normalizedModelId || m.name === modelId;
    });
  }

  /**
   * Pull (download) a model from Ollama registry
   */
  async pullModel(modelId: string): Promise<{ success: boolean; message: string }> {
    // Validate model name (alphanumeric, dots, colons, hyphens, underscores only)
    if (!/^[a-zA-Z0-9.:_-]+$/.test(modelId)) {
      return { success: false, message: 'Invalid model name' };
    }

    try {
      console.log(`[OllamaSync] Pulling model: ${modelId}`);

      // Use ollama CLI directly (not Docker)
      await execFileAsync('ollama', ['pull', modelId], { timeout: 600000 }); // 10 min timeout

      console.log(`[OllamaSync] Successfully pulled model: ${modelId}`);
      return { success: true, message: `Model ${modelId} pulled successfully` };
    } catch (error: any) {
      console.error(`[OllamaSync] Failed to pull model ${modelId}:`, error);
      return { success: false, message: error.message || 'Failed to pull model' };
    }
  }

  /**
   * Remove a model from Ollama
   */
  async removeModel(modelId: string): Promise<{ success: boolean; message: string }> {
    // Validate model name
    if (!/^[a-zA-Z0-9.:_-]+$/.test(modelId)) {
      return { success: false, message: 'Invalid model name' };
    }

    try {
      console.log(`[OllamaSync] Removing model: ${modelId}`);

      // Use ollama CLI directly
      await execFileAsync('ollama', ['rm', modelId], { timeout: 60000 }); // 1 min timeout

      console.log(`[OllamaSync] Successfully removed model: ${modelId}`);
      return { success: true, message: `Model ${modelId} removed successfully` };
    } catch (error: any) {
      console.error(`[OllamaSync] Failed to remove model ${modelId}:`, error);
      return { success: false, message: error.message || 'Failed to remove model' };
    }
  }

  /**
   * Sync a model based on its enabled state
   * - If enabled and not installed -> pull
   * - If disabled and installed -> remove
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

    // No action needed
    return {
      success: true,
      message: isEnabled
        ? `Model ${modelId} is already installed`
        : `Model ${modelId} is not installed`,
      action: 'none'
    };
  }

  /**
   * Check if Ollama service is running
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let ollamaServiceInstance: OllamaModelSyncService | null = null;

export function getOllamaModelSyncService(baseUrl?: string): OllamaModelSyncService {
  if (!ollamaServiceInstance) {
    ollamaServiceInstance = new OllamaModelSyncService(baseUrl);
  }
  return ollamaServiceInstance;
}
