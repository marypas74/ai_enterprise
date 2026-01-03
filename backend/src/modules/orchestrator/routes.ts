import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TerminalManager } from '../../services/TerminalManager.js';
import { AgentOrchestrator } from '../../services/AgentOrchestrator.js';
import { WorktreeManager } from '../../services/WorktreeManager.js';
import { AgentEventEmitter } from '../../services/AgentEventEmitter.js';

export async function orchestratorRoutes(fastify: FastifyInstance) {
  // ==================== STATUS ====================

  // Get orchestrator status and metrics
  fastify.get('/status', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get orchestrator status and metrics',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const metrics = await AgentOrchestrator.getDashboardMetrics(fastify.db);
    return {
      status: 'online',
      uptime: process.uptime(),
      ...metrics
    };
  });

  // ==================== TERMINALS ====================

  // Get terminal slots status
  fastify.get('/terminals', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all terminal slots status',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const slots = TerminalManager.getAllSlots();
    const metrics = TerminalManager.getMetrics();

    return {
      slots,
      metrics
    };
  });

  // Get specific terminal slot
  fastify.get('/terminals/:slot', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get specific terminal slot status',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { slot: string };
    const slotNumber = parseInt(params.slot);

    if (isNaN(slotNumber) || slotNumber < 0 || slotNumber > 11) {
      return reply.status(400).send({ error: 'Invalid slot number. Must be 0-11' });
    }

    const slot = TerminalManager.getSlot(slotNumber);

    if (!slot) {
      return reply.status(404).send({ error: 'Slot not found' });
    }

    // Get session details if occupied
    let session = null;
    if (slot.sessionId) {
      session = await AgentOrchestrator.getSession(fastify.db, slot.sessionId);
    }

    return {
      slot,
      session
    };
  });

  // Release terminal slot (admin action)
  fastify.post('/terminals/:slot/release', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Force release a terminal slot',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number; role?: string };
    const params = request.params as { slot: string };
    const slotNumber = parseInt(params.slot);

    // Check admin role (simple check - in production use proper RBAC)
    const [userRows] = await fastify.db.execute(
      'SELECT role FROM users WHERE id = ?',
      [user.id]
    );
    const userRole = (userRows as any[])[0]?.role;

    if (userRole !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    if (isNaN(slotNumber) || slotNumber < 0 || slotNumber > 11) {
      return reply.status(400).send({ error: 'Invalid slot number. Must be 0-11' });
    }

    const slot = TerminalManager.getSlot(slotNumber);

    if (!slot) {
      return reply.status(404).send({ error: 'Slot not found' });
    }

    if (slot.status === 'available') {
      return reply.status(400).send({ error: 'Slot is already available' });
    }

    // If there's a session, cancel it
    if (slot.sessionId) {
      try {
        await AgentOrchestrator.cancelSession(fastify.db, slot.sessionId);
      } catch {
        // Session might already be completed/failed
      }
    }

    // Force release
    TerminalManager.releaseSlot(slotNumber);

    return { message: 'Slot released', slot: slotNumber };
  });

  // ==================== WORKTREE MANAGEMENT ====================

  // Prune old worktrees
  fastify.post('/worktrees/prune', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Prune old/orphaned worktrees',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    // Check admin role
    const [userRows] = await fastify.db.execute(
      'SELECT role FROM users WHERE id = ?',
      [user.id]
    );
    const userRole = (userRows as any[])[0]?.role;

    if (userRole !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const pruned = await WorktreeManager.pruneWorktrees(fastify.db);

    return { message: `Pruned ${pruned} worktrees`, count: pruned };
  });

  // ==================== REAL-TIME EVENTS ====================

  // Subscribe to orchestrator events (SSE)
  fastify.get('/events', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Subscribe to orchestrator events via SSE',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Set up SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial status
    const metrics = await AgentOrchestrator.getDashboardMetrics(fastify.db);
    reply.raw.write(`data: ${JSON.stringify({ type: 'initial', ...metrics })}\n\n`);

    // Subscribe to orchestrator events
    const unsubscribe = AgentEventEmitter.subscribeToOrchestrator((event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client disconnected
        unsubscribe();
      }
    });

    // Handle client disconnect
    request.raw.on('close', () => {
      unsubscribe();
    });
  });

  // ==================== DASHBOARD DATA ====================

  // Get dashboard summary
  fastify.get('/dashboard', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get dashboard data for Auto-Claude UI',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };

    // Get orchestrator metrics
    const orchestratorMetrics = await AgentOrchestrator.getDashboardMetrics(fastify.db);

    // Get user's recent sessions
    const recentSessions = await AgentOrchestrator.getUserSessions(fastify.db, user.id, {
      limit: 10
    });

    // Get active sessions (running or paused)
    const activeSessions = await AgentOrchestrator.getUserSessions(fastify.db, user.id, {
      status: 'running',
      limit: 12
    });

    const pausedSessions = await AgentOrchestrator.getUserSessions(fastify.db, user.id, {
      status: 'paused',
      limit: 12
    });

    // Get available templates
    const [templates] = await fastify.db.execute(
      `SELECT t.*, m.display_name as model_display_name
       FROM agent_templates t
       LEFT JOIN ai_models m ON t.model_id = m.id
       WHERE (t.user_id = ? OR t.is_public = TRUE) AND t.is_active = TRUE
       LIMIT 10`,
      [user.id]
    );

    return {
      orchestrator: orchestratorMetrics,
      user: {
        activeSessions: [...activeSessions.sessions, ...pausedSessions.sessions],
        recentSessions: recentSessions.sessions,
        totalSessions: recentSessions.total
      },
      templates: (templates as any[]).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        modelDisplayName: t.model_display_name,
        isPublic: t.is_public
      }))
    };
  });

  // ==================== EXECUTION HISTORY ====================

  // Get execution history
  fastify.get('/history', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get agent execution history',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          offset: { type: 'number' },
          sessionId: { type: 'number' }
        }
      }
    }
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const query = request.query as { limit?: string; offset?: string; sessionId?: string };

    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');

    let sql = `SELECT h.*, s.name as session_name
               FROM agent_execution_history h
               JOIN agent_sessions s ON h.session_id = s.id
               WHERE s.user_id = ?`;
    const params: any[] = [user.id];

    if (query.sessionId) {
      sql += ' AND h.session_id = ?';
      params.push(parseInt(query.sessionId));
    }

    // Get total
    const [countResult] = await fastify.db.execute(
      sql.replace('SELECT h.*, s.name as session_name', 'SELECT COUNT(*) as total'),
      params
    );
    const total = (countResult as any[])[0].total;

    // Get results
    sql += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await fastify.db.execute(sql, params);

    return {
      history: (rows as any[]).map(row => ({
        id: row.id,
        sessionId: row.session_id,
        sessionName: row.session_name,
        actionType: row.action_type,
        actionDescription: row.action_description,
        tokensInput: row.tokens_input,
        tokensOutput: row.tokens_output,
        costUsd: parseFloat(row.cost_usd),
        durationMs: row.duration_ms,
        success: row.success,
        errorMessage: row.error_message,
        createdAt: row.created_at
      })),
      total,
      limit,
      offset
    };
  });

  // ==================== SYSTEM HEALTH ====================

  // Get system health check
  fastify.get('/health', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get system health status',
      tags: ['orchestrator'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const terminals = TerminalManager.getMetrics();

    // Check database connection
    let dbStatus = 'healthy';
    try {
      await fastify.db.execute('SELECT 1');
    } catch {
      dbStatus = 'unhealthy';
    }

    return {
      status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
      components: {
        database: dbStatus,
        terminals: {
          status: terminals.availableSlots > 0 ? 'healthy' : 'at_capacity',
          available: terminals.availableSlots,
          occupied: terminals.occupiedSlots
        },
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
      },
      timestamp: new Date().toISOString()
    };
  });
}
