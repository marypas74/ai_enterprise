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
 */
export async function convertPdfToDocx(pdfPath: string, outputDir: string): Promise<string> {
  const baseName = path.basename(pdfPath, '.pdf');
  const expectedOutput = path.join(outputDir, `${baseName}.docx`);

  // Remove existing output to avoid conflicts
  await fsPromises.unlink(expectedOutput).catch(() => {});

  // Use custom Python script with PyMuPDF + python-docx for reliable conversion
  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../../scripts/pdf_to_docx.py');
  await execFileAsync('python3', [scriptPath, pdfPath, expectedOutput], { timeout: 120000 });

  // Verify output exists
  await fsPromises.access(expectedOutput);
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

  // Convert PDF to DOCX for full editing in OnlyOffice CE
  const dir = path.dirname(filePath);
  const tempDir = path.join(dir, `_oo_temp_${documentKey}`);
  await fsPromises.mkdir(tempDir, { recursive: true });

  // Copy PDF to temp dir with a clean name
  const tempPdf = path.join(tempDir, 'source.pdf');
  await fsPromises.copyFile(filePath, tempPdf);

  const docxPath = await convertPdfToDocx(tempPdf, tempDir);

  // Clean up temp PDF copy
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
