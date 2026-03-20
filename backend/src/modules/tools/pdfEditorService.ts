import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);
const SOFFICE_TIMEOUT = 180000; // 3 minutes — large documents can take 100+ seconds per soffice step

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
 * Convert OCR-extracted text (markdown-ish) to basic HTML for the TipTap editor.
 */
function ocrTextToHtml(text: string): string {
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
    // Markdown headers
    if (trimmed.startsWith('### ')) {
      htmlLines.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      htmlLines.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('# ')) {
      htmlLines.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      htmlLines.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
    } else if (/^\|/.test(trimmed)) {
      // Simple markdown table row — pass through as text for now
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

export function isScannedPdf(html: string): boolean {
  const textOnly = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return textOnly.length < 50;
}

async function runSoffice(args: readonly string[], tempDir: string, timeout: number = SOFFICE_TIMEOUT): Promise<void> {
  // Each conversion gets its own user profile to prevent parallel execution conflicts
  const profileDir = path.join(tempDir, '.soffice-profile');
  // Wrap execFile in a race with a hard timeout to prevent zombie processes from hanging forever
  const execPromise = execFileAsync('soffice', [
    `-env:UserInstallation=file://${profileDir}`,
    ...args,
  ], { timeout });

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      // Kill the child process if still running
      try {
        const child = (execPromise as any).child;
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      reject(new Error(`soffice timed out after ${timeout}ms`));
    }, timeout + 5000); // 5s grace period after execFile's own timeout
    // Prevent timer from keeping Node alive
    timer.unref();
  });

  await Promise.race([execPromise, timeoutPromise]);
}

export async function convertPdfToHtml(
  pdfPath: string,
  userId: number
): Promise<{ html: string; tempDir: string }> {
  await cleanupOldTempDirs();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-editor-${userId}-`));

  try {
    const pdfCopy = path.join(tempDir, 'input.pdf');
    await fs.copyFile(pdfPath, pdfCopy);

    // Use Ollama Vision OCR for ALL PDF conversion (no LibreOffice for PDF→HTML)
    console.log(`[PDFEditor] Converting PDF via Ollama Vision OCR for user ${userId}...`);
    const { VisionService } = await import('../../services/VisionService.js');
    const visionService = VisionService.getInstance();

    // Check Ollama availability before starting
    const available = await visionService.isAvailable();
    if (!available) {
      await fs.rm(tempDir, { recursive: true, force: true });
      const err = new Error('Ollama non è disponibile. Verifica che Ollama sia attivo con un modello vision (es. qwen2.5vl).');
      (err as Error & { statusCode: number }).statusCode = 503;
      throw err;
    }

    const pdfBuffer = await fs.readFile(pdfCopy);
    const ocrResult = await visionService.analyzeDocument(pdfBuffer, 'application/pdf');

    console.log(`[PDFEditor] Vision OCR completed: ${ocrResult.pages} pages, model=${ocrResult.model}`);

    // Convert OCR text (markdown) to HTML for the TipTap editor
    const html = ocrTextToHtml(ocrResult.text);

    // Write HTML for reference
    const htmlPath = path.join(tempDir, 'input.html');
    await fs.writeFile(htmlPath, html, 'utf-8');

    return { html, tempDir };
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
