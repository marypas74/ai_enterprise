/**
 * OllamaVisionHelper — Lightweight helper for calling Ollama Vision models
 * from document processing services. Fails gracefully if Ollama is unavailable.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_AUTH_KEY = process.env.OLLAMA_AUTH_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'llava:latest';
const VISION_TIMEOUT_MS = 60000;

interface OllamaVisionResult {
  text: string;
  model: string;
  available: boolean;
}

/**
 * Check if Ollama Vision is reachable and has a vision model loaded.
 */
export async function isOllamaVisionAvailable(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (OLLAMA_AUTH_KEY) headers['X-Ollama-Key'] = OLLAMA_AUTH_KEY;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (data.models || []).map(m => m.name);

    return models.some(
      name =>
        name.startsWith('llava') ||
        name.includes('vision') ||
        name.includes('ocr') ||
        name.includes('minicpm') ||
        name.includes('qwen2.5vl'),
    );
  } catch {
    return false;
  }
}

/**
 * Send an image buffer to Ollama Vision with a prompt and return the text response.
 * Returns { text: '', model, available: false } if Ollama is not available.
 */
export async function analyzeImageWithVision(
  imageBuffer: Buffer,
  prompt: string,
): Promise<OllamaVisionResult> {
  const available = await isOllamaVisionAvailable();
  if (!available) {
    return { text: '', model: VISION_MODEL, available: false };
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (OLLAMA_AUTH_KEY) headers['X-Ollama-Key'] = OLLAMA_AUTH_KEY;

    const base64Image = imageBuffer.toString('base64');
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt,
        images: [base64Image],
        stream: false,
        options: { num_predict: 1024, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { text: '', model: VISION_MODEL, available: false };
    }

    const data = (await response.json()) as { response?: string };
    return {
      text: (data.response || '').trim(),
      model: VISION_MODEL,
      available: true,
    };
  } catch {
    return { text: '', model: VISION_MODEL, available: false };
  }
}