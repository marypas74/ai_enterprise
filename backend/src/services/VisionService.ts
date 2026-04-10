/**
 * VisionService — Multimodal vision pipeline via Ollama
 *
 * Resolves the vision model dynamically:
 *   1. VISION_MODEL env var (explicit override)
 *   2. First enabled vision-capable Ollama model from ai_models table
 *   3. Fallback: llava:latest
 *
 * Supports:
 *   - analyzeUrl()      — screenshot + vision analysis of a web page
 *   - analyzeImage()    — vision analysis of any image buffer
 *   - analyzeDocument() — PDF/document OCR via vision model (better than Tesseract)
 */
import { BrowserService } from './BrowserService.js';
import { findOne } from '../database/index.js';
import type mysql from 'mysql2/promise';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// Cache resolved vision model for 5 minutes
let cachedVisionModel: { model: string; ts: number } | null = null;
let cachedOCRModel: { model: string; ts: number } | null = null;
const MODEL_CACHE_TTL = 5 * 60 * 1000;

export interface VisionAnalysis {
  description: string;
  url: string;
  model: string;
  screenshotSize: number;
}

export interface DocumentOCRResult {
  text: string;
  model: string;
  pages: number;
  method: 'vision-ocr';
}

export class VisionService {
  private static instance: VisionService | null = null;
  private db: mysql.Pool | null = null;

  static getInstance(): VisionService {
    if (!VisionService.instance) {
      VisionService.instance = new VisionService();
    }
    return VisionService.instance;
  }

  /** Set the DB pool for dynamic model resolution */
  setDb(db: mysql.Pool): void {
    this.db = db;
  }

  /**
   * Resolve the vision model dynamically:
   * env override > DB vision model > fallback
   */
  private async resolveVisionModel(): Promise<string> {
    const envModel = process.env.VISION_MODEL;
    if (envModel) return envModel;

    if (cachedVisionModel && Date.now() - cachedVisionModel.ts < MODEL_CACHE_TTL) {
      return cachedVisionModel.model;
    }

    if (this.db) {
      try {
        // Prefer vision-capable models, ordered by context window desc (bigger = better for vision)
        const row = await findOne<any>(this.db,
          `SELECT m.model_id FROM ai_models m
           JOIN ai_providers p ON m.provider_id = p.id
           WHERE p.name = 'ollama' AND m.is_enabled = TRUE AND m.supports_vision = TRUE
           ORDER BY m.context_window DESC, m.sort_order ASC
           LIMIT 1`,
        );
        if (row?.model_id) {
          cachedVisionModel = { model: row.model_id, ts: Date.now() };
          return row.model_id;
        }
      } catch {
        // DB query failed, fall through
      }
    }

    return 'qwen2.5vl:7b';
  }

  /**
   * Resolve the OCR model dynamically:
   * OCR_MODEL env > DB models with 'ocr' in name > vision model fallback
   */
  private async resolveOCRModel(): Promise<string> {
    const envModel = process.env.OCR_MODEL;
    if (envModel) return envModel;

    if (cachedOCRModel && Date.now() - cachedOCRModel.ts < MODEL_CACHE_TTL) {
      return cachedOCRModel.model;
    }

    if (this.db) {
      try {
        // Prefer OCR-specialized models (name contains 'ocr')
        const row = await findOne<any>(this.db,
          `SELECT m.model_id FROM ai_models m
           JOIN ai_providers p ON m.provider_id = p.id
           WHERE p.name = 'ollama' AND m.is_enabled = TRUE AND m.supports_vision = TRUE
             AND (m.model_id LIKE '%ocr%' OR m.name LIKE '%ocr%')
           ORDER BY m.context_window ASC, m.sort_order ASC
           LIMIT 1`,
        );
        if (row?.model_id) {
          cachedOCRModel = { model: row.model_id, ts: Date.now() };
          return row.model_id;
        }
      } catch {
        // fall through
      }
    }

    // Fallback to general vision model
    return this.resolveVisionModel();
  }

  /**
   * Take a screenshot of a URL and analyze it with a vision model
   */
  async analyzeUrl(url: string, prompt?: string): Promise<VisionAnalysis> {
    const browser = BrowserService.getInstance();
    const available = await browser.isAvailable();
    if (!available) {
      throw new Error('Browser service is not available for screenshot capture');
    }

    const screenshot = await browser.takeScreenshot(url, { fullPage: false });
    return this.analyzeImage(screenshot, url, prompt);
  }

  /**
   * Analyze a screenshot buffer with the vision model
   */
  async analyzeImage(imageBuffer: Buffer, sourceUrl: string, prompt?: string): Promise<VisionAnalysis> {
    const model = await this.resolveVisionModel();
    const base64Image = imageBuffer.toString('base64');
    const analysisPrompt = prompt || 'Describe this web page screenshot in detail. What is the page about? What are the main elements, text, and visual components?';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authKey = process.env.OLLAMA_AUTH_KEY || '';
    if (authKey) headers['X-Ollama-Key'] = authKey;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        prompt: analysisPrompt,
        images: [base64Image],
        stream: false,
        options: {
          num_predict: 512,
          temperature: 0.3,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Vision model request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const description = (data.response || '').trim();

    if (!description) {
      throw new Error('Vision model returned empty response');
    }

    return {
      description,
      url: sourceUrl,
      model,
      screenshotSize: imageBuffer.length,
    };
  }

  /**
   * Analyze a PDF or document image using a vision-OCR model.
   * Converts PDF pages to images via pdftoppm, then sends each page
   * to the OCR vision model for high-quality text extraction.
   *
   * This is significantly better than Tesseract for complex layouts,
   * tables, mixed languages, and handwritten text.
   */
  async analyzeDocument(buffer: Buffer, mimeType: string = 'application/pdf'): Promise<DocumentOCRResult> {
    const model = await this.resolveOCRModel();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authKey = process.env.OLLAMA_AUTH_KEY || '';
    if (authKey) headers['X-Ollama-Key'] = authKey;

    // For images, analyze directly
    if (mimeType.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      const text = await this.ocrPage(base64, model, headers);
      return { text, model, pages: 1, method: 'vision-ocr' };
    }

    // For PDFs, convert to images first
    if (mimeType === 'application/pdf') {
      const crypto = await import('crypto');
      const os = await import('os');
      const fs = await import('fs/promises');
      const path = await import('path');
      const { promisify } = await import('util');
      const { execFile: execFileCb } = await import('child_process');
      const execFileAsync = promisify(execFileCb);

      const tmpId = crypto.randomBytes(8).toString('hex');
      const tmpDir = path.join(os.tmpdir(), `vision_ocr_${tmpId}`);
      const tmpPdf = path.join(tmpDir, 'input.pdf');

      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(tmpPdf, buffer);

      try {
        // Convert PDF to images at 300 DPI (use execFile to avoid shell injection)
        await execFileAsync('pdftoppm', ['-png', '-r', '300', tmpPdf, path.join(tmpDir, 'page')], { timeout: 120000 });

        const files = await fs.readdir(tmpDir);
        const pageImages = files.filter(f => f.startsWith('page-') && f.endsWith('.png')).sort();

        if (pageImages.length === 0) {
          throw new Error('pdftoppm produced no page images');
        }

        console.log(`[VisionOCR] Processing ${pageImages.length} pages with model ${model}`);

        // Process pages sequentially to avoid overloading Ollama
        const pageTexts: string[] = [];
        for (let i = 0; i < pageImages.length; i++) {
          const imgBuffer = await fs.readFile(path.join(tmpDir, pageImages[i]));
          const base64 = imgBuffer.toString('base64');
          console.log(`[VisionOCR] Processing page ${i + 1}/${pageImages.length}`);
          const text = await this.ocrPage(base64, model, headers);
          pageTexts.push(text);
        }

        const fullText = pageTexts.join('\n\n--- Page Break ---\n\n');
        return { text: fullText, model, pages: pageImages.length, method: 'vision-ocr' };
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    throw new Error(`Unsupported mime type for vision OCR: ${mimeType}`);
  }

  /**
   * Send a single page image to the OCR model
   */
  private async ocrPage(base64Image: string, model: string, headers: Record<string, string>): Promise<string> {
    const prompt = `Extract ALL text from this document image. Preserve the original structure, including:
- Headers and titles
- Paragraphs and body text
- Tables (format as markdown tables)
- Lists and bullet points
- Captions and footnotes
Output ONLY the extracted text, no commentary.`;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        prompt,
        images: [base64Image],
        stream: false,
        options: {
          num_predict: 4096,
          temperature: 0.0,
        },
      }),
      signal: AbortSignal.timeout(120000), // 2 min per page
    });

    if (!response.ok) {
      throw new Error(`Vision OCR request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return (data.response || '').trim();
  }

  /**
   * Check if any vision model is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      const authKey = process.env.OLLAMA_AUTH_KEY || '';
      if (authKey) headers['X-Ollama-Key'] = authKey;

      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;

      const data = await response.json() as any;
      const models = (data.models || []).map((m: any) => m.name);
      // Check for any known vision/OCR model
      return models.some((name: string) =>
        name.startsWith('llava') ||
        name.includes('vision') ||
        name.includes('ocr') ||
        name.includes('minicpm') ||
        name.includes('qwen2.5vl')
      );
    } catch {
      return false;
    }
  }
}
