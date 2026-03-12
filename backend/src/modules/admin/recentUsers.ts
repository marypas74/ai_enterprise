import { FastifyInstance, FastifyRequest } from 'fastify';
import { findMany } from '../../database/index.js';

interface RecentUserRow {
  user_id: number;
  email: string;
  name: string;
  role: string;
  last_login_at: string | null;
  session_count: number;
  last_ip: string | null;
  last_country: string | null;
  last_user_agent: string | null;
  last_activity_at: string | null;
  first_access_in_period: string | null;
}

interface LoginEventRow {
  user_id: number;
  email: string;
  name: string;
  ip_address: string;
  country: string | null;
  user_agent: string;
  created_at: string;
  last_activity_at: string | null;
}

export async function recentUsersRoutes(fastify: FastifyInstance) {
  // Auth + admin check inherited from parent router

  // GET /admin/recent-users?days=2
  fastify.get('/recent-users', {
    schema: {
      description: 'Report utenti connessi negli ultimi N giorni',
      tags: ['admin'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', default: 2, minimum: 1, maximum: 30 }
        }
      }
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = Math.min(Math.max(parseInt(query.days || '2') || 2, 1), 30);

    // Summary: utenti unici che hanno avuto sessioni negli ultimi N giorni
    const users = await findMany<RecentUserRow>(
      fastify.db,
      `SELECT
        u.id AS user_id,
        u.email,
        u.name,
        u.role,
        u.last_login_at,
        COUNT(us.id) AS session_count,
        (SELECT s2.ip_address FROM user_sessions s2
         WHERE s2.user_id = u.id
         ORDER BY s2.last_activity_at DESC LIMIT 1) AS last_ip,
        (SELECT s3.country FROM user_sessions s3
         WHERE s3.user_id = u.id
         ORDER BY s3.last_activity_at DESC LIMIT 1) AS last_country,
        (SELECT s4.user_agent FROM user_sessions s4
         WHERE s4.user_id = u.id
         ORDER BY s4.last_activity_at DESC LIMIT 1) AS last_user_agent,
        MAX(us.last_activity_at) AS last_activity_at,
        MIN(us.created_at) AS first_access_in_period
      FROM users u
      INNER JOIN user_sessions us ON u.id = us.user_id
      WHERE us.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         OR us.last_activity_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY u.id
      ORDER BY MAX(us.last_activity_at) DESC`,
      [days, days]
    );

    // Dettaglio: ogni singolo login nel periodo
    const loginEvents = await findMany<LoginEventRow>(
      fastify.db,
      `SELECT
        u.id AS user_id,
        u.email,
        u.name,
        us.ip_address,
        us.country,
        us.user_agent,
        us.created_at,
        us.last_activity_at
      FROM user_sessions us
      INNER JOIN users u ON us.user_id = u.id
      WHERE us.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY us.created_at DESC
      LIMIT 500`,
      [days]
    );

    return {
      days,
      totalUniqueUsers: users.length,
      users,
      loginEvents
    };
  });
}
