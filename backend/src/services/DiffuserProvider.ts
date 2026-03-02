/**
 * DiffuserProvider — OllamaDiffuser image generation client.
 *
 * Calls the OllamaDiffuser REST API running as a Docker container on the host.
 * Accessible via nginx proxy at DIFFUSER_BASE_URL with header-based auth.
 */
import { promises as fsPromises } from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ImageGenerationOptions {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly numInferenceSteps?: number;
  readonly guidanceScale?: number;
  readonly seed?: number;
  readonly model?: string;
}

export interface ImageGenerationResult {
  readonly url: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly model: string;
  readonly seed: number;
  readonly generationTimeMs: number;
}

const DIFFUSER_BASE_URL = process.env.DIFFUSER_BASE_URL || 'http://10.0.1.1:8086/diffuser';
const DIFFUSER_AUTH_KEY = process.env.DIFFUSER_AUTH_KEY || process.env.OLLAMA_AUTH_KEY || '';
const GENERATED_DIR = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');

if (!DIFFUSER_AUTH_KEY) {
  console.warn('[DiffuserProvider] WARNING: DIFFUSER_AUTH_KEY not set. Image generation will fail auth.');
}

let generatedDirEnsured = false;

async function ensureGeneratedDir(): Promise<void> {
  if (!generatedDirEnsured) {
    await fsPromises.mkdir(GENERATED_DIR, { recursive: true });
    generatedDirEnsured = true;
  }
}

export async function generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const {
    prompt,
    negativePrompt,
    width = 1024,
    height = 1024,
    numInferenceSteps = 20,
    guidanceScale = 7.5,
    seed = Math.floor(Math.random() * 2147483647),
    model = 'flux.1-schnell',
  } = options;

  const startTime = Date.now();

  const requestBody = {
    prompt,
    negative_prompt: negativePrompt || '',
    width,
    height,
    num_inference_steps: numInferenceSteps,
    guidance_scale: guidanceScale,
    seed,
  };

  const response = await fetch(`${DIFFUSER_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ollama-Key': DIFFUSER_AUTH_KEY,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(300_000), // 5 min timeout
  });

  if (!response.ok) {
    const statusCode = response.status;
    // Log full error server-side, throw generic message
    const errorText = await response.text().catch(() => '');
    console.error(`[DiffuserProvider] Generation failed (${statusCode}): ${errorText}`);
    throw new Error(`Image generation failed (status ${statusCode})`);
  }

  // Response is PNG binary data
  const imageBuffer = Buffer.from(await response.arrayBuffer());

  // Save to generated directory with unique filename (async I/O)
  await ensureGeneratedDir();
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const filename = `img_${uniqueId}_${Date.now()}.png`;
  const filePath = path.join(GENERATED_DIR, filename);
  await fsPromises.writeFile(filePath, imageBuffer);

  const generationTimeMs = Date.now() - startTime;
  const downloadUrl = `/api/tools/download/${encodeURIComponent(filename)}`;

  return {
    url: downloadUrl,
    filename,
    width,
    height,
    model,
    seed,
    generationTimeMs,
  };
}

export async function isDiffuserHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${DIFFUSER_BASE_URL}/api/generate`, {
      method: 'HEAD',
      headers: { 'X-Ollama-Key': DIFFUSER_AUTH_KEY },
      signal: AbortSignal.timeout(5_000),
    });
    // Accept 200 or 405 (Method Not Allowed = server is alive)
    return response.ok || response.status === 405;
  } catch {
    return false;
  }
}
