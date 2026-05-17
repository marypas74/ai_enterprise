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
const PDFTOTEXT_TIMEOUT_MS = 15000;
const MIN_TEXT_CHARS_FOR_NATIVE_EDIT = 1; // Native PDF editing supports image-only PDFs (annotation mode)

export type PdfPreflightErrorCode = 'TIMEOUT' | 'IO_ERROR';
export type SaveMode = 'draft' | 'download';

export class PdfPreflightError extends Error {
  readonly code: PdfPreflightErrorCode;
  readonly userMessage: string;

  constructor(code: PdfPreflightErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'PdfPreflightError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Extract textual content count from a PDF using pdftotext (poppler-utils).
 * Returns 0 on any failure — used only for diagnostics, no longer gates editing
 * since OnlyOffice 8.1+ supports native PDF editing of image-only PDFs.
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

interface OnlyOfficeSession {
  readonly documentKey: string;
  readonly attachmentId: number;
  readonly userId: number;
  /** Path to the source PDF — served directly to OnlyOffice for native editing */
  readonly filePath: string;
  readonly originalName: string;
  readonly conversationId: number;
  readonly createdAt: number;
  /** How saved edits are persisted: as draft (server) or one-shot download */
  readonly saveMode: SaveMode;
  /** Diagnostic: char count of extractable text (0 = image-only PDF) */
  readonly textChars: number;
  newAttachmentId?: number;
  newFilename?: string;
  /** Path to the temporary edited PDF when saveMode='download' */
  downloadPath?: string;
  status: 'editing' | 'saved' | 'error';
}

let redisClient: FastifyInstance['redis'] | null = null;

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
 * Whitelist of URL prefixes the backend is allowed to fetch as part of a callback.
 * OnlyOffice serves the edited file from its own internal hostname; any URL
 * outside this whitelist is rejected to prevent SSRF via callback payload.
 */
export function isAllowedDownloadUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, ONLYOFFICE_URL);
    const allowedHost = new URL(ONLYOFFICE_URL).host;
    return u.host === allowedHost && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

export async function createSession(
  attachmentId: number,
  userId: number,
  filePath: string,
  originalName: string,
  conversationId: number,
  saveMode: SaveMode = 'draft',
): Promise<OnlyOfficeSession> {
  const documentKey = `oo_${attachmentId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  // Diagnostic only: track whether the PDF has extractable text. Native PDF
  // editing handles image-only PDFs in annotation mode (no hard reject).
  const textChars = await extractPdfText(filePath).catch(() => 0);

  const session: OnlyOfficeSession = {
    documentKey,
    attachmentId,
    userId,
    filePath,
    originalName,
    conversationId,
    createdAt: Date.now(),
    saveMode,
    textChars,
    status: 'editing',
  };

  await saveSession(session);
  return session;
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

export async function updateSession(
  documentKey: string,
  patch: Partial<OnlyOfficeSession>,
): Promise<void> {
  const session = await getSession(documentKey);
  if (session) {
    const updated: OnlyOfficeSession = { ...session, ...patch } as OnlyOfficeSession;
    await saveSession(updated);
  }
}

export async function removeSession(documentKey: string): Promise<void> {
  const session = await getSession(documentKey);
  if (session) {
    if (session.downloadPath) {
      fsPromises.unlink(session.downloadPath).catch(() => {});
    }
    const redis = getRedis();
    await redis.del(`${REDIS_KEY_PREFIX}${session.documentKey}`);
  }
}

/**
 * Build the OnlyOffice editor configuration for native PDF editing.
 * No DOCX round-trip: OnlyOffice 8.1+ edits PDFs directly with full text,
 * page, and object manipulation when permissions.edit=true.
 */
export function buildEditorConfig(
  session: OnlyOfficeSession,
  backendBaseUrl: string,
): Record<string, unknown> {
  const documentUrl = `${backendBaseUrl}/api/tools/pdf-editor/document/${session.documentKey}.pdf`;
  const callbackUrl = `${backendBaseUrl}/api/tools/pdf-editor/onlyoffice-callback`;

  const config: Record<string, unknown> = {
    document: {
      fileType: 'pdf',
      key: session.documentKey,
      title: session.originalName,
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
    documentType: 'pdf',
    type: 'desktop',
    height: '100%',
    width: '100%',
  };

  const token = signOnlyOfficeJwt(config);
  (config as Record<string, unknown>).token = token;

  return config;
}

export async function downloadEditedFile(downloadUrl: string): Promise<Buffer> {
  if (!isAllowedDownloadUrl(downloadUrl)) {
    throw new Error(`Download URL not whitelisted: ${downloadUrl}`);
  }
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

/**
 * Detect intent to open the PDF editor from a chat message.
 * Returns true on common Italian/English phrasings.
 */
export function detectEditPdfIntent(message: string): boolean {
  if (!message) return false;
  return /\b(modifica|modific[ah][rl]?o?|edita|edit|apri\s+editor)\s+(il\s+|the\s+)?pdf\b/i.test(message);
}
