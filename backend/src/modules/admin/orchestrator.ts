/**
 * Admin Orchestrator Routes — FASE 8.5: Feedback loop & dashboard data.
 *
 * Provides endpoints for:
 * - Orchestrator statistics (routing distribution, quality metrics, cost savings)
 * - Tier configuration CRUD
 * - Routing settings management
 */
import { FastifyInstance } from 'fastify';
import { findMany } from '../../database/index.js';

export async function orchestratorAdminRoutes(fastify: FastifyInstance) {

  // ── GET /admin/orchestrator/stats ──────────────────────────────────
  fastify.get('/orchestrator/stats', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Get orchestrator routing statistics', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    // Routing distribution (last 7 days)
    const distribution = await findMany<{ selected_tier: string; count: number; avg_latency: number; avg_cost: number }>(
      fastify.db,
      `SELECT selected_tier,
              COUNT(*) as count,
              ROUND(AVG(latency_ms)) as avg_latency,
              ROUND(AVG(cost_usd), 6) as avg_cost
       FROM routing_decisions
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY selected_tier`
    ).catch(() => []);

    // Quality metrics
    const quality = await findMany<{ metric: string; value: number }>(
      fastify.db,
      `SELECT
        'total_requests' as metric, COUNT(*) as value FROM routing_decisions WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       UNION ALL
       SELECT 'user_overrides', COUNT(*) FROM routing_decisions WHERE user_override = TRUE AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       UNION ALL
       SELECT 'avg_confidence', ROUND(AVG(routing_confidence), 3) FROM routing_decisions WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       UNION ALL
       SELECT 'avg_latency_ms', ROUND(AVG(latency_ms)) FROM routing_decisions WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
    ).catch(() => []);

    // Cost comparison: auto vs if everything went to most expensive model
    const costComparison = await findMany<{ actual_cost: number; max_model_cost: number }>(
      fastify.db,
      `SELECT
        ROUND(SUM(cost_usd), 2) as actual_cost,
        ROUND(SUM(tokens_input * 0.005 / 1000 + tokens_output * 0.025 / 1000), 2) as max_model_cost
       FROM routing_decisions
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
    ).catch(() => []);

    // Per-method breakdown
    const methods = await findMany<{ routing_method: string; count: number }>(
      fastify.db,
      `SELECT routing_method, COUNT(*) as count
       FROM routing_decisions
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY routing_method`
    ).catch(() => []);

    const total = quality.find(q => q.metric === 'total_requests')?.value || 0;
    const overrides = quality.find(q => q.metric === 'user_overrides')?.value || 0;
    const actualCost = costComparison[0]?.actual_cost || 0;
    const maxCost = costComparison[0]?.max_model_cost || 0;

    return {
      distribution,
      quality: {
        totalRequests: total,
        userOverrides: overrides,
        overrideRate: total > 0 ? Math.round((overrides / total) * 100) / 100 : 0,
        avgConfidence: quality.find(q => q.metric === 'avg_confidence')?.value || 0,
        avgLatencyMs: quality.find(q => q.metric === 'avg_latency_ms')?.value || 0,
      },
      costSavings: {
        actualCost,
        maxModelCost: maxCost,
        savedUsd: Math.round((maxCost - actualCost) * 100) / 100,
        savingsPercent: maxCost > 0 ? Math.round(((maxCost - actualCost) / maxCost) * 100) : 0,
      },
      methods,
    };
  });

  // ── GET /admin/orchestrator/tiers ──────────────────────────────────
  fastify.get('/orchestrator/tiers', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Get routing tier configuration', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    return findMany(fastify.db,
      `SELECT id, tier_name, provider, model_id, priority, max_concurrent, is_enabled, created_at
       FROM model_routing_tiers ORDER BY tier_name, priority ASC`
    ).catch(() => []);
  });

  // ── PUT /admin/orchestrator/tiers/:id ──────────────────────────────
  fastify.put('/orchestrator/tiers/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Update a routing tier entry', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    const { id } = request.params as { id: number };
    const body = request.body as { priority?: number; is_enabled?: boolean; max_concurrent?: number };

    const sets: string[] = [];
    const params: any[] = [];
    if (body.priority !== undefined) { sets.push('priority = ?'); params.push(body.priority); }
    if (body.is_enabled !== undefined) { sets.push('is_enabled = ?'); params.push(body.is_enabled); }
    if (body.max_concurrent !== undefined) { sets.push('max_concurrent = ?'); params.push(body.max_concurrent); }

    if (sets.length === 0) return { error: 'No fields to update' };
    params.push(id);

    await fastify.db.execute(`UPDATE model_routing_tiers SET ${sets.join(', ')} WHERE id = ?`, params);
    return { success: true };
  });

  // ── POST /admin/orchestrator/tiers ─────────────────────────────────
  fastify.post('/orchestrator/tiers', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Add a model to a routing tier', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    const body = request.body as { tier_name: string; provider: string; model_id: string; priority?: number };
    await fastify.db.execute(
      `INSERT INTO model_routing_tiers (tier_name, provider, model_id, priority) VALUES (?, ?, ?, ?)`,
      [body.tier_name, body.provider, body.model_id, body.priority || 0]
    );
    return { success: true };
  });

  // ── DELETE /admin/orchestrator/tiers/:id ────────────────────────────
  fastify.delete('/orchestrator/tiers/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Remove a model from routing tier', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    const { id } = request.params as { id: number };
    await fastify.db.execute('DELETE FROM model_routing_tiers WHERE id = ?', [id]);
    return { success: true };
  });

  // ── GET /admin/orchestrator/settings ───────────────────────────────
  fastify.get('/orchestrator/settings', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Get orchestrator settings', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    return findMany(fastify.db,
      'SELECT setting_key, setting_value FROM model_routing_settings'
    ).catch(() => []);
  });

  // ── PUT /admin/orchestrator/settings ───────────────────────────────
  fastify.put('/orchestrator/settings', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Update orchestrator settings', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const user = request.user as { id: number; role: string };
    if (user.role !== 'admin') return { error: 'Forbidden' };

    const settings = request.body as Record<string, string>;
    for (const [key, value] of Object.entries(settings)) {
      await fastify.db.execute(
        `INSERT INTO model_routing_settings (setting_key, setting_value)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(value)]
      );
    }
    return { success: true };
  });
}
