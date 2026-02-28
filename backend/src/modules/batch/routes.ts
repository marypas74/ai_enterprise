/**
 * Batch Processing Routes — Anthropic Batch API endpoints
 * Submit, monitor, and retrieve batch job results.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { insertOne, findOne, findMany } from '../../database/index.js';
import { submitBatch, getBatchStatus, cancelBatch } from '../../services/BatchProcessingService.js';
import { decryptSecret } from '../../utils/crypto.js';

const submitSchema = z.object({
  requests: z.array(z.object({
    customId: z.string(),
    model: z.string(),
    messages: z.array(z.any()),
    system: z.string().optional(),
    maxTokens: z.number().optional(),
  })).min(1).max(100000),
});

export async function batchRoutes(fastify: FastifyInstance) {
  // Submit a batch job
  fastify.post('/submit', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = submitSchema.parse(request.body);

    // Get Anthropic API key from DB
    const providerRow = await findOne<any>(
      fastify.db,
      `SELECT ps.setting_value FROM ai_provider_settings ps
       JOIN ai_providers p ON ps.provider_id = p.id
       WHERE p.provider_type = 'anthropic' AND ps.setting_key = 'api_key' LIMIT 1`
    );

    if (!providerRow?.setting_value) {
      return reply.status(400).send({ error: 'Anthropic API key not configured' });
    }

    const apiKey = decryptSecret(providerRow.setting_value);

    try {
      const batchId = await submitBatch(apiKey, body.requests);

      await insertOne(
        fastify.db,
        `INSERT INTO batch_jobs (user_id, batch_id, model, total_requests)
         VALUES (?, ?, ?, ?)`,
        [user.id, batchId, body.requests[0].model, body.requests.length]
      );

      return reply.send({ success: true, batchId, totalRequests: body.requests.length });
    } catch (error: any) {
      fastify.log.error(`[Batch] Submit failed: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  // Get batch job status
  fastify.get('/:batchId/status', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { batchId } = request.params as { batchId: string };

    // Verify ownership
    const job = await findOne<any>(
      fastify.db,
      'SELECT * FROM batch_jobs WHERE batch_id = ? AND user_id = ?',
      [batchId, user.id]
    );

    if (!job) {
      return reply.status(404).send({ error: 'Batch job not found' });
    }

    // Get Anthropic API key
    const providerRow = await findOne<any>(
      fastify.db,
      `SELECT ps.setting_value FROM ai_provider_settings ps
       JOIN ai_providers p ON ps.provider_id = p.id
       WHERE p.provider_type = 'anthropic' AND ps.setting_key = 'api_key' LIMIT 1`
    );

    if (!providerRow?.setting_value) {
      return reply.status(400).send({ error: 'Anthropic API key not configured' });
    }

    const apiKey = decryptSecret(providerRow.setting_value);

    try {
      const status = await getBatchStatus(apiKey, batchId);

      // Update local DB with latest status
      await fastify.db.execute(
        `UPDATE batch_jobs SET status = ?, succeeded = ?, errored = ?,
         ended_at = ? WHERE batch_id = ?`,
        [
          status.processing_status === 'ended' ? 'ended' : 'in_progress',
          status.request_counts.succeeded,
          status.request_counts.errored,
          status.ended_at || null,
          batchId,
        ]
      );

      return reply.send({ success: true, ...status });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Cancel a batch job
  fastify.post('/:batchId/cancel', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { batchId } = request.params as { batchId: string };

    const job = await findOne<any>(
      fastify.db,
      'SELECT * FROM batch_jobs WHERE batch_id = ? AND user_id = ?',
      [batchId, user.id]
    );

    if (!job) {
      return reply.status(404).send({ error: 'Batch job not found' });
    }

    const providerRow = await findOne<any>(
      fastify.db,
      `SELECT ps.setting_value FROM ai_provider_settings ps
       JOIN ai_providers p ON ps.provider_id = p.id
       WHERE p.provider_type = 'anthropic' AND ps.setting_key = 'api_key' LIMIT 1`
    );

    if (!providerRow?.setting_value) {
      return reply.status(400).send({ error: 'Anthropic API key not configured' });
    }

    const apiKey = decryptSecret(providerRow.setting_value);

    try {
      const status = await cancelBatch(apiKey, batchId);
      await fastify.db.execute(
        `UPDATE batch_jobs SET status = 'canceling' WHERE batch_id = ?`,
        [batchId]
      );
      return reply.send({ success: true, ...status });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // List user's batch jobs
  fastify.get('/', {
    onRequest: [(fastify as any).authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    const jobs = await findMany<any>(
      fastify.db,
      'SELECT * FROM batch_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [user.id]
    );

    return reply.send({ success: true, jobs });
  });
}
