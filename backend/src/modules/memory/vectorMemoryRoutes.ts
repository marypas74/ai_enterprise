import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  recall,
  getAllCollectionsInfo,
  wipeCollection,
  storeDeclarative,
  getUserRecallSettings,
  type MemoryCollection,
} from '../../services/VectorMemoryService.js';
import { HyDEService } from '../../services/HyDEService.js';
import { ClassificationService } from '../../services/ClassificationService.js';
import { requireAdmin } from '../../middleware/index.js';

// Validation schemas
const storeDeclarativeSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const updateRecallSettingsSchema = z.object({
  autoRagEnabled: z.boolean().optional(),
  episodicK: z.number().optional(),
  episodicThreshold: z.number().optional(),
  declarativeK: z.number().optional(),
  declarativeThreshold: z.number().optional(),
  proceduralK: z.number().optional(),
  proceduralThreshold: z.number().optional(),
});

const hydeConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxTokens: z.number().optional(),
  maxQueryLength: z.number().optional(),
});

const classifySchema = z.object({
  text: z.string().min(1),
  labels: z.record(z.array(z.string())),
  threshold: z.number().optional(),
  multi: z.boolean().optional(),
});

export async function vectorMemoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', (fastify as any).authenticate);


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
    onRequest: [requireAdmin],
  }, async () => {
    const collections = await getAllCollectionsInfo();
    return { collections };
  });

  // Wipe a collection
  fastify.delete('/collections/:name', {
    onRequest: [requireAdmin],
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

    let body: z.infer<typeof storeDeclarativeSchema>;
    try {
      body = storeDeclarativeSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
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

    let body: z.infer<typeof updateRecallSettingsSchema>;
    try {
      body = updateRecallSettingsSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

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

    const bodyRecord = body as Record<string, any>;
    for (const [jsKey, dbKey] of Object.entries(mapping)) {
      if (bodyRecord[jsKey] !== undefined) {
        fields.push(`${dbKey} = ?`);
        values.push(bodyRecord[jsKey]);
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

  // ==========================================
  // HyDE (Hypothetical Document Embeddings)
  // ==========================================

  // Get HyDE config
  fastify.get('/hyde', {
    onRequest: [requireAdmin],
  }, async () => {
    const hyde = new HyDEService(fastify, fastify.db);
    await hyde.loadConfig();
    return { config: hyde.getConfig() };
  });

  // Update HyDE config
  fastify.patch('/hyde', {
    onRequest: [requireAdmin],
  }, async (request: FastifyRequest) => {
    const body = hydeConfigSchema.parse(request.body);
    const hyde = new HyDEService(fastify, fastify.db);
    await hyde.loadConfig();
    await hyde.saveConfig(body);
    // Re-register hook with new config
    hyde.registerHook();
    return { config: hyde.getConfig(), message: 'HyDE config updated' };
  });

  // ==========================================
  // Classification
  // ==========================================

  // Classify text against labeled examples
  fastify.post('/classify', async (request: FastifyRequest, reply: FastifyReply) => {
    let body: z.infer<typeof classifySchema>;
    try {
      body = classifySchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    const classifier = new ClassificationService(fastify, fastify.db);

    if (body.multi) {
      const results = await classifier.classifyMulti(body.text, body.labels, body.threshold ?? 0.5);
      return { results };
    }

    const result = await classifier.classify(body.text, body.labels, body.threshold ?? 0.5);
    return result;
  });

  // ==========================================
  // Recall Analytics (Admin)
  // ==========================================

  // Get recall quality statistics
  fastify.get('/recall-stats', {
    onRequest: [requireAdmin],
  }, async (request: FastifyRequest) => {
    const q = request.query as { days?: string };
    const days = parseInt(q.days || '7', 10);

    // Overall stats
    const [overallRows] = await fastify.db.execute(
      `SELECT
         COUNT(*) as total_queries,
         ROUND(AVG(avg_score), 3) as mean_score,
         ROUND(AVG(episodic_count), 1) as avg_episodic,
         ROUND(AVG(declarative_count), 1) as avg_declarative,
         ROUND(AVG(procedural_count), 1) as avg_procedural,
         SUM(hyde_used) as hyde_count,
         SUM(reranked) as reranked_count
       FROM recall_log
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days],
    );
    const overall = (overallRows as any[])[0] || {};

    // Daily breakdown
    const [dailyRows] = await fastify.db.execute(
      `SELECT
         DATE(created_at) as date,
         COUNT(*) as queries,
         ROUND(AVG(avg_score), 3) as avg_score,
         ROUND(AVG(episodic_count + declarative_count + procedural_count), 1) as avg_results
       FROM recall_log
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [days],
    );

    // Top users by recall usage
    const [userRows] = await fastify.db.execute(
      `SELECT
         rl.user_id,
         u.name as user_name,
         COUNT(*) as query_count,
         ROUND(AVG(rl.avg_score), 3) as avg_score
       FROM recall_log rl
       LEFT JOIN users u ON rl.user_id = u.id
       WHERE rl.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY rl.user_id, u.name
       ORDER BY query_count DESC
       LIMIT 10`,
      [days],
    );

    // Low-quality queries (score < 0.5)
    const [lowQualityRows] = await fastify.db.execute(
      `SELECT query, avg_score, episodic_count, declarative_count, procedural_count, created_at
       FROM recall_log
       WHERE avg_score > 0 AND avg_score < 0.5
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY avg_score ASC
       LIMIT 20`,
      [days],
    );

    return {
      period: `${days} days`,
      overall,
      daily: dailyRows,
      topUsers: userRows,
      lowQualityQueries: lowQualityRows,
    };
  });

  // Get MCP server status (admin)
  fastify.get('/mcp-status', {
    onRequest: [requireAdmin],
  }, async () => {
    try {
      const { MCPClientManager } = await import('../../services/MCPClientManager.js');
      const manager = MCPClientManager.getInstance();
      return {
        servers: manager.getStatus(),
        totalTools: manager.getAllTools().length,
      };
    } catch {
      return { servers: [], totalTools: 0 };
    }
  });
}
