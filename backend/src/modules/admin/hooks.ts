import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventBus } from '../../services/EventBusService.js';

export async function hookRoutes(fastify: FastifyInstance) {
  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string };
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  };

  // List all hooks and their handlers
  fastify.get('/hooks', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async () => {
    return {
      available_hooks: eventBus.getAvailableHooks(),
      registered_handlers: eventBus.getRegisteredHandlers(),
    };
  });

  // Toggle a handler enabled/disabled
  fastify.patch('/hooks/handlers/:handlerId/toggle', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { handlerId } = request.params as { handlerId: string };
    const { enabled } = request.body as { enabled: boolean };

    const toggled = eventBus.toggleHandler(handlerId, enabled);
    if (!toggled) {
      return reply.status(404).send({ error: 'Handler not found' });
    }

    return { success: true, handler_id: handlerId, enabled };
  });

  // ---- Hook Execution Tracing ----

  // Get trace status
  fastify.get('/hooks/trace', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async () => {
    return {
      enabled: eventBus.isTracingEnabled(),
      stats: eventBus.getTraceStats(),
    };
  });

  // Toggle tracing on/off
  fastify.post('/hooks/trace/toggle', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request: FastifyRequest) => {
    const { enabled } = request.body as { enabled: boolean };
    eventBus.setTracing(enabled);
    return { enabled, message: enabled ? 'Hook tracing enabled' : 'Hook tracing disabled' };
  });

  // Get trace log
  fastify.get('/hooks/trace/log', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async (request: FastifyRequest) => {
    const { limit } = request.query as { limit?: string };
    const entries = eventBus.getTraceLog(limit ? parseInt(limit) : 100);
    return { entries, total: entries.length };
  });

  // Clear trace log
  fastify.delete('/hooks/trace/log', {
    onRequest: [(fastify as any).authenticate, adminOnly],
  }, async () => {
    eventBus.clearTraceLog();
    return { message: 'Trace log cleared' };
  });
}
