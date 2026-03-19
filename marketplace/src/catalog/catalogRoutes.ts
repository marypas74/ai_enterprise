import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CatalogService } from './CatalogService.js';
import { getPool } from '../database/connection.js';
import { QdrantClient } from '../qdrant/QdrantClient.js';
import { config } from '../config.js';

const listQuerySchema = z.object({
  type: z.enum(['skill', 'agent', 'mcp', 'hook']).optional(),
  tier: z.enum(['tier1', 'tier2', 'tier3']).optional(),
  category: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
});

export async function catalogRoutes(fastify: FastifyInstance): Promise<void> {
  const qdrantClient = new QdrantClient(config.qdrantUrl);
  const service = new CatalogService(getPool(), qdrantClient, config.backendUrl, config.serviceToken);

  fastify.get('/catalog', {
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

    const { page, limit, ...filters } = parsed.data;
    const result = await service.list({ ...filters, page, limit });

    return {
      success: true,
      data: result.items,
      error: null,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  });

  fastify.get('/catalog/search', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const results = await service.search(parsed.data.q);

    return {
      success: true,
      data: results,
      error: null,
    };
  });

  fastify.get('/catalog/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'Invalid catalog item ID',
      });
    }

    const item = await service.getById(parsed.data.id);
    if (!item) {
      return reply.status(404).send({
        success: false,
        data: null,
        error: 'Catalog item not found',
      });
    }

    return {
      success: true,
      data: item,
      error: null,
    };
  });
}
