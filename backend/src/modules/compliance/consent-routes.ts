import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import {
  consentSchema,
  feedbackSchema,
  revokeConsentSchema,
  UserPayload,
  getRealIp,
} from './utils.js';

export async function consentRoutes(fastify: FastifyInstance) {

  // ── GET /compliance/disclosure ── (GAP-1: Art. 50 disclosure info)
  fastify.get('/compliance/disclosure', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

    // Check for pending account deletion (GAP-7)
    const deletionReq = await findOne<{ id: number }>(
      fastify.db,
      `SELECT id FROM account_deletion_requests WHERE user_id = ? AND status IN ('pending','confirmed')`,
      [user.id]
    );

    return { consents: consentMap, all_required_granted: allGranted, deletion_pending: !!deletionReq };
  });

  // ── POST /compliance/consent/revoke ── (GAP-4: Revoke consent)
  fastify.post('/compliance/consent/revoke', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = revokeConsentSchema.parse(request.body);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const user = request.user as UserPayload;
    const body = feedbackSchema.parse(request.body);

    // Verify message belongs to the user's conversation
    const messageOwned = await findOne<{ id: number }>(
      fastify.db,
      `SELECT m.id FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = ? AND c.user_id = ? AND m.role = 'assistant'`,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

  // ── GET /compliance/models ── (GAP-8: Model documentation for users)
  fastify.get('/compliance/models', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
}
