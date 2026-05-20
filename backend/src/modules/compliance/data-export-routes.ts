import { FastifyInstance } from 'fastify';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import fs from 'fs/promises';
import path from 'path';
import { dataExportSchema, UserPayload, safeParseInt, getRealIp } from './utils.js';

// ── Background helper ────────────────────────────────────────────────
async function generateDataExport(fastify: FastifyInstance, userId: number, exportId: number, format: string): Promise<void> {
  // Helper: run a query safely, return fallback on error (e.g. missing table)
  const safeQuery = async <T>(queryFn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await queryFn(); } catch (err) {
      fastify.log.warn({ err }, `[AI-Act] Data export query failed (non-fatal), using fallback`);
      return fallback;
    }
  };

  try {
    await updateOne(fastify.db, `UPDATE data_export_requests SET status = 'processing' WHERE id = ?`, [exportId]);

    const [user, conversations, totalMsgCount, messages, consents, totalFeedbackCount, feedback, usage] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findOne<any>(fastify.db, `SELECT id, email, name, role, created_at, last_login_at FROM users WHERE id = ?`, [userId]), null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findMany<any>(fastify.db, `SELECT id, title, model, provider, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY created_at DESC`, [userId]), []),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db,
        `SELECT COUNT(*) as cnt FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user_id = ?`, [userId]), { cnt: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findMany<any>(fastify.db,
        `SELECT m.id, m.conversation_id, m.role, m.content, m.tokens_input, m.tokens_output, m.created_at
         FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user_id = ? ORDER BY m.created_at DESC LIMIT 50000`, [userId]), []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findMany<any>(fastify.db,
        `SELECT id, consent_type, granted, granted_at, revoked_at, created_at FROM user_consents WHERE user_id = ?`, [userId]), []),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db,
        `SELECT COUNT(*) as cnt FROM response_feedback WHERE user_id = ?`, [userId]), { cnt: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findMany<any>(fastify.db,
        `SELECT id, message_id, rating, category, comment, created_at FROM response_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50000`, [userId]), []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findMany<any>(fastify.db,
        `SELECT id, year_month, provider, total_tokens_input, total_tokens_output, request_count FROM monthly_usage WHERE user_id = ? ORDER BY year_month DESC`, [userId]), []),
    ]);

    const totalMessages = totalMsgCount?.cnt || 0;
    const totalFeedback = totalFeedbackCount?.cnt || 0;

    const exportData = {
      exported_at: new Date().toISOString(),
      gdpr_article: 'Art. 20 GDPR - Diritto alla portabilit\u00e0 dei dati',
      ai_act_ref: 'Reg. (UE) 2024/1689 - AI Act',
      data_completeness: {
        messages: { exported: messages.length, total: totalMessages, complete: messages.length >= totalMessages },
        feedback: { exported: feedback.length, total: totalFeedback, complete: feedback.length >= totalFeedback },
      },
      user,
      consents,
      conversations,
      messages,
      feedback,
      usage,
    };

    const storageRoot = process.env.STORAGE_ROOT || '/app/projects';
    const exportDir = path.join(storageRoot, 'exports');
    await fs.mkdir(exportDir, { recursive: true });

    const filePath = path.join(exportDir, `export-${userId}-${exportId}.json`);
    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');

    await updateOne(fastify.db,
      `UPDATE data_export_requests SET status = 'completed', file_path = ?, completed_at = NOW() WHERE id = ?`,
      [filePath, exportId]
    );

    fastify.log.info(`[AI-Act] Data export ${exportId} completed for user ${userId}`);
  } catch (err) {
    await updateOne(fastify.db, `UPDATE data_export_requests SET status = 'failed' WHERE id = ?`, [exportId]);
    throw err;
  }
}

// ── Plugin ───────────────────────────────────────────────────────────
export async function dataExportRoutes(fastify: FastifyInstance) {

  // ── POST /compliance/data-export ── (GAP-6: GDPR data export)
  fastify.post('/compliance/data-export', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = dataExportSchema.parse(request.body || {});

    // Check for pending export with row-level lock to prevent race condition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const conn = await (fastify.db as any).getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT id FROM data_export_requests WHERE user_id = ? AND status IN ('pending','processing') FOR UPDATE`,
        [user.id]
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      if ((rows as any[]).length > 0) {
        await conn.rollback();
        conn.release();
        return reply.status(409).send({ error: 'Una richiesta di export \u00e8 gi\u00e0 in corso.' });
      }

      const [result] = await conn.execute(
        `INSERT INTO data_export_requests (user_id, format, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
        [user.id, body.format]
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const exportId = (result as any).insertId;
      await conn.commit();
      conn.release();

      // Generate export in background
      generateDataExport(fastify, user.id, exportId, body.format).catch(err => {
        fastify.log.error({ err }, `[AI-Act] Data export ${exportId} failed`);
      });

      await insertOne(fastify.db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
        [user.id, 'data_export_requested', 'data_export', exportId, getRealIp(request)]
      );

      return { success: true, export_id: exportId, message: 'Export avviato. Sar\u00e0 disponibile a breve nelle impostazioni.' };
    } catch (txErr) {
      try { await conn.rollback(); conn.release(); } catch { /* ignore */ }
      throw txErr;
    }
  });

  // ── GET /compliance/data-export/:id ── (GAP-6: Download export)
  fastify.get('/compliance/data-export/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const { id } = request.params as { id: string };
    const exportId = safeParseInt(id, 0);
    if (exportId === 0) return reply.status(400).send({ error: 'ID non valido.' });

    const exportReq = await findOne<{ id: number; user_id: number; status: string; file_path: string; format: string }>(
      fastify.db,
      `SELECT id, user_id, status, file_path, format FROM data_export_requests WHERE id = ? AND user_id = ?`,
      [exportId, user.id]
    );

    if (!exportReq) return reply.status(404).send({ error: 'Export non trovato.' });
    if (exportReq.status !== 'completed') return reply.status(202).send({ status: exportReq.status, message: 'Export in elaborazione.' });

    // Security: validate path stays within exports directory (prevent path traversal)
    const storageRoot = process.env.STORAGE_ROOT || '/app/projects';
    const exportDir = path.resolve(storageRoot, 'exports');
    const resolvedPath = path.resolve(exportReq.file_path);
    if (!resolvedPath.startsWith(exportDir + path.sep)) {
      fastify.log.error(`[Security] Path traversal attempt in data export: ${exportReq.file_path}`);
      return reply.status(410).send({ error: 'File di export non disponibile.' });
    }

    try {
      const fileBuffer = await fs.readFile(resolvedPath);
      const contentType = exportReq.format === 'zip' ? 'application/zip' : 'application/json';
      const safeUserId = String(user.id).replace(/[^0-9]/g, '');
      const safeId = String(exportId).replace(/[^0-9]/g, '');
      const safeFormat = String(exportReq.format).replace(/[^a-z]/gi, '') || 'json';
      const filename = `data-export-${safeUserId}-${safeId}.${safeFormat}`;
      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(fileBuffer);
    } catch {
      return reply.status(410).send({ error: 'File di export scaduto o non disponibile.' });
    }
  });

  // ── GET /compliance/data-exports ── (GAP-6: List user exports)
  fastify.get('/compliance/data-exports', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const exports = await findMany<{ id: number; status: string; format: string; requested_at: string; completed_at: string | null }>(
      fastify.db,
      `SELECT id, status, format, requested_at, completed_at FROM data_export_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 10`,
      [user.id]
    );
    return { exports };
  });

  // ── DELETE /compliance/data-export/:id ── (Remove an export record)
  fastify.delete('/compliance/data-export/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const { id } = request.params as { id: string };
    const result = await updateOne(fastify.db,
      `DELETE FROM data_export_requests WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    if (result === 0) {
      return reply.status(404).send({ error: 'Export not found' });
    }
    return { message: 'Export record deleted' };
  });
}
