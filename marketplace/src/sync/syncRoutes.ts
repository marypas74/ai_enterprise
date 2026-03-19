import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../database/connection.js';
import { findOne, execute } from '../database/helpers.js';
import { SyncEngine } from './SyncEngine.js';
import { HealthChecker } from './HealthChecker.js';
import { CLIAdapter } from './CLIAdapter.js';
import { NotificationService } from './NotificationService.js';
import { QdrantClient } from '../qdrant/QdrantClient.js';
import { EmbeddingIndexer } from '../qdrant/EmbeddingIndexer.js';
import { config } from '../config.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const notificationsQuerySchema = z.object({
  since: z.coerce.date().optional(),
});

interface SyncStateRow {
  status: string;
  last_sync_at: Date | null;
  items_added: number;
  items_updated: number;
  items_removed: number;
  consecutive_failures: number;
  error_message: string | null;
}

export async function syncRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = getPool();
  const healthChecker = new HealthChecker();
  const adapter = new CLIAdapter();
  const qdrantClient = new QdrantClient(config.qdrantUrl);
  const embeddingIndexer = new EmbeddingIndexer(pool, qdrantClient, config.backendUrl, config.serviceToken);
  const syncEngine = new SyncEngine(pool, adapter, healthChecker, embeddingIndexer);
  const notificationService = new NotificationService(pool);

  // POST /sync — Admin only, triggers sync
  fastify.post('/sync', {
    preHandler: [fastify.authenticateAdmin],
    config: {
      rateLimit: {
        max: 1,
        timeWindow: '5 minutes',
      },
    },
  }, async (_request, reply) => {
    try {
      const result = await syncEngine.sync();
      return {
        success: true,
        data: result,
        error: null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });

  // GET /sync/status — Admin only, returns latest sync state
  fastify.get('/sync/status', {
    preHandler: [fastify.authenticateAdmin],
  }, async (_request, _reply) => {
    const row = await findOne<SyncStateRow>(
      pool,
      'SELECT status, last_sync_at, items_added, items_updated, items_removed, consecutive_failures, error_message FROM marketplace_sync_state WHERE id = 1',
    );

    if (!row) {
      return {
        success: true,
        data: {
          status: 'never_synced',
          last_sync_at: null,
          items_added: 0,
          items_updated: 0,
          items_removed: 0,
          consecutive_failures: 0,
          error_message: null,
        },
        error: null,
      };
    }

    return {
      success: true,
      data: row,
      error: null,
    };
  });

  // PATCH /sync/resume — Admin only, resumes suspended sync
  fastify.patch('/sync/resume', {
    preHandler: [fastify.authenticateAdmin],
  }, async (_request, _reply) => {
    healthChecker.resume();

    await execute(
      pool,
      'UPDATE marketplace_sync_state SET consecutive_failures = 0, status = ? WHERE id = 1',
      ['idle'],
    );

    return {
      success: true,
      data: { resumed: true },
      error: null,
    };
  });

  // GET /sync/notifications — Authenticated users, returns new items count
  fastify.get('/sync/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = notificationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const since = parsed.data.since ?? new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
    const result = await notificationService.getNewItemsSince(since);

    return {
      success: true,
      data: result,
      error: null,
    };
  });
}
