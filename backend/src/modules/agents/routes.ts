import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AgentOrchestrator, CreateSessionDTO } from '../../services/AgentOrchestrator.js';
import { WorktreeManager } from '../../services/WorktreeManager.js';
import { AgentEventEmitter } from '../../services/AgentEventEmitter.js';
import { findOne, findMany } from '../../database/index.js';

// Validation schemas
const createSessionSchema = z.object({
  name: z.string().min(1).max(200),
  taskSpecification: z.string().min(1),
  modelId: z.number(),
  systemPrompt: z.string().optional(),
  templateId: z.number().optional(),
  cardId: z.number().optional(),
  config: z.object({
    maxIterations: z.number().min(1).max(100).optional(),
    timeoutSeconds: z.number().min(60).max(7200).optional(),
    autoCommit: z.boolean().optional(),
    runTests: z.boolean().optional(),
    createWorktree: z.boolean().optional(),
    baseBranch: z.string().optional()
  }).optional()
});

const updateSessionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.object({
    maxIterations: z.number().min(1).max(100).optional(),
    timeoutSeconds: z.number().min(60).max(7200).optional()
  }).optional()
});

const resolveConflictSchema = z.object({
  filePath: z.string().min(1),
  resolvedContent: z.string(),
  tier: z.enum(['automated', 'ai_assisted', 'manual']),
  rationale: z.string().optional()
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  modelId: z.number(),
  systemPrompt: z.string().min(1),
   
  defaultConfig: z.record(z.any()).optional(),
  tools: z.array(z.string()).optional(),
  maxIterations: z.number().min(1).max(100).optional(),
  timeoutSeconds: z.number().min(60).max(7200).optional(),
  category: z.enum(['development', 'testing', 'documentation', 'research', 'automation', 'custom']).optional(),
  isPublic: z.boolean().optional()
});

export async function agentRoutes(fastify: FastifyInstance) {
  // ==================== SESSIONS ====================

  // List sessions
  fastify.get('/sessions', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List agent sessions',
      tags: ['agents'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const query = request.query as { status?: string; limit?: string; offset?: string };

    const result = await AgentOrchestrator.getUserSessions(fastify.db, user.id, {
      status: query.status,
      limit: parseInt(query.limit || '50'),
      offset: parseInt(query.offset || '0')
    });

    return result;
  });

  // Create session
  fastify.post('/sessions', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          const user = (request as any).user;
          return user?.id ? `agent-session:${user.id}` : (request.headers['cf-connecting-ip'] as string) || request.ip;
        }
      }
    },
    schema: {
      description: 'Create a new agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const body = createSessionSchema.parse(request.body);
      const session = await AgentOrchestrator.createSession(fastify.db, user.id, body as CreateSessionDTO);

      reply.status(201);
      return session;
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Get session details
  fastify.get('/sessions/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get agent session details',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    return session;
  });

  // Update session
  fastify.patch('/sessions/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    try {
      const body = updateSessionSchema.parse(request.body);
      const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      if (session.userId !== user.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Only allow updates on pending or paused sessions
      if (session.status !== 'pending' && session.status !== 'paused') {
        return reply.status(400).send({ error: 'Cannot update session in current status' });
      }

      const updates: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const values: any[] = [];

      if (body.name) {
        updates.push('name = ?');
        values.push(body.name);
      }

      if (body.config) {
        const newConfig = { ...session.config, ...body.config };
        updates.push('config = ?');
        values.push(JSON.stringify(newConfig));
      }

      if (updates.length > 0) {
        values.push(params.id);
        await fastify.db.execute(
          `UPDATE agent_sessions SET ${updates.join(', ')} WHERE id = ?`,
          values
        );
      }

      return await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Delete session
  fastify.delete('/sessions/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    // Cancel if running
    if (session.status === 'running' || session.status === 'paused') {
      await AgentOrchestrator.cancelSession(fastify.db, parseInt(params.id));
    }

    // Delete from database
    await fastify.db.execute('DELETE FROM agent_sessions WHERE id = ?', [params.id]);

    return { message: 'Session deleted' };
  });

  // Start session
  fastify.post('/sessions/:id/start', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Start agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await AgentOrchestrator.startSession(fastify.db, parseInt(params.id));

    return { message: 'Session started' };
  });

  // Pause session
  fastify.post('/sessions/:id/pause', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Pause agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await AgentOrchestrator.pauseSession(fastify.db, parseInt(params.id));

    return { message: 'Session paused' };
  });

  // Resume session
  fastify.post('/sessions/:id/resume', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Resume agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await AgentOrchestrator.resumeSession(fastify.db, parseInt(params.id));

    return { message: 'Session resumed' };
  });

  // Cancel session
  fastify.post('/sessions/:id/cancel', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Cancel agent session',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await AgentOrchestrator.cancelSession(fastify.db, parseInt(params.id));

    return { message: 'Session cancelled' };
  });

  // ==================== LOGS ====================

  // Get session logs
  fastify.get('/sessions/:id/logs', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get session logs',
      tags: ['agents'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          offset: { type: 'number' },
          logType: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const query = request.query as { limit?: string; offset?: string; logType?: string };

    const session = await AgentOrchestrator.getSession(fastify.db, parseInt(params.id));

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    return await AgentOrchestrator.getSessionLogs(fastify.db, parseInt(params.id), {
      limit: parseInt(query.limit || '100'),
      offset: parseInt(query.offset || '0'),
      logType: query.logType
    });
  });

  // Stream session logs (SSE)
  fastify.get('/sessions/:id/logs/stream', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Stream session logs via SSE',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const sessionId = parseInt(params.id);

    const session = await AgentOrchestrator.getSession(fastify.db, sessionId);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    // Set up SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial status
    reply.raw.write(`data: ${JSON.stringify({ type: 'status', status: session.status })}\n\n`);

    // Subscribe to session events
    const unsubscribe = AgentEventEmitter.subscribeToSession(sessionId, (event) => {
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

  // ==================== WORKTREE ====================

  // Get worktree status
  fastify.get('/sessions/:id/worktree', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get session worktree status',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const sessionId = parseInt(params.id);

    const session = await AgentOrchestrator.getSession(fastify.db, sessionId);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const worktree = await WorktreeManager.getWorktreeStatus(fastify.db, sessionId);

    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found for this session' });
    }

    return worktree;
  });

  // Merge worktree
  fastify.post('/sessions/:id/worktree/merge', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Merge worktree back to base branch',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const sessionId = parseInt(params.id);

    const session = await AgentOrchestrator.getSession(fastify.db, sessionId);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const worktree = await WorktreeManager.getWorktreeStatus(fastify.db, sessionId);

    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const result = await WorktreeManager.mergeWorktree(fastify.db, worktree.id);

    return result;
  });

  // ==================== CONFLICTS ====================

  // Get conflicts
  fastify.get('/sessions/:id/conflicts', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get merge conflicts',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const sessionId = parseInt(params.id);

    const session = await AgentOrchestrator.getSession(fastify.db, sessionId);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.userId !== user.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const worktree = await WorktreeManager.getWorktreeStatus(fastify.db, sessionId);

    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    // Get conflict file contents
    const conflicts = [];
    for (const filePath of worktree.conflictFiles) {
      try {
        const conflict = await WorktreeManager.getConflictContent(fastify.db, worktree.id, filePath);
        conflicts.push(conflict);
      } catch {
        conflicts.push({ path: filePath, error: 'Failed to get content' });
      }
    }

    return {
      worktreeId: worktree.id,
      status: worktree.status,
      conflicts
    };
  });

  // Resolve conflict
  fastify.post('/sessions/:id/conflicts/resolve', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Resolve a merge conflict',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const sessionId = parseInt(params.id);

    try {
      const body = resolveConflictSchema.parse(request.body);

      const session = await AgentOrchestrator.getSession(fastify.db, sessionId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      if (session.userId !== user.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const worktree = await WorktreeManager.getWorktreeStatus(fastify.db, sessionId);

      if (!worktree) {
        return reply.status(404).send({ error: 'Worktree not found' });
      }

      await WorktreeManager.resolveConflict(
        fastify.db,
        worktree.id,
        body.filePath,
        body.resolvedContent,
        body.tier,
        body.rationale,
        undefined,
        user.id
      );

      return { message: 'Conflict resolved', remainingConflicts: worktree.conflictFiles.length - 1 };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // ==================== TEMPLATES ====================

  // List templates
  fastify.get('/templates', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List agent templates',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const query = request.query as { category?: string };

    let sql = `SELECT t.*, m.model_id as model_name, m.display_name as model_display_name
               FROM agent_templates t
               LEFT JOIN ai_models m ON t.model_id = m.id
               WHERE (t.user_id = ? OR t.is_public = TRUE) AND t.is_active = TRUE`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [user.id];

    if (query.category) {
      sql += ' AND t.category = ?';
      params.push(query.category);
    }

    sql += ' ORDER BY t.is_public DESC, t.created_at DESC';

    const [rows] = await fastify.db.execute(sql, params);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    return (rows as any[]).map(row => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      modelId: row.model_id,
      modelName: row.model_name,
      modelDisplayName: row.model_display_name,
      systemPrompt: row.system_prompt,
      defaultConfig: row.default_config ? JSON.parse(row.default_config) : {},
      tools: row.tools ? JSON.parse(row.tools) : [],
      maxIterations: row.max_iterations,
      timeoutSeconds: row.timeout_seconds,
      category: row.category,
      isPublic: row.is_public,
      createdAt: row.created_at
    }));
  });

  // Create template
  fastify.post('/templates', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create agent template',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const body = createTemplateSchema.parse(request.body);

      const [result] = await fastify.db.execute(
        `INSERT INTO agent_templates
         (user_id, name, description, model_id, system_prompt, default_config, tools, max_iterations, timeout_seconds, category, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          body.name,
          body.description || null,
          body.modelId,
          body.systemPrompt,
          JSON.stringify(body.defaultConfig || {}),
          JSON.stringify(body.tools || []),
          body.maxIterations || 50,
          body.timeoutSeconds || 3600,
          body.category || 'custom',
          body.isPublic || false
        ]
      );

      reply.status(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      return { id: (result as any).insertId, message: 'Template created' };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Delete template
  fastify.delete('/templates/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete agent template',
      tags: ['agents'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    // Can only delete own templates
    const [result] = await fastify.db.execute(
      'UPDATE agent_templates SET is_active = FALSE WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    if ((result as any).affectedRows === 0) {
      return reply.status(404).send({ error: 'Template not found or access denied' });
    }

    return { message: 'Template deleted' };
  });
}
