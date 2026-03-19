import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);
const SOFFICE_TIMEOUT = 60000;

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

export function isScannedPdf(html: string): boolean {
  const textOnly = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return textOnly.length < 50;
}

async function runSoffice(args: readonly string[], timeout: number = SOFFICE_TIMEOUT): Promise<void> {
  await execFileAsync('soffice', [...args], { timeout });
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

    await runSoffice([
      '--headless',
      '--infilter=writer_pdf_import',
      '--convert-to', 'docx',
      '--outdir', tempDir,
      pdfCopy,
    ]);
    const docxPath = path.join(tempDir, 'input.docx');
    await fs.access(docxPath);

    await runSoffice([
      '--headless',
      '--convert-to', 'html',
      '--outdir', tempDir,
      docxPath,
    ]);
    const htmlPath = path.join(tempDir, 'input.html');
    await fs.access(htmlPath);

    let html = await fs.readFile(htmlPath, 'utf-8');

    const imgRegex = /src="([^"]+)"/g;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const imgSrc = match[1];
      if (imgSrc.startsWith('data:')) continue;
      const imgPath = path.resolve(tempDir, imgSrc);
      try {
        const imgBuffer = await fs.readFile(imgPath);
        const ext = path.extname(imgPath).slice(1) || 'png';
        const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        html = html.replace(imgSrc, `data:${mimeType};base64,${imgBuffer.toString('base64')}`);
      } catch {
        /* skip images that cannot be read */
      }
    }

    if (isScannedPdf(html)) {
      await fs.rm(tempDir, { recursive: true, force: true });
      const err = new Error('Il PDF sembra essere una scansione e non contiene testo editabile');
      (err as Error & { statusCode: number }).statusCode = 422;
      throw err;
    }

    return { html, tempDir };
  } catch (error: unknown) {
    if (error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 422) {
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
    ]);
    const docxPath = path.join(tempDir, 'edited.docx');
    await fs.access(docxPath);

    await runSoffice([
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tempDir,
      docxPath,
    ]);
    const pdfPath = path.join(tempDir, 'edited.pdf');
    await fs.access(pdfPath);

    const pdfBuffer = await fs.readFile(pdfPath);
    return { pdfBuffer, tempDir };
  } catch (error: unknown) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Conversione HTML-PDF fallita: ${error instanceof Error ? error.message : String(error)}`);
  }
}
