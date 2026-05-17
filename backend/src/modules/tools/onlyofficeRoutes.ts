import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findOne, insertOne } from '../../database/index.js';

const execFileAsync = promisify(execFile);

async function extractPdfPlainText(pdfPath: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-nopgbrk', pdfPath, '-'],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    return stdout || '';
  } catch {
    return '';
  }
}

function summarizeDiff(originalText: string, draftText: string): string {
  const origLines = originalText.split(/\r?\n/).filter(l => l.trim().length > 0);
  const draftLines = draftText.split(/\r?\n/).filter(l => l.trim().length > 0);
  const origSet = new Set(origLines);
  const draftSet = new Set(draftLines);
  const added = draftLines.filter(l => !origSet.has(l));
  const removed = origLines.filter(l => !draftSet.has(l));
  const sample = (arr: string[], n = 3) =>
    arr.slice(0, n).map(l => `  • ${l.length > 120 ? l.substring(0, 117) + '...' : l}`).join('\n');
  let summary = `Bozza PDF salvata. Modifiche rilevate: +${added.length} righe, -${removed.length} righe`;
  if (added.length > 0) summary += `\nAggiunte (prime ${Math.min(3, added.length)}):\n${sample(added)}`;
  if (removed.length > 0) summary += `\nRimosse (prime ${Math.min(3, removed.length)}):\n${sample(removed)}`;
  if (added.length === 0 && removed.length === 0) summary = 'Bozza PDF salvata senza modifiche testuali rilevabili (es. solo annotazioni o formattazione).';
  return summary;
}
import {
  initOnlyOfficeRedis,
  createSession,
  getSession,
  updateSession,
  buildEditorConfig,
  downloadEditedFile,
  verifyOnlyOfficeJwt,
  getPublicUrl,
  isConfigured,
  PdfPreflightError,
  type SaveMode,
} from './onlyofficeService.js';

interface AttachmentRow {
  id: number;
  conversation_id: number;
  user_id: number;
  file_name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  content_type: string;
  processing_status: string;
  conv_user_id: number;
}

const sessionSchema = z.object({
  attachmentId: z.number().int().positive(),
  saveMode: z.enum(['draft', 'download']).optional().default('draft'),
});

const DOWNLOAD_TOKEN_TTL_SEC = 5 * 60;
const DOWNLOAD_TOKEN_PREFIX = 'oo_download_token:';

function makeDownloadToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export async function onlyofficeRoutes(fastify: FastifyInstance) {

  initOnlyOfficeRedis(fastify.redis);

  // POST /tools/pdf-editor/onlyoffice-session — create editing session
  fastify.post('/tools/pdf-editor/onlyoffice-session', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    if (!isConfigured()) {
      return reply.status(503).send({ error: 'OnlyOffice non configurato' });
    }

    const userId = (request as any).user.id;
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }

    const attachment = await findOne<AttachmentRow>(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       LEFT JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [parsed.data.attachmentId, userId, userId]
    );

    if (!attachment) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }
    if (attachment.mime_type !== 'application/pdf') {
      return reply.status(400).send({ error: 'Il file non è un PDF' });
    }

    const stat = await fs.stat(attachment.file_path).catch(() => null);
    if (!stat) {
      return reply.status(404).send({ error: 'File non trovato su disco' });
    }
    if (stat.size > 50 * 1024 * 1024) {
      return reply.status(413).send({ error: 'Il file è troppo grande (max 50MB)' });
    }

    try {
      const session = await createSession(
        attachment.id,
        userId,
        attachment.file_path,
        attachment.original_name,
        attachment.conversation_id,
        parsed.data.saveMode as SaveMode,
      );

      const backendInternalUrl = 'http://backend:3000';
      const editorConfig = buildEditorConfig(session, backendInternalUrl);

      return {
        editorConfig,
        publicUrl: getPublicUrl(),
        documentKey: session.documentKey,
        saveMode: session.saveMode,
        textChars: session.textChars,
      };
    } catch (err) {
      if (err instanceof PdfPreflightError) {
        fastify.log.warn(
          { attachmentId: attachment.id, code: err.code },
          `[OnlyOffice] Preflight fail: ${err.userMessage}`,
        );
        return reply.status(422).send({ error: err.userMessage, code: err.code });
      }
      fastify.log.error({ err, attachmentId: attachment.id }, '[OnlyOffice] createSession error');
      return reply.status(500).send({ error: 'Errore interno durante la creazione della sessione di editing' });
    }
  });

  // GET /tools/pdf-editor/document/:documentKey — serve PDF natively to OnlyOffice
  fastify.get('/tools/pdf-editor/document/:documentKey', async (request, reply) => {
    const rawKey = (request.params as { documentKey: string }).documentKey;
    const documentKey = rawKey.replace(/\.pdf$/, '').replace(/\.docx$/, '');

    // When OnlyOffice JWT is configured, REQUIRE a valid signed token on every
    // document fetch to prevent unauthenticated access via documentKey guessing.
    if (isConfigured()) {
      const authHeader = request.headers.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: 'Missing token' });
      }
      const token = authHeader.replace('Bearer ', '');
      try {
        verifyOnlyOfficeJwt(token);
      } catch {
        return reply.status(401).send({ error: 'Invalid token' });
      }
    }

    const session = await getSession(documentKey);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const fileStat = await fs.stat(session.filePath).catch(() => null);
    if (!fileStat) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const fileBuffer = await fs.readFile(session.filePath);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${session.originalName}"`)
      .header('Content-Length', fileStat.size)
      .send(fileBuffer);
  });

  // POST /tools/pdf-editor/onlyoffice-callback — receive save callback from OnlyOffice
  fastify.post('/tools/pdf-editor/onlyoffice-callback', {
    config: { requestTimeout: 120000 },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // SECURITY: When OnlyOffice JWT is configured, REQUIRE a valid signed token
    // on every callback. This prevents in-cluster spoofing of save events that
    // could trigger SSRF (via url payload) or DB injection of forged drafts.
    if (isConfigured()) {
      if (!body.token) {
        return reply.status(401).send({ error: 1 });
      }
      try {
        verifyOnlyOfficeJwt(body.token as string);
      } catch {
        return reply.status(401).send({ error: 1 });
      }
    }

    const status = body.status as number;
    const key = body.key as string;
    const url = body.url as string | undefined;

    fastify.log.info(`[OnlyOffice] Callback: key=${key}, status=${status}`);

    const session = await getSession(key);
    if (!session) {
      fastify.log.warn(`[OnlyOffice] Session not found for key: ${key}`);
      return { error: 0 };
    }

    // Status codes: 1=editing, 2=ready to save, 4=closed no changes, 6=force save, 7=force save error
    if ((status === 2 || status === 6) && url) {
      try {
        fastify.log.info(`[OnlyOffice] Downloading edited PDF from: ${url}`);
        const pdfBuffer = await downloadEditedFile(url);

        const baseName = path.basename(session.originalName, '.pdf');
        const dir = path.dirname(session.filePath);
        const ts = Date.now();

        if (session.saveMode === 'download') {
          // One-shot download: save to temp, register one-time signed token
          const tempPath = path.join(dir, `_oo_download_${session.documentKey}.pdf`);
          await fs.writeFile(tempPath, pdfBuffer);

          const token = makeDownloadToken();
          await fastify.redis.set(
            `${DOWNLOAD_TOKEN_PREFIX}${token}`,
            JSON.stringify({ path: tempPath, name: `${baseName}_modificato.pdf`, userId: session.userId }),
            'EX',
            DOWNLOAD_TOKEN_TTL_SEC,
          );

          await updateSession(key, {
            status: 'saved',
            downloadPath: tempPath,
            newFilename: `${baseName}_modificato.pdf`,
            newAttachmentId: -1, // sentinel: download mode
          } as any);

          // Stash token where the status endpoint can return it (reuse newFilename trick)
          await fastify.redis.set(
            `${DOWNLOAD_TOKEN_PREFIX}session:${key}`,
            token,
            'EX',
            DOWNLOAD_TOKEN_TTL_SEC,
          );

          fastify.log.info(`[OnlyOffice] Saved download mode: ${tempPath} (${pdfBuffer.length} bytes)`);
        } else {
          // Draft mode: persist as new chat_attachments row with is_draft=1, parent_attachment_id=original
          const newFileName = `${baseName}_draft_${ts}.pdf`;
          const newFilePath = path.join(dir, newFileName);
          await fs.writeFile(newFilePath, pdfBuffer);

          const newId = await insertOne(
            fastify.db,
            `INSERT INTO chat_attachments
             (conversation_id, user_id, file_name, original_name, file_path, file_size, mime_type, content_type, processing_status, parent_attachment_id, is_draft, draft_session_id)
             VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', 'document', 'completed', ?, TRUE, ?)`,
            [
              session.conversationId,
              session.userId,
              newFileName,
              `${baseName}_bozza.pdf`,
              newFilePath,
              pdfBuffer.length,
              session.attachmentId,
              session.documentKey,
            ],
          );

          await updateSession(key, {
            status: 'saved',
            newAttachmentId: newId,
            newFilename: `${baseName}_bozza.pdf`,
          } as any);

          // Awareness loop: extract text from original + draft, compute diff summary,
          // persist as system message in the conversation so subsequent AI turns are aware
          // of the changes without needing to re-read the PDF.
          try {
            const [origText, draftText] = await Promise.all([
              extractPdfPlainText(session.filePath),
              extractPdfPlainText(newFilePath),
            ]);
            const summary = summarizeDiff(origText, draftText);
            await fastify.db.execute(
              `UPDATE chat_attachments SET processed_content = ?, processing_status = 'completed', processed_at = NOW() WHERE id = ?`,
              [draftText.substring(0, 1_000_000), newId],
            );
            await insertOne(fastify.db,
              `INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider)
               VALUES (?, 'system', ?, FALSE, 'pdf-editor-diff', 'system')`,
              [session.conversationId, summary],
            );
            fastify.log.info(`[OnlyOffice] Diff awareness injected for conversation ${session.conversationId}`);
          } catch (diffErr) {
            fastify.log.warn({ err: diffErr }, '[OnlyOffice] Diff awareness injection failed (non-fatal)');
          }

          fastify.log.info(`[OnlyOffice] Saved draft: ${newFileName} (${pdfBuffer.length} bytes, attachmentId=${newId})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error({ err }, `[OnlyOffice] Failed to save edited file: ${msg}`);
        await updateSession(key, { status: 'error' } as any);
      }
    }

    return { error: 0 };
  });

  // GET /tools/pdf-editor/onlyoffice-session/:documentKey/status — check save status
  fastify.get('/tools/pdf-editor/onlyoffice-session/:documentKey/status', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const { documentKey } = request.params as { documentKey: string };

    const session = await getSession(documentKey);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    let downloadToken: string | null = null;
    if (session.saveMode === 'download' && session.status === 'saved') {
      downloadToken = await fastify.redis.get(`${DOWNLOAD_TOKEN_PREFIX}session:${documentKey}`);
    }

    return {
      status: session.status,
      saveMode: session.saveMode,
      newAttachmentId: session.newAttachmentId,
      newFilename: session.newFilename,
      downloadToken,
    };
  });

  // GET /tools/pdf-editor/drafts/:parentId — list draft versions of a PDF attachment
  fastify.get('/tools/pdf-editor/drafts/:parentId', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const parentId = Number((request.params as { parentId: string }).parentId);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return reply.status(400).send({ error: 'parentId non valido' });
    }
    const { findMany } = await import('../../database/index.js');
    const drafts = await findMany<{ id: number; original_name: string; file_size: number; created_at: Date; draft_session_id: string | null }>(
      fastify.db,
      `SELECT id, original_name, file_size, created_at, draft_session_id
       FROM chat_attachments
       WHERE parent_attachment_id = ? AND user_id = ? AND is_draft = TRUE
       ORDER BY created_at DESC`,
      [parentId, userId],
    );
    return { parentId, drafts };
  });

  // GET /tools/pdf-editor/download/:token — one-shot signed download
  fastify.get('/tools/pdf-editor/download/:token', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const { token } = request.params as { token: string };
    const raw = await fastify.redis.get(`${DOWNLOAD_TOKEN_PREFIX}${token}`);
    if (!raw) {
      return reply.status(404).send({ error: 'Token scaduto o invalido' });
    }
    const meta = JSON.parse(raw) as { path: string; name: string; userId: number };
    if (meta.userId !== userId) {
      return reply.status(403).send({ error: 'Token non valido per questo utente' });
    }
    const buf = await fs.readFile(meta.path).catch(() => null);
    if (!buf) {
      return reply.status(404).send({ error: 'File non trovato' });
    }
    // Token is one-shot
    await fastify.redis.del(`${DOWNLOAD_TOKEN_PREFIX}${token}`);
    fs.unlink(meta.path).catch(() => {});
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${meta.name}"`)
      .send(buf);
  });
}
