import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { FastifyInstance } from 'fastify';

const execFileAsync = promisify(execFile);

const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || '';
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'http://onlyoffice:80';
const ONLYOFFICE_PUBLIC_URL = process.env.ONLYOFFICE_PUBLIC_URL || '';

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const REDIS_KEY_PREFIX = 'oo_session:';
const MIN_CONVERTIBLE_TEXT_CHARS = 50;
const PDF_TO_DOCX_TIMEOUT_MS = 120000;
const PDFTOTEXT_TIMEOUT_MS = 15000;

export type PdfConversionErrorCode = 'NO_TEXT' | 'TIMEOUT' | 'SCRIPT_ERROR';

export class PdfConversionError extends Error {
  readonly code: PdfConversionErrorCode;
  readonly userMessage: string;

  constructor(code: PdfConversionErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'PdfConversionError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Extract textual content count from a PDF using pdftotext (poppler-utils).
 * Returns 0 on any failure — callers treat this as non-convertible PDF.
 */
export async function extractPdfText(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'pdftotext',
      ['-layout', '-nopgbrk', pdfPath, '-'],
      { timeout: PDFTOTEXT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim().length;
  } catch {
    return 0;
  }
}

/**
 * Decide whether a PDF has enough extractable text to justify a `pdf2docx`
 * round-trip. Image-only / scanned PDFs are rejected early so the frontend
 * falls back to the annotation viewer instead of hitting a 500.
 */
export async function isPdfConvertible(
  pdfPath: string,
  deps: { extract: (p: string) => Promise<number> } = { extract: extractPdfText },
): Promise<boolean> {
  try {
    const chars = await deps.extract(pdfPath);
    return chars >= MIN_CONVERTIBLE_TEXT_CHARS;
  } catch {
    return false;
  }
}

interface OnlyOfficeSession {
  readonly documentKey: string;
  readonly attachmentId: number;
  readonly userId: number;
  readonly filePath: string;
  readonly originalName: string;
  readonly conversationId: number;
  readonly createdAt: number;
  /** Path to the converted DOCX file used for editing */
  readonly docxPath: string;
  newAttachmentId?: number;
  newFilename?: string;
  status: 'editing' | 'saved' | 'error';
}

// Module-level reference to Fastify Redis client
let redisClient: FastifyInstance['redis'] | null = null;

/**
 * Initialize the OnlyOffice service with a Redis client for shared session storage.
 * Must be called once during route registration.
 */
export function initOnlyOfficeRedis(client: FastifyInstance['redis']): void {
  redisClient = client;
}

function getRedis(): FastifyInstance['redis'] {
  if (!redisClient) {
    throw new Error('OnlyOffice Redis not initialized. Call initOnlyOfficeRedis first.');
  }
  return redisClient;
}

export function signOnlyOfficeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, ONLYOFFICE_JWT_SECRET, { expiresIn: '24h' });
}

export function verifyOnlyOfficeJwt(token: string): Record<string, unknown> {
  return jwt.verify(token, ONLYOFFICE_JWT_SECRET) as Record<string, unknown>;
}

/**
 * Convert PDF to DOCX using PyMuPDF + python-docx script.
 * Returns the path to the generated DOCX file.
 *
 * Throws a typed {@link PdfConversionError} so callers can map failures to
 * user-visible HTTP responses instead of leaking generic 500s.
 */
export async function convertPdfToDocx(pdfPath: string, outputDir: string): Promise<string> {
  const baseName = path.basename(pdfPath, '.pdf');
  const expectedOutput = path.join(outputDir, `${baseName}.docx`);

  await fsPromises.unlink(expectedOutput).catch(() => {});

  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../../scripts/pdf_to_docx.py');

  try {
    await execFileAsync('python3', [scriptPath, pdfPath, expectedOutput], {
      timeout: PDF_TO_DOCX_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const anyErr = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
    const stderr = (anyErr.stderr || '').toString().trim();
    const killed = anyErr.killed || anyErr.signal === 'SIGTERM' || anyErr.signal === 'SIGKILL';
    const summary = stderr.split('\n').slice(-3).join(' | ') || anyErr.message;

    if (killed) {
      throw new PdfConversionError('TIMEOUT', 'Conversione PDF troppo lenta (timeout 120s)', err);
    }
    throw new PdfConversionError('SCRIPT_ERROR', `Conversione PDF fallita: ${summary}`, err);
  }

  try {
    await fsPromises.access(expectedOutput);
  } catch (err) {
    throw new PdfConversionError('SCRIPT_ERROR', 'Conversione PDF non ha prodotto output', err);
  }

  return expectedOutput;
}

/**
 * Convert DOCX to PDF using LibreOffice headless.
 * Returns the path to the generated PDF file.
 */
export async function convertDocxToPdf(docxPath: string, outputDir: string): Promise<string> {
  const baseName = path.basename(docxPath, '.docx');
  const expectedOutput = path.join(outputDir, `${baseName}.pdf`);

  await fsPromises.unlink(expectedOutput).catch(() => {});

  await execFileAsync('libreoffice', [
    '--headless',
    '--norestore',
    '--convert-to', 'pdf:writer_pdf_Export',
    '--outdir', outputDir,
    docxPath,
  ], { timeout: 120000 });

  await fsPromises.access(expectedOutput);
  return expectedOutput;
}

export async function createSession(
  attachmentId: number,
  userId: number,
  filePath: string,
  originalName: string,
  conversationId: number,
): Promise<OnlyOfficeSession> {
  const documentKey = `oo_${attachmentId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  // Reject image-based / scanned PDFs up-front so the frontend falls back to
  // the annotation viewer instead of hitting a generic 500.
  if (!(await isPdfConvertible(filePath))) {
    throw new PdfConversionError(
      'NO_TEXT',
      'Il PDF non contiene testo estraibile (scansione o immagine). L\'editor avanzato richiede un PDF testuale.',
    );
  }

  const dir = path.dirname(filePath);
  const tempDir = path.join(dir, `_oo_temp_${documentKey}`);
  await fsPromises.mkdir(tempDir, { recursive: true });

  try {
    const tempPdf = path.join(tempDir, 'source.pdf');
    await fsPromises.copyFile(filePath, tempPdf);

    const docxPath = await convertPdfToDocx(tempPdf, tempDir);

    await fsPromises.unlink(tempPdf).catch(() => {});

    const session: OnlyOfficeSession = {
      documentKey,
      attachmentId,
      userId,
      filePath,
      originalName,
      conversationId,
      createdAt: Date.now(),
      docxPath,
      status: 'editing',
    };

    await saveSession(session);
    return session;
  } catch (err) {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function saveSession(session: OnlyOfficeSession): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX}${session.documentKey}`;
  await redis.set(key, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
}

export async function getSession(documentKey: string): Promise<OnlyOfficeSession | undefined> {
  const redis = getRedis();
  const data = await redis.get(`${REDIS_KEY_PREFIX}${documentKey}`);
  if (!data) return undefined;
  return JSON.parse(data) as OnlyOfficeSession;
}

export async function updateSessionSaved(
  documentKey: string,
  newAttachmentId: number,
  newFilename: string,
): Promise<void> {
  const session = await getSession(documentKey);
  if (session) {
    const updated: OnlyOfficeSession = {
      ...session,
      status: 'saved',
      newAttachmentId,
      newFilename,
    };
    await saveSession(updated);
  }
}

export async function removeSession(documentKey: string): Promise<void> {
  const session = await getSession(documentKey);
  if (session) {
    // Clean up temp DOCX and its directory
    const dir = path.dirname(session.docxPath);
    fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {});
    const redis = getRedis();
    await redis.del(`${REDIS_KEY_PREFIX}${session.documentKey}`);
  }
}

export function buildEditorConfig(
  session: OnlyOfficeSession,
  backendBaseUrl: string,
): Record<string, unknown> {
  // Serve the DOCX file (not the original PDF) for full editing support
  const documentUrl = `${backendBaseUrl}/api/tools/pdf-editor/document/${session.documentKey}.docx`;
  const callbackUrl = `${backendBaseUrl}/api/tools/pdf-editor/onlyoffice-callback`;

  const editableName = session.originalName.replace(/\.pdf$/i, '.docx');

  const config: Record<string, unknown> = {
    document: {
      fileType: 'docx',
      key: session.documentKey,
      title: editableName,
      url: documentUrl,
      permissions: {
        edit: true,
        download: true,
        print: true,
        comment: true,
        fillForms: true,
        review: false,
      },
    },
    editorConfig: {
      callbackUrl,
      lang: 'it',
      mode: 'edit',
      customization: {
        autosave: false,
        forcesave: true,
        chat: false,
        compactHeader: true,
        compactToolbar: false,
        hideRightMenu: true,
        toolbarNoTabs: false,
      },
    },
    documentType: 'word',
    type: 'desktop',
    height: '100%',
    width: '100%',
  };

  // Sign the entire config as JWT token
  const token = signOnlyOfficeJwt(config);
  (config as Record<string, unknown>).token = token;

  return config;
}

export async function downloadEditedFile(downloadUrl: string): Promise<Buffer> {
  // OnlyOffice provides a URL relative to itself — resolve against internal URL
  const resolvedUrl = downloadUrl.startsWith('http')
    ? downloadUrl
    : `${ONLYOFFICE_URL}${downloadUrl}`;

  const response = await fetch(resolvedUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    throw new Error(`Failed to download edited file: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function getPublicUrl(): string {
  return ONLYOFFICE_PUBLIC_URL;
}

export function isConfigured(): boolean {
  return ONLYOFFICE_JWT_SECRET.length > 0 && ONLYOFFICE_PUBLIC_URL.length > 0;
}
