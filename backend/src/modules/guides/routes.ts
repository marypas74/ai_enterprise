import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findOne, findMany } from '../../database/index.js';

interface GuidePageMeta {
  slug: string;
  title: string;
  description: string | null;
  updated_at: Date;
}

interface GuidePage extends GuidePageMeta {
  content: string;
}

/**
 * Read-only access to guide_pages for any authenticated user.
 * Admin write access stays under /api/admin/guides (admin-only).
 */
export async function userGuidesRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.get('/', {
    schema: {
      description: 'List available guide pages (metadata only)',
      tags: ['guides'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const role = (request.user as { role?: string }).role;
    const all = await findMany<GuidePageMeta>(
      fastify.db,
      `SELECT slug, title, description, updated_at
       FROM guide_pages
       ORDER BY slug ASC`
    );
    return role === 'admin' ? all : all.filter((g) => g.slug !== 'admin');
  });

  fastify.get('/:slug', {
    schema: {
      description: 'Get full guide content by slug (read-only)',
      tags: ['guides'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const role = (request.user as { role?: string }).role;
    if (slug === 'admin' && role !== 'admin') {
      return reply.status(403).send({ error: 'Admin guide requires admin role' });
    }
    const guide = await findOne<GuidePage>(
      fastify.db,
      `SELECT slug, title, description, content, updated_at
       FROM guide_pages
       WHERE slug = ?`,
      [slug]
    );
    if (!guide) return reply.status(404).send({ error: 'Guide not found' });
    return guide;
  });
}
