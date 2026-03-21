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
const MIN_TEXT_CHARS = 50;

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert plain text to basic HTML for the TipTap editor.
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
    } else {
      htmlLines.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }

  htmlLines.push('</body></html>');
  return htmlLines.join('\n');
}

/**
 * Run soffice with a unique profile dir and timeout protection.
 * Uses execFile (not exec) to prevent shell injection.
 */
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
 * Convert PDF to HTML using pdftohtml (poppler-utils).
 * Uses execFile to prevent shell injection.
 * Produces positional HTML which is then cleaned into semantic HTML for TipTap.
 */
async function convertWithPdftohtml(pdfPath: string, tempDir: string): Promise<string | null> {
  const outputPath = path.join(tempDir, 'pdftohtml-output.html');
  try {
    await execFileAsync('pdftohtml', [
      '-s',           // single HTML file
      '-noframes',    // no frames
      '-i',           // ignore images (cleaner output)
      '-enc', 'UTF-8',
      pdfPath,
      outputPath,
    ], { timeout: 60000 });

    const rawHtml = await fs.readFile(outputPath, 'utf-8');
    const cleaned = cleanPdftohtmlOutput(rawHtml);
    return cleaned;
  } catch (err) {
    console.warn(`[PDFEditor] pdftohtml failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Clean pdftohtml output into semantic HTML suitable for TipTap editor.
 * - Detects headings by font-size (>= 24px -> h1, >= 20px -> h2)
 * - Removes absolute positioning
 * - Cleans HTML entities
 * - Removes background page divs
 * - Strips Document Outline section
 */
function cleanPdftohtmlOutput(rawHtml: string): string {
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) return '';

  let body = bodyMatch[1];

  // Remove Document Outline section at the end
  body = body.replace(/<a\s+name="outline"[\s\S]*$/i, '');
  body = body.replace(/<hr\s*\/?>\s*$/i, '');

  // Extract font-size classes from style blocks
  const fontSizeMap = new Map<string, number>();
  const styleRegex = /\.(ft\d+)\{[^}]*font-size:(\d+)px[^}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = styleRegex.exec(rawHtml)) !== null) {
    fontSizeMap.set(match[1], parseInt(match[2], 10));
  }

  // Process paragraphs: convert to semantic HTML
  const outputLines: string[] = ['<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'];
  let lastWasPageBreak = false;

  // Split by page divs
  const pageRegex = /<div\s+id="page\d+-div"[^>]*>([\s\S]*?)<\/div>/gi;
  let pageMatch: RegExpExecArray | null;
  let pageNum = 0;

  while ((pageMatch = pageRegex.exec(body)) !== null) {
    pageNum++;
    if (pageNum > 1 && !lastWasPageBreak) {
      outputLines.push('<hr>');
      lastWasPageBreak = true;
    }

    const pageContent = pageMatch[1];

    // Extract paragraphs with their classes
    const pRegex = /<p[^>]*class="(ft\d+)"[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRegex.exec(pageContent)) !== null) {
      const cssClass = pMatch[1];
      const rawContent = pMatch[2];

      // Check if content has mixed bold + non-bold parts (e.g. "<b>Heading</b>text")
      const hasBoldTag = rawContent.includes('<b>');
      const boldParts = rawContent.match(/<b>([\s\S]*?)<\/b>/gi);
      const hasNonBoldText = rawContent.replace(/<b>[\s\S]*?<\/b>/gi, '').replace(/<[^>]*>/g, '').replace(/&#160;/g, ' ').replace(/&nbsp;/g, ' ').trim().length > 0;

      // If mixed bold + text, split into heading + paragraph
      if (hasBoldTag && hasNonBoldText && boldParts) {
        lastWasPageBreak = false;
        for (const bp of boldParts) {
          const boldText = bp.replace(/<\/?b>/gi, '').replace(/&#160;/g, ' ').replace(/&nbsp;/g, ' ').replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim();
          if (boldText) {
            const fontSize = fontSizeMap.get(cssClass) || 0;
            if (fontSize >= 24) {
              outputLines.push(`<h1>${escapeHtml(boldText)}</h1>`);
            } else if (fontSize >= 20) {
              outputLines.push(`<h2>${escapeHtml(boldText)}</h2>`);
            } else {
              outputLines.push(`<h3>${escapeHtml(boldText)}</h3>`);
            }
          }
        }
        const nonBoldText = rawContent
          .replace(/<b>[\s\S]*?<\/b>/gi, '')
          .replace(/&#160;/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (nonBoldText) {
          const lines = nonBoldText.split('\n').filter(l => l.trim());
          for (const line of lines) {
            outputLines.push(`<p>${escapeHtml(line.trim())}</p>`);
          }
        }
        continue;
      }

      // Standard case: entire paragraph is one type
      let textContent = rawContent
        .replace(/&#160;/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?b>/gi, '')
        .replace(/<\/?i>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!textContent) continue;
      lastWasPageBreak = false;

      const fontSize = fontSizeMap.get(cssClass) || 0;

      // Determine element type based on font-size
      if (fontSize >= 24) {
        outputLines.push(`<h1>${escapeHtml(textContent)}</h1>`);
      } else if (fontSize >= 20 || (fontSize >= 16 && hasBoldTag)) {
        outputLines.push(`<h2>${escapeHtml(textContent)}</h2>`);
      } else if (hasBoldTag && textContent.length < 100) {
        outputLines.push(`<h3>${escapeHtml(textContent)}</h3>`);
      } else {
        const lines = textContent.split('\n').filter(l => l.trim());
        for (const line of lines) {
          outputLines.push(`<p>${escapeHtml(line.trim())}</p>`);
        }
      }
    }
  }

  // If no page divs found, fall back to extracting all text
  if (pageNum === 0) {
    const allText = body
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#160;/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (allText.length >= MIN_TEXT_CHARS) {
      outputLines.push(`<p>${escapeHtml(allText)}</p>`);
    }
  }

  outputLines.push('</body></html>');

  // Check we got meaningful content
  const totalText = outputLines.join('').replace(/<[^>]*>/g, '').trim();
  if (totalText.length < MIN_TEXT_CHARS) return '';

  return outputLines.join('\n');
}

/**
 * Try Vision OCR via Ollama with exponential backoff retry.
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
      return null;
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
 * Strategy (ordered by quality):
 *   1. pdftohtml (poppler-utils) — best text fidelity, semantic heading detection
 *   2. pdf-parse — fast text extraction for native PDFs
 *   3. Vision OCR via Ollama — for scanned/image-only PDFs
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

    const pageCount = await countPdfPages(pdfCopy);
    console.log(`[PDFEditor] PDF has ${pageCount || '?'} pages for user ${userId}`);

    // --- Step 1: Try pdftohtml (poppler-utils) ---
    console.log(`[PDFEditor] Trying pdftohtml for user ${userId}...`);
    const pdftohtmlResult = await convertWithPdftohtml(pdfCopy, tempDir);
    if (pdftohtmlResult) {
      const textLen = pdftohtmlResult.replace(/<[^>]*>/g, '').trim().length;
      console.log(`[PDFEditor] pdftohtml succeeded: ${textLen} chars of text`);
      await fs.writeFile(path.join(tempDir, 'input.html'), pdftohtmlResult, 'utf-8');
      return { html: pdftohtmlResult, tempDir, method: 'pdftohtml' };
    }

    // --- Step 2: Try pdf-parse (text extraction for native PDFs) ---
    console.log(`[PDFEditor] Trying pdf-parse for user ${userId}...`);
    try {
      const pdfBuffer = await fs.readFile(pdfCopy);
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
      const result = await parser.getText();
      const text = (result.text || '').trim();
      await parser.destroy().catch(() => {});
      if (text.length >= MIN_TEXT_CHARS) {
        console.log(`[PDFEditor] pdf-parse succeeded: ${text.length} chars`);
        const html = textToHtml(text);
        await fs.writeFile(path.join(tempDir, 'input.html'), html, 'utf-8');
        return { html, tempDir, method: 'pdf-parse' };
      }
      console.log(`[PDFEditor] pdf-parse yielded insufficient text (${text.length} chars)`);
    } catch (parseErr) {
      console.warn(`[PDFEditor] pdf-parse failed: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
    }

    // --- Step 3: Try Vision OCR (for scanned/image PDFs) ---
    if (pageCount > MAX_OCR_PAGES) {
      await fs.rm(tempDir, { recursive: true, force: true });
      const err = new Error(
        `Il PDF è un documento scannerizzato con ${pageCount} pagine. ` +
        `Il limite per la modifica OCR è di ${MAX_OCR_PAGES} pagine.`
      );
      (err as Error & { statusCode: number }).statusCode = 413;
      throw err;
    }

    console.log(`[PDFEditor] Trying Vision OCR for user ${userId}...`);
    const pdfBuffer = await fs.readFile(pdfCopy);
    const ocrResult = await extractTextWithVisionOCR(pdfBuffer, userId);
    if (ocrResult) {
      console.log(`[PDFEditor] Vision OCR completed: ${ocrResult.pages} pages, model=${ocrResult.model}`);
      const html = textToHtml(ocrResult.text);
      await fs.writeFile(path.join(tempDir, 'input.html'), html, 'utf-8');
      return { html, tempDir, method: 'vision-ocr' };
    }

    // --- All methods failed ---
    await fs.rm(tempDir, { recursive: true, force: true });
    const err = new Error(
      'Impossibile estrarre testo dal PDF. ' +
      'Il documento potrebbe essere una scansione non leggibile o un formato non supportato. ' +
      'Prova con un PDF diverso.'
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

/**
 * Convert HTML to PDF.
 * Uses LibreOffice Writer for direct HTML -> PDF conversion (no intermediate DOCX).
 */
export async function convertHtmlToPdf(
  html: string,
  userId: number
): Promise<{ pdfBuffer: Buffer; tempDir: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-editor-${userId}-`));

  try {
    const htmlPath = path.join(tempDir, 'edited.html');
    await fs.writeFile(htmlPath, html, 'utf-8');

    // Direct HTML -> PDF via LibreOffice Writer (no intermediate DOCX needed)
    await runSoffice([
      '--headless',
      '--convert-to', 'pdf:writer_pdf_Export',
      '--outdir', tempDir,
      htmlPath,
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
