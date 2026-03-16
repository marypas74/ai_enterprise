import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eventBus } from '../../services/EventBusService.js';
import { requireAdmin } from '../../middleware/index.js';

// Validation schemas
const toggleHandlerSchema = z.object({
  enabled: z.boolean(),
});

const toggleTracingSchema = z.object({
  enabled: z.boolean(),
});

export async function hookRoutes(fastify: FastifyInstance) {

  // List all hooks and their handlers
  fastify.get('/hooks', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async () => {
    return {
      available_hooks: eventBus.getAvailableHooks(),
      registered_handlers: eventBus.getRegisteredHandlers(),
    };
  });

  // Toggle a handler enabled/disabled
  fastify.patch('/hooks/handlers/:handlerId/toggle', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { handlerId } = request.params as { handlerId: string };
    const { enabled } = toggleHandlerSchema.parse(request.body);

    const toggled = eventBus.toggleHandler(handlerId, enabled);
    if (!toggled) {
      return reply.status(404).send({ error: 'Handler not found' });
    }

    return { success: true, handler_id: handlerId, enabled };
  });

  // ---- Hook Execution Tracing ----

  // Get trace status
  fastify.get('/hooks/trace', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async () => {
    return {
      enabled: eventBus.isTracingEnabled(),
      stats: eventBus.getTraceStats(),
    };
  });

  // Toggle tracing on/off
  fastify.post('/hooks/trace/toggle', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request: FastifyRequest) => {
    const { enabled } = toggleTracingSchema.parse(request.body);
    eventBus.setTracing(enabled);
    return { enabled, message: enabled ? 'Hook tracing enabled' : 'Hook tracing disabled' };
  });

  // Get trace log
  fastify.get('/hooks/trace/log', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async (request: FastifyRequest) => {
    const { limit } = request.query as { limit?: string };
    const entries = eventBus.getTraceLog(limit ? parseInt(limit) : 100);
    return { entries, total: entries.length };
  });

  // Clear trace log
  fastify.delete('/hooks/trace/log', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
  }, async () => {
    eventBus.clearTraceLog();
    return { message: 'Trace log cleared' };
  });
}
