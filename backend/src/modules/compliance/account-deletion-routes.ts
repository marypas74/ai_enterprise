import { FastifyInstance } from 'fastify';
import { findOne, insertOne, updateOne } from '../../database/index.js';
import { deleteAccountSchema, UserPayload, safeParseInt, getRealIp } from './utils.js';

export async function accountDeletionRoutes(fastify: FastifyInstance) {

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
      return reply.status(409).send({ error: 'Richiesta di cancellazione gi\u00e0 presente.', request_id: existing.id, status: existing.status });
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

    return { success: true, request_id: requestId, confirm_by_days: days, message: `Account verr\u00e0 eliminato tra ${days} giorni. Puoi annullare in qualsiasi momento.` };
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

    return { success: true, message: 'Cancellazione confermata. L\'account verr\u00e0 eliminato al termine del periodo di grazia.' };
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
}
