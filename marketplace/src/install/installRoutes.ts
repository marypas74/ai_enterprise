import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InstallService } from './InstallService.js';
import { getPool } from '../database/connection.js';

const installBodySchema = z.object({
  catalogItemId: z.number().int().min(1),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function installRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new InstallService(getPool());

  fastify.post('/install', {
    preHandler: [fastify.authenticate],
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const parsed = installBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const userId = request.user.id;

    try {
      const result = await service.install(parsed.data.catalogItemId, userId);
      return reply.status(201).send({
        success: true,
        data: result,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Installation failed';
      const status = message.includes('not found') ? 404
        : message.includes('already installed') ? 409
        : message.includes('limit') ? 429
        : 500;
      return reply.status(status).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });

  fastify.delete('/install/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'Invalid installation ID',
      });
    }

    const userId = request.user.id;

    try {
      await service.uninstall(parsed.data.id, userId);
      return { success: true, data: null, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Uninstall failed';
      const status = message.includes('not found') ? 404 : 500;
      return reply.status(status).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });

  fastify.get('/install', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const userId = request.user.id;
    const { page, limit } = parsed.data;
    const result = await service.listByUser(userId, page, limit);

    return {
      success: true,
      data: result.items,
      error: null,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  });

  fastify.get('/install/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'Invalid installation ID',
      });
    }

    const installation = await service.getInstallation(parsed.data.id);
    if (!installation) {
      return reply.status(404).send({
        success: false,
        data: null,
        error: 'Installation not found',
      });
    }

    return {
      success: true,
      data: installation,
      error: null,
    };
  });
}
