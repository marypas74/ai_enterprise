import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MemoryService } from './service.js';
import { WorkingMemoryService } from '../../services/WorkingMemoryService.js';

// Validation schemas
const createObservationSchema = z.object({
  content: z.string().min(1).max(5000),
  observation_type: z.enum(['insight', 'decision', 'pattern', 'error', 'preference', 'fact', 'manual']).default('manual'),
  conversation_id: z.number().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  importance: z.number().min(1).max(10).default(5)
});

const updateObservationSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  observation_type: z.enum(['insight', 'decision', 'pattern', 'error', 'preference', 'fact', 'manual']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  importance: z.number().min(1).max(10).optional(),
  is_archived: z.boolean().optional()
});

const updateSettingsSchema = z.object({
  auto_capture: z.boolean().optional(),
  inject_context: z.boolean().optional(),
  max_context_observations: z.number().min(1).max(50).optional(),
  importance_threshold: z.number().min(1).max(10).optional(),
  retention_days: z.number().min(1).max(3650).optional()
});

const bulkActionSchema = z.object({
  ids: z.array(z.number()).min(1).max(100),
  action: z.enum(['archive', 'delete'])
});

export async function memoryRoutes(fastify: FastifyInstance) {
  const memoryService = new MemoryService(fastify.db);

  // Make memory service available to other modules
  fastify.decorate('memoryService', memoryService);

  // All routes require authentication
  fastify.addHook('onRequest', (fastify as any).authenticate);

  // --- Observations ---

  // Create observation
  fastify.post('/observations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = createObservationSchema.parse(request.body);

    const id = await memoryService.captureObservation(
      user.id,
      body.content,
      body.observation_type,
      body.conversation_id,
      undefined,
      body.tags,
      body.importance
    );

    return reply.status(201).send({ id, message: 'Observation saved' });
  });

  // List observations with filters
  fastify.get('/observations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const query = request.query as {
      type?: string;
      archived?: string;
      min_importance?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };

    const observations = await memoryService.searchMemories(user.id, '', {
      observation_type: query.type,
      is_archived: query.archived === 'true' ? true : query.archived === 'false' ? false : undefined,
      min_importance: query.min_importance ? parseInt(query.min_importance) : undefined,
      from_date: query.from,
      to_date: query.to,
      limit: query.limit ? parseInt(query.limit) : 50,
      offset: query.offset ? parseInt(query.offset) : 0
    });

    return reply.send({ observations });
  });

  // Search observations (full-text)
  fastify.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const query = request.query as { q: string; type?: string; limit?: string };

    if (!query.q || !query.q.trim()) {
      return reply.status(400).send({ error: 'Query parameter q is required' });
    }

    const results = await memoryService.searchMemories(user.id, query.q, {
      observation_type: query.type,
      is_archived: false,
      limit: query.limit ? parseInt(query.limit) : 20
    });

    return reply.send({ results });
  });

  // Get single observation
  fastify.get('/observations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const observation = await memoryService.getObservation(user.id, parseInt(params.id));
    if (!observation) {
      return reply.status(404).send({ error: 'Observation not found' });
    }

    return reply.send({ observation });
  });

  // Update observation
  fastify.patch('/observations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const body = updateObservationSchema.parse(request.body);

    const updated = await memoryService.updateObservation(user.id, parseInt(params.id), body);
    if (!updated) {
      return reply.status(404).send({ error: 'Observation not found or no changes' });
    }

    return reply.send({ message: 'Observation updated' });
  });

  // Delete observation
  fastify.delete('/observations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const deleted = await memoryService.deleteObservation(user.id, parseInt(params.id));
    if (!deleted) {
      return reply.status(404).send({ error: 'Observation not found' });
    }

    return reply.send({ message: 'Observation deleted' });
  });

  // Bulk actions (archive/delete)
  fastify.post('/observations/bulk', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = bulkActionSchema.parse(request.body);

    let affected: number;
    if (body.action === 'archive') {
      affected = await memoryService.bulkArchive(user.id, body.ids);
    } else {
      affected = await memoryService.bulkDelete(user.id, body.ids);
    }

    return reply.send({ affected, message: `${affected} observations ${body.action}d` });
  });

  // --- Context ---

  // Get memory context for new chat
  fastify.get('/context', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const context = await memoryService.getContextForNewChat(user.id);
    return reply.send({ context, has_context: context !== null });
  });

  // --- Summaries ---

  // List conversation summaries
  fastify.get('/summaries', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const query = request.query as { limit?: string; offset?: string };

    const summaries = await memoryService.getSummaries(
      user.id,
      query.limit ? parseInt(query.limit) : 20,
      query.offset ? parseInt(query.offset) : 0
    );

    return reply.send({ summaries });
  });

  // --- Settings ---

  // Get memory settings
  fastify.get('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const settings = await memoryService.getSettings(user.id);
    return reply.send({ settings });
  });

  // Update memory settings
  fastify.patch('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = updateSettingsSchema.parse(request.body);

    await memoryService.updateSettings(user.id, body);
    const settings = await memoryService.getSettings(user.id);

    return reply.send({ settings, message: 'Settings updated' });
  });

  // --- Stats ---

  // Get memory statistics
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const stats = await memoryService.getStats(user.id);
    return reply.send({ stats });
  });

  // --- Working Memory ---

  const wmService = new WorkingMemoryService(fastify);

  // Get working memory for a specific conversation
  fastify.get('/working/:conversationId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { conversationId } = request.params as { conversationId: string };
    const state = await wmService.get(user.id, parseInt(conversationId));
    if (!state) {
      return reply.status(404).send({ error: 'No active working memory for this conversation' });
    }
    return {
      state,
      tokenUsage: wmService.getSessionTokens(state),
    };
  });

  // List all active working memory sessions for current user
  fastify.get('/working', async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const sessions = await wmService.listUserSessions(user.id);
    return { sessions };
  });

  // Clear working memory for a specific conversation
  fastify.delete('/working/:conversationId', async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const { conversationId } = request.params as { conversationId: string };
    await wmService.clear(user.id, parseInt(conversationId));
    return { message: 'Working memory cleared' };
  });

  // Clear all working memory sessions for current user
  fastify.delete('/working', async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const cleared = await wmService.clearAllUserSessions(user.id);
    return { cleared, message: `${cleared} sessions cleared` };
  });

  // Admin: get working memory stats across all users
  fastify.get('/working-stats', {
    onRequest: [async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { role: string };
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }],
  }, async () => {
    const stats = await wmService.getStats();
    return { stats };
  });
}
