import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, insertOne } from '../../database/index.js';

// Validation schemas
const activityLogSchema = z.object({
  action: z.string(),
  details: z.record(z.any()),
  source: z.string(),
  timestamp: z.string()
});

// Types
interface ActivityLog {
  id: number;
  user_id: number;
  action: string;
  details: string;
  source: string;
  created_at: Date;
}

export async function activityRoutes(fastify: FastifyInstance) {
  // Log activity from extension/clients
  fastify.post('/activity/log', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Log user activity from extension',
      tags: ['activity'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const body = activityLogSchema.parse(request.body);

      await insertOne(
        fastify.db,
        `INSERT INTO activity_log (user_id, action, details, source, ip_address)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, body.action, JSON.stringify(body.details), body.source, request.ip]
      );

      return { success: true };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Get activity logs (admin only)
  fastify.get('/admin/activity', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get activity logs (admin)',
      tags: ['admin', 'activity'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number; role: string };

    // Check admin role
    const userData = await findOne<{ role: string }>(
      fastify.db,
      'SELECT role FROM users WHERE id = ?',
      [user.id]
    );

    if (userData?.role !== 'admin') {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const query = request.query as {
      limit?: string;
      offset?: string;
      action?: string;
      userId?: string;
      source?: string;
    };

    const limit = Math.min(parseInt(query.limit || '50') || 50, 200);
    const offset = parseInt(query.offset || '0');

    let sql = `
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM activity_log a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [];

    if (query.action) {
      sql += ' AND a.action = ?';
      params.push(query.action);
    }

    if (query.userId) {
      sql += ' AND a.user_id = ?';
      params.push(query.userId);
    }

    if (query.source) {
      sql += ' AND a.source = ?';
      params.push(query.source);
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const activities = await findMany<ActivityLog & { user_name: string; user_email: string }>(
      fastify.db,
      sql,
      params
    );

    // Parse JSON details
    return activities.map(a => ({
      ...a,
      details: JSON.parse(a.details || '{}')
    }));
  });

  // Get activity statistics (admin only)
  fastify.get('/admin/activity/stats', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get activity statistics (admin)',
      tags: ['admin', 'activity'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number; role: string };

    // Check admin role
    const userData = await findOne<{ role: string }>(
      fastify.db,
      'SELECT role FROM users WHERE id = ?',
      [user.id]
    );

    if (userData?.role !== 'admin') {
      return reply.status(403).send({ error: 'Access denied' });
    }

    // Get stats by action type
    const byAction = await findMany<{ action: string; count: number }>(
      fastify.db,
      `SELECT action, COUNT(*) as count
       FROM activity_log
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY action
       ORDER BY count DESC`
    );

    // Get stats by user
    const byUser = await findMany<{ user_id: number; user_name: string; count: number }>(
      fastify.db,
      `SELECT a.user_id, u.name as user_name, COUNT(*) as count
       FROM activity_log a
       JOIN users u ON a.user_id = u.id
       WHERE a.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY a.user_id, u.name
       ORDER BY count DESC
       LIMIT 10`
    );

    // Get daily activity
    const daily = await findMany<{ date: string; count: number }>(
      fastify.db,
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM activity_log
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`
    );

    return {
      byAction,
      byUser,
      daily
    };
  });
}
