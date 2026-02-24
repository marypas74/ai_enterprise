import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  recall,
  getAllCollectionsInfo,
  wipeCollection,
  storeDeclarative,
  getUserRecallSettings,
  type MemoryCollection,
} from '../../services/VectorMemoryService.js';

export async function vectorMemoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', (fastify as any).authenticate);

  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string };
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  };

  // Semantic recall across all collections
  fastify.get('/recall', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const q = request.query as { text?: string; collections?: string; k?: string; threshold?: string };

    if (!q.text?.trim()) {
      return reply.status(400).send({ error: 'Query parameter "text" is required' });
    }

    const validCollections: MemoryCollection[] = ['episodic_memory', 'declarative_memory', 'procedural_memory'];
    const collections = q.collections
      ? (q.collections.split(',').filter(c => validCollections.includes(c as MemoryCollection)) as MemoryCollection[])
      : undefined;

    const settings = await getUserRecallSettings(fastify.db, user.id);

    const results = await recall(fastify.db, {
      userId: user.id,
      query: q.text,
      collections,
      episodicK: q.k ? Math.min(Math.max(parseInt(q.k) || 3, 1), 50) : settings.episodicK,
      episodicThreshold: q.threshold ? Math.min(Math.max(parseFloat(q.threshold) || 0.7, 0), 1) : settings.episodicThreshold,
      declarativeK: q.k ? Math.min(Math.max(parseInt(q.k) || 3, 1), 50) : settings.declarativeK,
      declarativeThreshold: q.threshold ? Math.min(Math.max(parseFloat(q.threshold) || 0.7, 0), 1) : settings.declarativeThreshold,
      proceduralK: q.k ? Math.min(Math.max(parseInt(q.k) || 3, 1), 50) : settings.proceduralK,
      proceduralThreshold: q.threshold ? Math.min(Math.max(parseFloat(q.threshold) || 0.7, 0), 1) : settings.proceduralThreshold,
    });

    const totalResults = results.episodic.length + results.declarative.length + results.procedural.length;
    return { results, total: totalResults };
  });

  // List collections with stats
  fastify.get('/collections', {
    onRequest: [adminOnly],
  }, async () => {
    const collections = await getAllCollectionsInfo();
    return { collections };
  });

  // Wipe a collection
  fastify.delete('/collections/:name', {
    onRequest: [adminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const validNames: MemoryCollection[] = ['episodic_memory', 'declarative_memory', 'procedural_memory'];

    if (!validNames.includes(name as MemoryCollection)) {
      return reply.status(400).send({ error: `Invalid collection. Must be one of: ${validNames.join(', ')}` });
    }

    const ok = await wipeCollection(name as MemoryCollection);
    if (!ok) {
      return reply.status(500).send({ error: 'Failed to wipe collection' });
    }

    return { success: true, message: `Collection ${name} wiped` };
  });

  // Store a fact/knowledge in declarative memory
  fastify.post('/declarative', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = request.body as { content: string; source?: string; metadata?: Record<string, any> };

    if (!body.content?.trim()) {
      return reply.status(400).send({ error: 'Content is required' });
    }

    const ok = await storeDeclarative(
      fastify.db,
      user.id,
      body.content,
      body.source || 'manual',
      body.metadata || {},
    );

    if (!ok) {
      return reply.status(500).send({ error: 'Failed to store in declarative memory (Qdrant may be unavailable)' });
    }

    return reply.status(201).send({ success: true, message: 'Stored in declarative memory' });
  });

  // Get user recall settings
  fastify.get('/recall-settings', async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const settings = await getUserRecallSettings(fastify.db, user.id);
    return { settings };
  });

  // Update user recall settings
  fastify.patch('/recall-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = request.body as Record<string, any>;

    const fields: string[] = [];
    const values: any[] = [];

    const mapping: Record<string, string> = {
      autoRagEnabled: 'auto_rag_enabled',
      episodicK: 'episodic_recall_k',
      episodicThreshold: 'episodic_recall_threshold',
      declarativeK: 'declarative_recall_k',
      declarativeThreshold: 'declarative_recall_threshold',
      proceduralK: 'procedural_recall_k',
      proceduralThreshold: 'procedural_recall_threshold',
    };

    for (const [jsKey, dbKey] of Object.entries(mapping)) {
      if (body[jsKey] !== undefined) {
        fields.push(`${dbKey} = ?`);
        values.push(body[jsKey]);
      }
    }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' });
    }

    // Upsert
    const existing = await import('../../database/index.js').then(m => m.findOne(fastify.db, 'SELECT user_id FROM memory_settings WHERE user_id = ?', [user.id]));
    if (existing) {
      values.push(user.id);
      await fastify.db.execute(`UPDATE memory_settings SET ${fields.join(', ')} WHERE user_id = ?`, values);
    } else {
      await fastify.db.execute(
        `INSERT INTO memory_settings (user_id, auto_rag_enabled, episodic_recall_k, episodic_recall_threshold, declarative_recall_k, declarative_recall_threshold, procedural_recall_k, procedural_recall_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [user.id, body.autoRagEnabled ?? false, body.episodicK ?? 3, body.episodicThreshold ?? 0.7, body.declarativeK ?? 3, body.declarativeThreshold ?? 0.7, body.proceduralK ?? 3, body.proceduralThreshold ?? 0.7],
      );
    }

    const settings = await getUserRecallSettings(fastify.db, user.id);
    return { settings, message: 'Settings updated' };
  });
}
