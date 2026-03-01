import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// ── Schemas ──────────────────────────────────────────────────────────
const consentSchema = z.object({
  consent_type: z.enum(['ai_disclosure', 'data_processing', 'terms_of_service', 'cookie']),
  granted: z.boolean(),
});

const feedbackSchema = z.object({
  message_id: z.number(),
  rating: z.union([z.literal(-1), z.literal(1)]),
  category: z.enum(['accurate', 'inaccurate', 'harmful', 'biased', 'helpful', 'other']).optional(),
  comment: z.string().max(1000).optional(),
});

const dataExportSchema = z.object({
  format: z.enum(['json']).default('json'),
});

const deleteAccountSchema = z.object({
  reason: z.string().max(500).optional(),
});

const modelDocsUpdateSchema = z.object({
  knowledge_cutoff: z.string().max(20).optional(),
  limitations: z.string().max(2000).optional(),
  bias_notes: z.string().max(2000).optional(),
  safety_rating: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
  documentation_url: z.string().url().max(500).optional(),
});

// ── Types ────────────────────────────────────────────────────────────
interface UserPayload {
  id: number;
  role: string;
  sid?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────
function safeParseInt(value: string | undefined, defaultVal: number, max?: number): number {
  const parsed = parseInt(value || String(defaultVal), 10);
  const safe = isNaN(parsed) || parsed < 0 ? defaultVal : parsed;
  return max !== undefined ? Math.min(safe, max) : safe;
}

/** Get real client IP behind Cloudflare Tunnel (which sets CF-Connecting-IP). */
function getRealIp(request: FastifyRequest): string {
  const cfIp = request.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.length > 0) return cfIp;
  return request.ip;
}

// ── Plugin ───────────────────────────────────────────────────────────
export async function complianceRoutes(fastify: FastifyInstance) {

  // ═══════════════════════════════════════════════════════════════════
  // USER ENDPOINTS (authenticated)
  // ═══════════════════════════════════════════════════════════════════

  // ── GET /compliance/disclosure ── (GAP-1: Art. 50 disclosure info)
  fastify.get('/compliance/disclosure', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const settings = await findMany<{ setting_key: string; setting_value: string }>(
      fastify.db,
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('ai_disclosure_banner_text', 'ai_disclosure_banner_enabled', 'ai_content_labeling_enabled', 'feedback_enabled')`
    );
    const settingMap = new Map(settings.map(s => [s.setting_key, s.setting_value]));

    return {
      banner_text: settingMap.get('ai_disclosure_banner_text') || 'Stai interagendo con un sistema di intelligenza artificiale.',
      banner_enabled: settingMap.get('ai_disclosure_banner_enabled') === 'true',
      labeling_enabled: settingMap.get('ai_content_labeling_enabled') === 'true',
      feedback_enabled: settingMap.get('feedback_enabled') === 'true',
    };
  });

  // ── POST /compliance/consent ── (GAP-4: User consent)
  fastify.post('/compliance/consent', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = consentSchema.parse(request.body);

    await fastify.db.execute(
      `INSERT INTO user_consents (user_id, consent_type, granted, ip_address, user_agent, granted_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         granted = VALUES(granted),
         ip_address = VALUES(ip_address),
         user_agent = VALUES(user_agent),
         granted_at = CASE WHEN VALUES(granted) = TRUE THEN NOW() ELSE granted_at END,
         revoked_at = CASE WHEN VALUES(granted) = FALSE THEN NOW() ELSE NULL END`,
      [user.id, body.consent_type, body.granted, getRealIp(request), (request.headers['user-agent'] || '').slice(0, 512)]
    );

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, details, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [user.id, body.granted ? 'consent_granted' : 'consent_revoked', 'user_consent',
       JSON.stringify({ consent_type: body.consent_type }), getRealIp(request)]
    );

    return { success: true, consent_type: body.consent_type, granted: body.granted };
  });

  // ── GET /compliance/consent/status ── (GAP-4: Check consent status)
  fastify.get('/compliance/consent/status', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;

    const consents = await findMany<{
      consent_type: string;
      granted: boolean;
      granted_at: string | null;
      revoked_at: string | null;
    }>(
      fastify.db,
      `SELECT consent_type, granted, granted_at, revoked_at FROM user_consents WHERE user_id = ?`,
      [user.id]
    );

    const consentMap: Record<string, { granted: boolean; granted_at: string | null; revoked_at: string | null }> = {};
    for (const c of consents) {
      consentMap[c.consent_type] = { granted: !!c.granted, granted_at: c.granted_at, revoked_at: c.revoked_at };
    }

    const requiredTypes = ['ai_disclosure', 'data_processing', 'terms_of_service'];
    const allGranted = requiredTypes.every(t => consentMap[t]?.granted === true);

    return { consents: consentMap, all_required_granted: allGranted };
  });

  // ── POST /compliance/consent/revoke ── (GAP-4: Revoke consent)
  fastify.post('/compliance/consent/revoke', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = z.object({ consent_type: z.enum(['ai_disclosure', 'data_processing', 'terms_of_service', 'cookie']) }).parse(request.body);

    await updateOne(fastify.db,
      `UPDATE user_consents SET granted = FALSE, revoked_at = NOW() WHERE user_id = ? AND consent_type = ?`,
      [user.id, body.consent_type]
    );

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, details, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [user.id, 'consent_revoked', 'user_consent', JSON.stringify({ consent_type: body.consent_type }), getRealIp(request)]
    );

    return { success: true, consent_type: body.consent_type, granted: false };
  });

  // ── POST /compliance/feedback ── (GAP-9: User feedback on AI responses)
  fastify.post('/compliance/feedback', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = feedbackSchema.parse(request.body);

    // Verify message belongs to the user's conversation
    const messageOwned = await findOne<{ id: number }>(
      fastify.db,
      `SELECT m.id FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = ? AND c.user_id = ?`,
      [body.message_id, user.id]
    );
    if (!messageOwned) {
      return reply.status(404).send({ error: 'Messaggio non trovato.' });
    }

    try {
      await insertOne(fastify.db,
        `INSERT INTO response_feedback (message_id, user_id, rating, category, comment)
         VALUES (?, ?, ?, ?, ?)`,
        [body.message_id, user.id, body.rating, body.category || null, body.comment || null]
      );
      return { success: true };
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        await updateOne(fastify.db,
          `UPDATE response_feedback SET rating = ?, category = ?, comment = ? WHERE user_id = ? AND message_id = ?`,
          [body.rating, body.category || null, body.comment || null, user.id, body.message_id]
        );
        return { success: true, updated: true };
      }
      throw err;
    }
  });

  // ── GET /compliance/transparency ── (GAP-2/5: User transparency report)
  fastify.get('/compliance/transparency', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;

    const [usage, models, feedbackStats] = await Promise.all([
      findMany<{ provider: string; total_tokens_input: number; total_tokens_output: number; request_count: number }>(
        fastify.db,
        `SELECT provider, SUM(total_tokens_input) as total_tokens_input, SUM(total_tokens_output) as total_tokens_output, SUM(request_count) as request_count
         FROM monthly_usage WHERE user_id = ? GROUP BY provider`,
        [user.id]
      ),
      findMany<{ ai_model: string; ai_provider: string; cnt: number }>(
        fastify.db,
        `SELECT ai_model, ai_provider, COUNT(*) as cnt FROM ai_decision_log WHERE user_id = ? GROUP BY ai_model, ai_provider ORDER BY cnt DESC LIMIT 10`,
        [user.id]
      ),
      findOne<{ total: number; positive: number; negative: number }>(
        fastify.db,
        `SELECT COUNT(*) as total, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive, SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative
         FROM response_feedback WHERE user_id = ?`,
        [user.id]
      ),
    ]);

    return {
      usage_by_provider: usage,
      models_used: models,
      feedback: feedbackStats || { total: 0, positive: 0, negative: 0 },
    };
  });

  // ── POST /compliance/data-export ── (GAP-6: GDPR data export)
  fastify.post('/compliance/data-export', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = dataExportSchema.parse(request.body || {});

    // Check for pending export
    const pending = await findOne<{ id: number }>(
      fastify.db,
      `SELECT id FROM data_export_requests WHERE user_id = ? AND status IN ('pending','processing')`,
      [user.id]
    );
    if (pending) {
      return reply.status(409).send({ error: 'Una richiesta di export è già in corso.' });
    }

    const exportId = await insertOne(fastify.db,
      `INSERT INTO data_export_requests (user_id, format, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [user.id, body.format]
    );

    // Generate export in background
    generateDataExport(fastify, user.id, exportId, body.format).catch(err => {
      fastify.log.error({ err }, `[AI-Act] Data export ${exportId} failed`);
    });

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [user.id, 'data_export_requested', 'data_export', exportId, getRealIp(request)]
    );

    return { success: true, export_id: exportId, message: 'Export avviato. Sarà disponibile a breve nelle impostazioni.' };
  });

  // ── GET /compliance/data-export/:id ── (GAP-6: Download export)
  fastify.get('/compliance/data-export/:id', {
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

  // ── POST /compliance/delete-account ── (GAP-7: Request account deletion)
  fastify.post('/compliance/delete-account', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = deleteAccountSchema.parse(request.body || {});

    const existing = await findOne<{ id: number; status: string }>(
      fastify.db,
      `SELECT id, status FROM account_deletion_requests WHERE user_id = ? AND status IN ('pending','confirmed')`,
      [user.id]
    );
    if (existing) {
      return reply.status(409).send({ error: 'Richiesta di cancellazione già presente.', request_id: existing.id, status: existing.status });
    }

    const graceDays = await findOne<{ setting_value: string }>(
      fastify.db,
      `SELECT setting_value FROM system_settings WHERE setting_key = 'account_deletion_grace_days'`
    );
    const days = Math.max(1, safeParseInt(graceDays?.setting_value, 30, 365));

    const requestId = await insertOne(fastify.db,
      `INSERT INTO account_deletion_requests (user_id, reason, confirm_by) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [user.id, body.reason || null, days]
    );

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [user.id, 'account_deletion_requested', 'account_deletion', requestId, getRealIp(request)]
    );

    return { success: true, request_id: requestId, confirm_by_days: days, message: `Account verrà eliminato tra ${days} giorni. Puoi annullare in qualsiasi momento.` };
  });

  // ── POST /compliance/delete-account/confirm ── (GAP-7: Confirm deletion)
  fastify.post('/compliance/delete-account/confirm', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;

    const req = await findOne<{ id: number }>(
      fastify.db,
      `SELECT id FROM account_deletion_requests WHERE user_id = ? AND status = 'pending'`,
      [user.id]
    );
    if (!req) return reply.status(404).send({ error: 'Nessuna richiesta di cancellazione trovata.' });

    await updateOne(fastify.db,
      `UPDATE account_deletion_requests SET status = 'confirmed' WHERE id = ?`,
      [req.id]
    );

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [user.id, 'account_deletion_confirmed', 'account_deletion', req.id, getRealIp(request)]
    );

    return { success: true, message: 'Cancellazione confermata. L\'account verrà eliminato al termine del periodo di grazia.' };
  });

  // ── POST /compliance/delete-account/cancel ── (GAP-7: Cancel deletion)
  fastify.post('/compliance/delete-account/cancel', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;

    const affected = await updateOne(fastify.db,
      `UPDATE account_deletion_requests SET status = 'cancelled' WHERE user_id = ? AND status IN ('pending','confirmed')`,
      [user.id]
    );

    if (affected === 0) return reply.status(404).send({ error: 'Nessuna richiesta di cancellazione attiva.' });

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, details, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [user.id, 'account_deletion_cancelled', 'account_deletion', '{}', getRealIp(request)]
    );

    return { success: true, message: 'Richiesta di cancellazione annullata.' };
  });

  // ── GET /compliance/models ── (GAP-8: Model documentation for users)
  fastify.get('/compliance/models', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const models = await findMany<{
      id: number; model_id: string; display_name: string; provider_id: number;
      context_window: number; knowledge_cutoff: string | null; limitations: string | null;
      bias_notes: string | null; safety_rating: string | null; documentation_url: string | null;
    }>(
      fastify.db,
      `SELECT m.id, m.model_id, m.display_name, m.provider_id, m.context_window,
              m.knowledge_cutoff, m.limitations, m.bias_notes, m.safety_rating, m.documentation_url,
              p.display_name as provider_name
       FROM ai_models m
       LEFT JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE
       ORDER BY p.display_name, m.display_name`
    );
    return { models };
  });

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════

  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as UserPayload;
    if (user.role !== 'admin') {
      reply.code(403);
      throw new Error('Accesso riservato agli amministratori.');
    }
  };

  // ── GET /admin/compliance/dashboard ──
  fastify.get('/admin/compliance/dashboard', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {

    const [
      totalUsers,
      usersWithAllConsents,
      totalDecisions,
      totalFeedback,
      pendingExports,
      pendingDeletions,
      latestBias,
    ] = await Promise.all([
      findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM users WHERE is_active = TRUE`),
      findOne<{ cnt: number }>(fastify.db,
        `SELECT COUNT(*) as cnt FROM (
           SELECT user_id FROM user_consents
           WHERE granted = TRUE AND consent_type IN ('ai_disclosure','data_processing','terms_of_service')
           GROUP BY user_id HAVING COUNT(DISTINCT consent_type) = 3
         ) AS fully_consented`
      ),
      findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM ai_decision_log`),
      findOne<{ total: number; positive: number; negative: number }>(fastify.db,
        `SELECT COUNT(*) as total, SUM(CASE WHEN rating=1 THEN 1 ELSE 0 END) as positive, SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END) as negative FROM response_feedback`
      ),
      findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM data_export_requests WHERE status IN ('pending','processing')`),
      findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM account_deletion_requests WHERE status IN ('pending','confirmed')`),
      findMany<any>(fastify.db,
        `SELECT id, period_start, period_end, ai_model, ai_provider, total_requests,
                refusal_count, error_count, avg_latency_ms, negative_feedback_count,
                positive_feedback_count, flagged_content_count, created_at
         FROM bias_monitoring_log ORDER BY period_end DESC LIMIT 5`
      ),
    ]);

    return {
      users: { total: totalUsers?.cnt || 0, with_all_consents: usersWithAllConsents?.cnt || 0 },
      ai_decisions: { total: totalDecisions?.cnt || 0 },
      feedback: totalFeedback || { total: 0, positive: 0, negative: 0 },
      pending_exports: pendingExports?.cnt || 0,
      pending_deletions: pendingDeletions?.cnt || 0,
      latest_bias_reports: latestBias,
    };
  });

  // ── GET /admin/compliance/consent-audit ── (GAP-4)
  fastify.get('/admin/compliance/consent-audit', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    const consents = await findMany<any>(fastify.db,
      `SELECT uc.id, uc.user_id, uc.consent_type, uc.granted, uc.ip_address,
              uc.granted_at, uc.revoked_at, uc.created_at, u.email, u.name
       FROM user_consents uc
       LEFT JOIN users u ON uc.user_id = u.id
       ORDER BY uc.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const total = await findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM user_consents`);

    return { consents, total: total?.cnt || 0, limit, offset };
  });

  // ── GET /admin/compliance/decision-log ── (GAP-5)
  fastify.get('/admin/compliance/decision-log', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string; model?: string; user_id?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    let where = '1=1';
    const params: any[] = [];
    if (query.model) { where += ' AND dl.ai_model = ?'; params.push(query.model); }
    if (query.user_id) {
      const userId = safeParseInt(query.user_id, 0);
      if (userId > 0) { where += ' AND dl.user_id = ?'; params.push(userId); }
    }

    const logs = await findMany<any>(fastify.db,
      `SELECT dl.id, dl.user_id, dl.conversation_id, dl.message_id, dl.ai_model, dl.ai_provider,
              dl.tokens_input, dl.tokens_output, dl.latency_ms, dl.safety_flags,
              dl.disclosure_shown, dl.created_at, u.email, u.name
       FROM ai_decision_log dl
       LEFT JOIN users u ON dl.user_id = u.id
       WHERE ${where}
       ORDER BY dl.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const total = await findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM ai_decision_log WHERE ${where}`, params);

    return { logs, total: total?.cnt || 0, limit, offset };
  });

  // ── GET /admin/compliance/bias-report ── (GAP-11)
  fastify.get('/admin/compliance/bias-report', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {
    const query = request.query as { days?: string };
    const days = safeParseInt(query.days, 30, 365);

    const report = await findMany<any>(fastify.db,
      `SELECT id, period_start, period_end, ai_model, ai_provider, total_requests,
              refusal_count, error_count, avg_latency_ms, negative_feedback_count,
              positive_feedback_count, flagged_content_count, created_at
       FROM bias_monitoring_log
       WHERE period_end >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY period_end DESC`,
      [days]
    );

    // Real-time stats from decision log
    const realtime = await findMany<any>(fastify.db,
      `SELECT ai_model, ai_provider,
              COUNT(*) as total_requests,
              AVG(latency_ms) as avg_latency_ms,
              SUM(CASE WHEN safety_flags IS NOT NULL THEN 1 ELSE 0 END) as flagged_count
       FROM ai_decision_log
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY ai_model, ai_provider
       ORDER BY total_requests DESC`,
      [days]
    );

    return { historical: report, realtime };
  });

  // ── GET /admin/compliance/feedback-stats ── (GAP-9)
  fastify.get('/admin/compliance/feedback-stats', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {

    const byCategory = await findMany<any>(fastify.db,
      `SELECT category, rating, COUNT(*) as cnt FROM response_feedback GROUP BY category, rating ORDER BY cnt DESC`
    );
    const byModel = await findMany<any>(fastify.db,
      `SELECT m.ai_model, rf.rating, COUNT(*) as cnt
       FROM response_feedback rf
       JOIN messages m ON rf.message_id = m.id
       WHERE m.ai_model IS NOT NULL
       GROUP BY m.ai_model, rf.rating
       ORDER BY cnt DESC`
    );

    return { by_category: byCategory, by_model: byModel };
  });

  // ── GET /admin/compliance/model-docs ── (GAP-8)
  fastify.get('/admin/compliance/model-docs', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {

    const models = await findMany<any>(fastify.db,
      `SELECT m.id, m.model_id, m.display_name, p.display_name as provider_name,
              m.context_window, m.knowledge_cutoff, m.limitations, m.bias_notes,
              m.safety_rating, m.documentation_url, m.is_enabled
       FROM ai_models m
       LEFT JOIN ai_providers p ON m.provider_id = p.id
       ORDER BY p.display_name, m.display_name`
    );
    return { models };
  });

  // ── PUT /admin/compliance/model-docs/:id ── (GAP-8)
  fastify.put('/admin/compliance/model-docs/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const modelId = safeParseInt(id, 0);
    if (modelId === 0) return reply.status(400).send({ error: 'ID non valido.' });

    const body = modelDocsUpdateSchema.parse(request.body);
    const user = request.user as UserPayload;

    const sets: string[] = [];
    const params: any[] = [];
    if (body.knowledge_cutoff !== undefined) { sets.push('knowledge_cutoff = ?'); params.push(body.knowledge_cutoff); }
    if (body.limitations !== undefined) { sets.push('limitations = ?'); params.push(body.limitations); }
    if (body.bias_notes !== undefined) { sets.push('bias_notes = ?'); params.push(body.bias_notes); }
    if (body.safety_rating !== undefined) { sets.push('safety_rating = ?'); params.push(body.safety_rating); }
    if (body.documentation_url !== undefined) { sets.push('documentation_url = ?'); params.push(body.documentation_url); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare.' });

    params.push(modelId);
    await updateOne(fastify.db, `UPDATE ai_models SET ${sets.join(', ')} WHERE id = ?`, params);

    await insertOne(fastify.db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, 'update_model_docs', 'ai_model', modelId, JSON.stringify(body), getRealIp(request)]
    );

    return { success: true };
  });

  // ── GET /admin/compliance/export-requests ── (GAP-6)
  fastify.get('/admin/compliance/export-requests', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    const exports = await findMany<any>(fastify.db,
      `SELECT der.id, der.user_id, der.status, der.format, der.requested_at,
              der.completed_at, der.expires_at, u.email, u.name
       FROM data_export_requests der
       LEFT JOIN users u ON der.user_id = u.id
       ORDER BY der.requested_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { exports, limit, offset };
  });

  // ── GET /admin/compliance/deletion-requests ── (GAP-7)
  fastify.get('/admin/compliance/deletion-requests', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    const deletions = await findMany<any>(fastify.db,
      `SELECT adr.id, adr.user_id, adr.status, adr.reason, adr.requested_at,
              adr.confirm_by, adr.completed_at, u.email, u.name
       FROM account_deletion_requests adr
       LEFT JOIN users u ON adr.user_id = u.id
       ORDER BY adr.requested_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { deletions, limit, offset };
  });
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Generate data export (runs in background)
// ═══════════════════════════════════════════════════════════════════
async function generateDataExport(fastify: FastifyInstance, userId: number, exportId: number, format: string): Promise<void> {
  try {
    await updateOne(fastify.db, `UPDATE data_export_requests SET status = 'processing' WHERE id = ?`, [exportId]);

    const [user, conversations, totalMsgCount, messages, consents, totalFeedbackCount, feedback, usage] = await Promise.all([
      findOne<any>(fastify.db, `SELECT id, email, name, role, created_at, last_login_at FROM users WHERE id = ?`, [userId]),
      findMany<any>(fastify.db, `SELECT id, title, model, provider, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY created_at DESC`, [userId]),
      findOne<{ cnt: number }>(fastify.db,
        `SELECT COUNT(*) as cnt FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user_id = ?`, [userId]),
      findMany<any>(fastify.db,
        `SELECT m.id, m.conversation_id, m.role, m.content, m.tokens_input, m.tokens_output, m.is_ai_generated, m.ai_model, m.created_at
         FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user_id = ? ORDER BY m.created_at DESC LIMIT 50000`, [userId]),
      findMany<any>(fastify.db,
        `SELECT id, consent_type, granted, granted_at, revoked_at, created_at FROM user_consents WHERE user_id = ?`, [userId]),
      findOne<{ cnt: number }>(fastify.db,
        `SELECT COUNT(*) as cnt FROM response_feedback WHERE user_id = ?`, [userId]),
      findMany<any>(fastify.db,
        `SELECT id, message_id, rating, category, comment, created_at FROM response_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50000`, [userId]),
      findMany<any>(fastify.db,
        `SELECT id, year_month, provider, total_tokens_input, total_tokens_output, request_count FROM monthly_usage WHERE user_id = ? ORDER BY year_month DESC`, [userId]),
    ]);

    const totalMessages = totalMsgCount?.cnt || 0;
    const totalFeedback = totalFeedbackCount?.cnt || 0;

    const exportData = {
      exported_at: new Date().toISOString(),
      gdpr_article: 'Art. 20 GDPR - Diritto alla portabilità dei dati',
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
