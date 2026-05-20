import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, updateOne } from '../../database/index.js';

const updateGuideSchema = z.object({
  content: z.string().min(1).max(5_000_000),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(500).optional(),
});

interface GuidePage {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
  updated_at: Date;
  created_at: Date;
}

export async function guideRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
      const user = request.user as { role: string };
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // List all guides (metadata only)
  fastify.get('/guides', {
    schema: {
      description: 'List all guide pages',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    return findMany<Omit<GuidePage, 'content'>>(
      fastify.db,
      `SELECT g.id, g.slug, g.title, g.description, g.updated_by_user_id,
              u.name as updated_by_name, g.updated_at, g.created_at
       FROM guide_pages g
       LEFT JOIN users u ON u.id = g.updated_by_user_id
       ORDER BY g.slug ASC`
    );
  });

  // Get single guide with content
  fastify.get('/guides/:slug', {
    schema: {
      description: 'Get guide page content',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const guide = await findOne<GuidePage>(
      fastify.db,
      `SELECT g.*, u.name as updated_by_name
       FROM guide_pages g
       LEFT JOIN users u ON u.id = g.updated_by_user_id
       WHERE g.slug = ?`,
      [slug]
    );
    if (!guide) return reply.status(404).send({ error: 'Guide not found' });
    return guide;
  });

  // Update guide content
  fastify.put('/guides/:slug', {
    schema: {
      description: 'Update guide page content',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const user = request.user as { id: number };

    let body: z.infer<typeof updateGuideSchema>;
    try {
      body = updateGuideSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: err.errors[0].message });
      }
      throw err;
    }

    // Build update fields
    const fields: string[] = ['content = ?', 'updated_by_user_id = ?'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [body.content, user.id];

    if (body.title) {
      fields.push('title = ?');
      params.push(body.title);
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      params.push(body.description);
    }

    params.push(slug);
    const affected = await updateOne(
      fastify.db,
      `UPDATE guide_pages SET ${fields.join(', ')} WHERE slug = ?`,
      params
    );

    if (affected === 0) return reply.status(404).send({ error: 'Guide not found' });

    fastify.log.info(`[Guides] Guide "${slug}" updated by user ${user.id}`);
    return { ok: true };
  });
}
