/**
 * VLLMHealthService — Health checks and model listing for vLLM.
 *
 * Uses vLLM REST API (OpenAI-compatible endpoints).
 * No model pull/remove — models are managed via Docker container args.
 * Auth: X-Vllm-Key header (proxy) + Authorization Bearer (API key).
 */

export interface VLLMModel {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly owned_by: string;
}

export class VLLMHealthService {
  private readonly baseUrl: string;
  private readonly authKey: string;
  private readonly apiKey: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.VLLM_BASE_URL || 'http://localhost:8087/vllm';
    this.authKey = process.env.VLLM_AUTH_KEY || '';
    this.apiKey = process.env.VLLM_API_KEY || '';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authKey) headers['X-Vllm-Key'] = this.authKey;
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  private buildUrl(path: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    return `${base}/${path}`;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(this.buildUrl('health'), {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getServedModels(): Promise<VLLMModel[]> {
    try {
      const response = await fetch(this.buildUrl('models'), {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.error(`[VLLMHealth] Models endpoint error: ${response.status}`);
        return [];
      }

      const data = await response.json() as { data?: VLLMModel[] };
      return data.data || [];
    } catch (error) {
      console.error('[VLLMHealth] Failed to get served models:', error);
      return [];
    }
  }

  async getServedModelIds(): Promise<Set<string>> {
    const models = await this.getServedModels();
    return new Set(models.map(m => m.id));
  }
}

// Singleton
let instance: VLLMHealthService | null = null;

export function getVLLMHealthService(baseUrl?: string): VLLMHealthService {
  if (!instance || baseUrl) {
    instance = new VLLMHealthService(baseUrl);
  }
  return instance;
}
