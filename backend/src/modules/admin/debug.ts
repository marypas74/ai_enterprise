import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findAll } from '../../database/index.js';
import os from 'os';

// In-memory log buffer for recent logs
const logBuffer: any[] = [];
const MAX_LOG_BUFFER = 1000;

// Function to add log to buffer (called from main index.ts)
export function addToLogBuffer(log: any) {
  logBuffer.push({
    ...log,
    timestamp: new Date().toISOString()
  });
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
}

export async function debugRoutes(fastify: FastifyInstance) {
  // Require admin authentication for debug endpoints
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user = request.user as { role?: string };
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  };

  // Get recent logs from buffer
  fastify.get('/debug/logs', {
    onRequest: [requireAdmin],
    schema: {
      description: 'Get recent backend logs',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { limit?: string; level?: string };
    const limit = Math.min(parseInt(query.limit || '100') || 100, 200);
    const level = query.level;

    let filteredLogs = [...logBuffer];

    if (level) {
      const levelMap: Record<string, number> = {
        debug: 20,
        info: 30,
        warn: 40,
        error: 50
      };
      const levelNum = levelMap[level];
      if (levelNum) {
        filteredLogs = filteredLogs.filter(log => log.level >= levelNum);
      }
    }

    return {
      logs: filteredLogs.slice(-limit),
      total: filteredLogs.length,
      bufferSize: logBuffer.length
    };
  });

  // Get system diagnostics
  fastify.get('/debug/system', {
    onRequest: [requireAdmin],
    schema: {
      description: 'Get system diagnostics',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const memUsage = process.memoryUsage();

    return {
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: process.uptime()
      },
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      },
      os: {
        hostname: os.hostname(),
        type: os.type(),
        platform: os.platform(),
        release: os.release(),
        cpus: os.cpus().length,
        totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024),
        loadAvg: os.loadavg()
      },
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT
      }
    };
  });

  // Get database stats
  fastify.get('/debug/database', {
    onRequest: [requireAdmin],
    schema: {
      description: 'Get database statistics',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    try {
      // Get table counts
      const tables = [
        'users', 'conversations', 'messages', 'projects',
        'kanban_boards', 'kanban_columns', 'kanban_cards',
        'ai_providers', 'ai_models', 'agent_sessions'
      ];

      const counts: Record<string, number> = {};
      for (const table of tables) {
        try {
          const result = await findAll<{ count: number }>(
            fastify.db,
            `SELECT COUNT(*) as count FROM ${table}`
          );
          counts[table] = result[0]?.count || 0;
        } catch {
          counts[table] = -1; // Table doesn't exist
        }
      }

      return {
        tables: counts,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return { error: error.message };
    }
  });

  // Get recent API requests from audit log
  fastify.get('/debug/requests', {
    onRequest: [requireAdmin],
    schema: {
      description: 'Get recent API requests',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50') || 50, 200);

    try {
      const logs = await findAll<any>(
        fastify.db,
        `SELECT al.*, u.email as user_email
         FROM audit_log al
         LEFT JOIN users u ON al.user_id = u.id
         ORDER BY al.created_at DESC
         LIMIT ?`,
        [limit]
      );

      return { requests: logs };
    } catch {
      return { requests: [], error: 'Audit log table not available' };
    }
  });

  // Get active connections/sessions
  fastify.get('/debug/connections', {
    onRequest: [requireAdmin],
    schema: {
      description: 'Get active connections info',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    try {
      // Get recent active users
      const activeUsers = await findAll<any>(
        fastify.db,
        `SELECT id, email, name, last_activity
         FROM users
         WHERE last_activity > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
         ORDER BY last_activity DESC
         LIMIT 20`
      );

      // Get active agent sessions
      const activeSessions = await findAll<any>(
        fastify.db,
        `SELECT id, name, status, terminal_slot, created_at
         FROM agent_sessions
         WHERE status IN ('running', 'waiting')
         ORDER BY created_at DESC`
      );

      return {
        activeUsers,
        activeSessions,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return {
        activeUsers: [],
        activeSessions: [],
        error: error.message
      };
    }
  });

  // Test endpoint - echo request details
  fastify.all('/debug/echo', {
    onRequest: [requireAdmin],
    bodyLimit: 100 * 1024, // SECURITY: 100KB max for debug echo
    schema: {
      description: 'Echo request details for testing',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    // M-08: Redact sensitive headers to prevent credential leakage
    const { authorization, cookie, 'x-api-key': _apiKey, ...safeHeaders } = request.headers;
    // SECURITY: Truncate reflected body to prevent large payload abuse
    const rawBody = request.body;
    const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    const body = bodyStr && bodyStr.length > 10000 ? bodyStr.slice(0, 10000) + '...[TRUNCATED]' : rawBody;
    return {
      method: request.method,
      url: request.url,
      headers: { ...safeHeaders, authorization: authorization ? '[REDACTED]' : undefined },
      query: request.query,
      body,
      ip: request.ip,
      timestamp: new Date().toISOString()
    };
  });

  // Clear log buffer
  fastify.delete('/debug/logs', {
    onRequest: [requireAdmin],
    schema: {
      description: 'Clear log buffer',
      tags: ['debug'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const cleared = logBuffer.length;
    logBuffer.length = 0;
    return { cleared, message: 'Log buffer cleared' };
  });
}
