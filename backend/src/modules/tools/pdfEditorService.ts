import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);
const SOFFICE_TIMEOUT = 180000;
const MAX_OCR_PAGES = 30;
const OCR_MAX_RETRIES = 3;
const OCR_BASE_DELAY_MS = 2000;
const MIN_TEXT_CHARS = 50; // Below this, PDF is considered scanned/image-only

export async function cleanupOldTempDirs(maxAgeMs: number = 1800000): Promise<void> {
  const tmpBase = os.tmpdir();
  try {
    const entries = await fs.readdir(tmpBase);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith('pdf-editor-')) continue;
      const fullPath = path.join(tmpBase, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && (now - stat.mtimeMs) > maxAgeMs) {
          await fs.rm(fullPath, { recursive: true, force: true });
        }
      } catch {
        /* skip entries that disappear between readdir and stat */
      }
    }
  } catch {
    /* skip if tmpdir is unreadable */
  }
}

/**
 * Convert plain text to basic HTML for the TipTap editor.
 * Handles markdown-ish formatting from OCR or raw PDF text.
 */
function textToHtml(text: string): string {
  const lines = text.split('\n');
  const htmlLines: string[] = ['<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      htmlLines.push('<br>');
      continue;
    }
    if (trimmed === '--- Page Break ---') {
      htmlLines.push('<hr>');
      continue;
    }
    if (trimmed.startsWith('### ')) {
      htmlLines.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      htmlLines.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('# ')) {
      htmlLines.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      htmlLines.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
    } else if (/^\|/.test(trimmed)) {
      htmlLines.push(`<p>${escapeHtml(trimmed)}</p>`);
    } else {
      htmlLines.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }

  htmlLines.push('</body></html>');
  return htmlLines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function runSoffice(args: readonly string[], tempDir: string, timeout: number = SOFFICE_TIMEOUT): Promise<void> {
  const profileDir = path.join(tempDir, '.soffice-profile');
  const execPromise = execFileAsync('soffice', [
    `-env:UserInstallation=file://${profileDir}`,
    ...args,
  ], { timeout });

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      try {
        const child = (execPromise as any).child;
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      reject(new Error(`soffice timed out after ${timeout}ms`));
    }, timeout + 5000);
    timer.unref();
  });

  await Promise.race([execPromise, timeoutPromise]);
}

async function countPdfPages(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { timeout: 10000 });
    const match = stdout.match(/Pages:\s+(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Extract text from PDF using pdf-parse (works for native/text PDFs).
 * Returns null if extraction fails or yields too little text.
 */
async function extractTextWithPdfParse(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const result = await parser.getText();
    const text = (result.text || '').trim();
    await parser.destroy().catch(() => {});
    if (text.length < MIN_TEXT_CHARS) {
      return null; // Too little text — likely a scanned PDF
    }
    return text;
  } catch (err) {
    console.error('[PDFEditor] pdf-parse extraction failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Try Vision OCR via Ollama with exponential backoff retry.
 * Returns null if all attempts fail.
 */
async function extractTextWithVisionOCR(
  pdfBuffer: Buffer,
  userId: number
): Promise<{ text: string; model: string; pages: number } | null> {
  const { VisionService } = await import('../../services/VisionService.js');
  const visionService = VisionService.getInstance();

  const available = await visionService.isAvailable();
  if (!available) {
    console.warn('[PDFEditor] Ollama Vision OCR non disponibile, skip');
    return null;
  }

  for (let attempt = 1; attempt <= OCR_MAX_RETRIES; attempt++) {
    try {
      console.log(`[PDFEditor] Vision OCR attempt ${attempt}/${OCR_MAX_RETRIES} for user ${userId}`);
      const result = await visionService.analyzeDocument(pdfBuffer, 'application/pdf');
      if ((result.text || '').trim().length >= MIN_TEXT_CHARS) {
        return { text: result.text, model: result.model, pages: result.pages };
      }
      console.warn(`[PDFEditor] Vision OCR returned insufficient text (${result.text.length} chars)`);
      return null; // No point retrying if model returned empty
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PDFEditor] Vision OCR attempt ${attempt} failed: ${msg}`);
      if (attempt < OCR_MAX_RETRIES) {
        const delay = OCR_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[PDFEditor] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return null;
}

/**
 * Convert PDF to editable HTML.
 *
 * Strategy:
 *   1. Try pdf-parse (instant, works for native/text PDFs)
 *   2. If pdf-parse yields little text → try Vision OCR via Ollama (with retry)
 *   3. If both fail → return error with specific cause
 */
export async function convertPdfToHtml(
  pdfPath: string,
  userId: number
): Promise<{ html: string; tempDir: string; method: string }> {
  await cleanupOldTempDirs();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-editor-${userId}-`));

  try {
    const pdfCopy = path.join(tempDir, 'input.pdf');
    await fs.copyFile(pdfPath, pdfCopy);
    const pdfBuffer = await fs.readFile(pdfCopy);

    // Check page count for OCR limit
    const pageCount = await countPdfPages(pdfCopy);
    console.log(`[PDFEditor] PDF has ${pageCount || '?'} pages for user ${userId}`);

    // --- Step 1: Try pdf-parse (instant, native text PDFs) ---
    console.log(`[PDFEditor] Trying pdf-parse for user ${userId}...`);
    const parsedText = await extractTextWithPdfParse(pdfBuffer);
    if (parsedText) {
      console.log(`[PDFEditor] pdf-parse succeeded: ${parsedText.length} chars`);
      const html = textToHtml(parsedText);
      await fs.writeFile(path.join(tempDir, 'input.html'), html, 'utf-8');
      return { html, tempDir, method: 'pdf-parse' };
    }

    // --- Step 2: Try Vision OCR (for scanned/image PDFs) ---
    if (pageCount > MAX_OCR_PAGES) {
      await fs.rm(tempDir, { recursive: true, force: true });
      const err = new Error(
        `Il PDF è un documento scannerizzato con ${pageCount} pagine. ` +
        `Il limite per la modifica OCR è di ${MAX_OCR_PAGES} pagine.`
      );
      (err as Error & { statusCode: number }).statusCode = 413;
      throw err;
    }

    console.log(`[PDFEditor] pdf-parse insufficiente, trying Vision OCR...`);
    const ocrResult = await extractTextWithVisionOCR(pdfBuffer, userId);
    if (ocrResult) {
      console.log(`[PDFEditor] Vision OCR completed: ${ocrResult.pages} pages, model=${ocrResult.model}`);
      const html = textToHtml(ocrResult.text);
      await fs.writeFile(path.join(tempDir, 'input.html'), html, 'utf-8');
      return { html, tempDir, method: 'vision-ocr' };
    }

    // --- Both methods failed ---
    await fs.rm(tempDir, { recursive: true, force: true });
    const err = new Error(
      'Impossibile estrarre testo dal PDF. ' +
      'Il documento potrebbe essere una scansione e il servizio OCR (Ollama) non è disponibile o è sovraccarico. ' +
      'Riprova tra qualche minuto.'
    );
    (err as Error & { statusCode: number }).statusCode = 422;
    throw err;
  } catch (error: unknown) {
    if (error instanceof Error && (error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Conversione PDF fallita: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function convertHtmlToPdf(
  html: string,
  userId: number
): Promise<{ pdfBuffer: Buffer; tempDir: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-editor-${userId}-`));

  try {
    const htmlPath = path.join(tempDir, 'edited.html');
    await fs.writeFile(htmlPath, html, 'utf-8');

    await runSoffice([
      '--headless',
      '--convert-to', 'docx',
      '--outdir', tempDir,
      htmlPath,
    ], tempDir);
    const docxPath = path.join(tempDir, 'edited.docx');
    await fs.access(docxPath);

    await runSoffice([
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tempDir,
      docxPath,
    ], tempDir);
    const pdfPath = path.join(tempDir, 'edited.pdf');
    await fs.access(pdfPath);

    const pdfBuffer = await fs.readFile(pdfPath);
    return { pdfBuffer, tempDir };
  } catch (error: unknown) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Conversione HTML-PDF fallita: ${error instanceof Error ? error.message : String(error)}`);
  }
}
