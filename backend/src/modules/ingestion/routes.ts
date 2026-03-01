/**
 * Ingestion Routes — Enhanced "Rabbit Hole" pipeline
 *
 * Scrape URLs, ingest files/text, export/import vector memory.
 * Uses hookable pipeline via RabbitHoleService.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findMany } from '../../database/index.js';
import { scrapeUrl } from '../../services/WebScraperService.js';
import { RabbitHoleService } from '../../services/RabbitHoleService.js';

// Validation schemas
const ingestUrlSchema = z.object({
  url: z.string().min(1),
  conversationId: z.number().optional(),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
});

const ingestTextSchema = z.object({
  text: z.string().min(30),
  title: z.string().min(1),
  conversationId: z.number().optional(),
});

const importMemorySchema = z.object({
  points: z.array(z.any()).min(1),
});

export async function ingestionRoutes(fastify: FastifyInstance) {
  // Ingest a URL into declarative memory (hookable pipeline)
  fastify.post('/url', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Ingest a URL into vector memory via Rabbit Hole pipeline',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    let body: z.infer<typeof ingestUrlSchema>;
    try {
      body = ingestUrlSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    const { url, conversationId, chunkSize, chunkOverlap } = body;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: 'Invalid URL format' });
    }

    // Block private/internal URLs (SSRF protection)
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return reply.status(400).send({ error: 'Private/internal URLs are not allowed' });
    }

    try {
      // Scrape the URL
      const scraped = await scrapeUrl(url);

      // Ingest via Rabbit Hole pipeline
      const rabbitHole = new RabbitHoleService(fastify, fastify.db);
      const result = await rabbitHole.ingest(scraped.content, scraped.title, {
        userId: user.id,
        conversationId,
        source: url,
        sourceType: 'url',
        chunkSize,
        chunkOverlap,
        metadata: { title: scraped.title, source_type: 'web' },
      });

      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Ingest raw text
  fastify.post('/text', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Ingest raw text into vector memory',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    let body: z.infer<typeof ingestTextSchema>;
    try {
      body = ingestTextSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    const { text, title, conversationId } = body;

    const rabbitHole = new RabbitHoleService(fastify, fastify.db);
    const result = await rabbitHole.ingestText(text, title, user.id, conversationId);
    return result;
  });

  // List ingestion history
  fastify.get('/history', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List URL ingestion history',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit || '20') || 20, 100);
    const offset = parseInt(query.offset || '0') || 0;

    return findMany(
      fastify.db,
      `SELECT id, url, title, status, chunks_count, content_length, error, created_at
       FROM web_ingestions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user.id, limit, offset],
    );
  });

  // ---- Memory Export/Import ----

  // Export a collection
  fastify.get('/memory/export/:collection', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Export vector memory collection as JSON',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { collection } = request.params as { collection: string };

    const valid = ['episodic_memory', 'declarative_memory', 'procedural_memory'];
    if (!valid.includes(collection)) {
      return reply.status(400).send({ error: `Invalid collection. Must be one of: ${valid.join(', ')}` });
    }

    const rabbitHole = new RabbitHoleService(fastify, fastify.db);
    const exported = await rabbitHole.exportMemory(collection as any, user.id);

    reply.header('Content-Disposition', `attachment; filename="${collection}_export.json"`);
    reply.header('Content-Type', 'application/json');
    return exported;
  });

  // Import into a collection
  fastify.post('/memory/import/:collection', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Import vector memory from JSON',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { collection } = request.params as { collection: string };

    const valid = ['episodic_memory', 'declarative_memory', 'procedural_memory'];
    if (!valid.includes(collection)) {
      return reply.status(400).send({ error: `Invalid collection. Must be one of: ${valid.join(', ')}` });
    }

    let body: z.infer<typeof importMemorySchema>;
    try {
      body = importMemorySchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    const rabbitHole = new RabbitHoleService(fastify, fastify.db);
    const result = await rabbitHole.importMemory(collection as any, body.points);
    return { ...result, collection };
  });
}
