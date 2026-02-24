/**
 * URL Ingestion Routes — Scrape URLs and store in vector memory
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findMany } from '../../database/index.js';
import { ingestUrl } from '../../services/WebScraperService.js';

export async function ingestionRoutes(fastify: FastifyInstance) {
  // Ingest a URL into declarative memory
  fastify.post('/url', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Ingest a URL into vector memory',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { url, conversationId } = request.body as { url: string; conversationId?: number };

    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'URL is required' });
    }

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

    const result = await ingestUrl(fastify.db, user.id, url, conversationId);
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
}
