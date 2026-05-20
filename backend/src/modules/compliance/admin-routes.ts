import { FastifyInstance } from 'fastify';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { requireAdmin } from '../../middleware/index.js';
import { modelDocsUpdateSchema, UserPayload, safeParseInt, getRealIp } from './utils.js';

export async function adminRoutes(fastify: FastifyInstance) {

  // ── GET /admin/compliance/dashboard ──
  fastify.get('/admin/compliance/dashboard', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {

    // Helper: run a query safely, return fallback on error (e.g. missing table)
    const safeQuery = async <T>(queryFn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await queryFn(); } catch {
        return fallback;
      }
    };

    const [
      totalUsers,
      usersWithAllConsents,
      totalDecisions,
      totalFeedback,
      totalExports,
      pendingExports,
      pendingDeletions,
      latestBias,
    ] = await Promise.all([
      safeQuery(() => findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM users WHERE is_active = TRUE`), { cnt: 0 }),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db,
        `SELECT COUNT(*) as cnt FROM (
           SELECT user_id FROM user_consents
           WHERE granted = TRUE AND consent_type IN ('ai_disclosure','data_processing','terms_of_service')
           GROUP BY user_id HAVING COUNT(DISTINCT consent_type) = 3
         ) AS fully_consented`
      ), { cnt: 0 }),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM ai_decision_log`), { cnt: 0 }),
      safeQuery(() => findOne<{ total: number; positive: number; negative: number }>(fastify.db,
        `SELECT COUNT(*) as total, SUM(CASE WHEN rating=1 THEN 1 ELSE 0 END) as positive, SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END) as negative FROM response_feedback`
      ), { total: 0, positive: 0, negative: 0 }),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM data_export_requests`), { cnt: 0 }),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM data_export_requests WHERE status IN ('pending','processing')`), { cnt: 0 }),
      safeQuery(() => findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM account_deletion_requests WHERE status IN ('pending','confirmed')`), { cnt: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      safeQuery(() => findMany<any>(fastify.db,
        `SELECT id, period_start, period_end, ai_model, ai_provider, total_requests,
                refusal_count, error_count, avg_latency_ms, negative_feedback_count,
                positive_feedback_count, flagged_content_count, created_at
         FROM bias_monitoring_log ORDER BY period_end DESC LIMIT 5`
      ), []),
    ]);

    return {
      users: { total: totalUsers?.cnt || 0, with_all_consents: usersWithAllConsents?.cnt || 0 },
      ai_decisions: { total: totalDecisions?.cnt || 0 },
      feedback: totalFeedback || { total: 0, positive: 0, negative: 0 },
      total_exports: totalExports?.cnt || 0,
      pending_exports: pendingExports?.cnt || 0,
      pending_deletions: pendingDeletions?.cnt || 0,
      latest_bias_reports: latestBias,
    };
  });

  // ── GET /admin/compliance/consent-audit ── (GAP-4)
  fastify.get('/admin/compliance/consent-audit', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const consents = await findMany<any>(fastify.db,
      `SELECT uc.id, uc.user_id, uc.consent_type, uc.granted, uc.ip_address,
              uc.granted_at, uc.revoked_at, uc.created_at, u.email, u.name
       FROM user_consents uc
       LEFT JOIN users u ON uc.user_id = u.id
       ORDER BY uc.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const total = await findOne<{ cnt: number }>(fastify.db, `SELECT COUNT(*) as cnt FROM user_consents`);

    // Audit log admin read access
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const user = (request as any).user;
      await insertOne(fastify.db,
        `INSERT INTO audit_log (user_id, action, entity_type, ip_address, details) VALUES (?, ?, ?, ?, ?)`,
        [user.id, 'admin_read', 'user_consents', getRealIp(request), JSON.stringify({ results: consents.length })]
      );
    } catch { /* non-blocking */ }

    return { consents, total: total?.cnt || 0, limit, offset };
  });

  // ── GET /admin/compliance/decision-log ── (GAP-5)
  fastify.get('/admin/compliance/decision-log', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string; model?: string; user_id?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    let where = '1=1';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [];
    if (query.model && typeof query.model === 'string' && query.model.length <= 100) {
      where += ' AND dl.ai_model = ?'; params.push(query.model);
    }
    if (query.user_id) {
      const userId = safeParseInt(query.user_id, 0);
      if (userId > 0) { where += ' AND dl.user_id = ?'; params.push(userId); }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

    // Audit log admin read access
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const user = (request as any).user;
      await insertOne(fastify.db,
        `INSERT INTO audit_log (user_id, action, entity_type, ip_address, details) VALUES (?, ?, ?, ?, ?)`,
        [user.id, 'admin_read', 'ai_decision_log', getRealIp(request), JSON.stringify({ filters: { model: query.model || null, user_id: query.user_id || null }, results: logs.length })]
      );
    } catch { /* non-blocking */ }

    return { logs, total: total?.cnt || 0, limit, offset };
  });

  // ── GET /admin/compliance/bias-report ── (GAP-11)
  fastify.get('/admin/compliance/bias-report', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {
    const query = request.query as { days?: string };
    const days = safeParseInt(query.days, 30, 365);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const byCategory = await findMany<any>(fastify.db,
      `SELECT category, rating, COUNT(*) as cnt FROM response_feedback GROUP BY category, rating ORDER BY cnt DESC`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const modelId = safeParseInt(id, 0);
    if (modelId === 0) return reply.status(400).send({ error: 'ID non valido.' });

    const body = modelDocsUpdateSchema.parse(request.body);
    const user = request.user as UserPayload;

    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = safeParseInt(query.limit, 50, 200);
    const offset = safeParseInt(query.offset, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
