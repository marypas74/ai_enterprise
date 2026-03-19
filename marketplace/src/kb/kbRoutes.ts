import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KBService } from './KBService.js';
import { getPool } from '../database/connection.js';
import { QdrantClient } from '../qdrant/QdrantClient.js';
import { config } from '../config.js';

const installationIdParamSchema = z.object({
  installationId: z.coerce.number().int().min(1),
});

const docIdParamSchema = z.object({
  docId: z.coerce.number().int().min(1),
});

const indexDocumentBodySchema = z.object({
  documentName: z.string().min(1).max(255),
  content: z.string().min(1).max(1_000_000),
});

const searchBodySchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional().default(5),
});

export async function kbRoutes(fastify: FastifyInstance): Promise<void> {
  const qdrantClient = new QdrantClient(config.qdrantUrl);
  const service = new KBService(getPool(), qdrantClient, config.backendUrl, config.jwtSecret);

  fastify.post('/kb/:installationId/documents', {
    preHandler: [fastify.authenticate],
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const paramsParsed = installationIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: paramsParsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const bodyParsed = indexDocumentBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: bodyParsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    try {
      const docId = await service.indexDocument(
        paramsParsed.data.installationId,
        bodyParsed.data.documentName,
        bodyParsed.data.content,
      );

      return reply.status(201).send({
        success: true,
        data: { id: docId },
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Indexing failed';
      return reply.status(500).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });

  fastify.get('/kb/:installationId/documents', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = installationIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const documents = await service.listDocuments(parsed.data.installationId);

    return {
      success: true,
      data: documents,
      error: null,
    };
  });

  fastify.delete('/kb/documents/:docId', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = docIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'Invalid document ID',
      });
    }

    try {
      await service.removeDocument(parsed.data.docId);
      return { success: true, data: null, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Removal failed';
      const status = message.includes('not found') ? 404 : 500;
      return reply.status(status).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });

  fastify.post('/kb/:installationId/search', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const paramsParsed = installationIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: paramsParsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const bodyParsed = searchBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: bodyParsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    try {
      const results = await service.searchKB(
        paramsParsed.data.installationId,
        bodyParsed.data.query,
        bodyParsed.data.limit,
      );

      return {
        success: true,
        data: results,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      return reply.status(500).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });
}
