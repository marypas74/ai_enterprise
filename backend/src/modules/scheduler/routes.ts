/**
 * Scheduler Routes — "White Rabbit" admin API
 *
 * CRUD for scheduled jobs + execution history.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WhiteRabbitService } from '../../services/WhiteRabbitService.js';

export async function schedulerRoutes(fastify: FastifyInstance) {
  const scheduler = new WhiteRabbitService(fastify, fastify.db);

  // Start the scheduler on server ready
  fastify.ready().then(() => {
    scheduler.start().catch(err =>
      fastify.log.warn(`[WhiteRabbit] Failed to start scheduler: ${err.message}`),
    );
  });

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    scheduler.stop();
  });

  // List all jobs (admin)
  fastify.get('/jobs', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'List scheduled jobs', tags: ['scheduler'], security: [{ bearerAuth: [] }] },
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number; role: string };
    const query = request.query as { status?: string };

    const jobs = await scheduler.listJobs(
      user.role === 'admin' ? undefined : user.id,
      query.status as any || undefined,
    );
    return { jobs };
  });

  // Create a job
  fastify.post('/jobs', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Create a scheduled job', tags: ['scheduler'], security: [{ bearerAuth: [] }] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = request.body as any;

    if (!body.name || !body.job_type || !body.action_type || !body.action_config || !body.schedule_config) {
      return reply.status(400).send({ error: 'Missing required fields: name, job_type, action_type, action_config, schedule_config' });
    }

    const validJobTypes = ['one_shot', 'interval', 'cron'];
    const validActionTypes = ['scheduled_message', 'webhook', 'hook', 'plugin_action'];

    if (!validJobTypes.includes(body.job_type)) {
      return reply.status(400).send({ error: `Invalid job_type. Must be one of: ${validJobTypes.join(', ')}` });
    }
    if (!validActionTypes.includes(body.action_type)) {
      return reply.status(400).send({ error: `Invalid action_type. Must be one of: ${validActionTypes.join(', ')}` });
    }

    const id = await scheduler.createJob({
      name: body.name,
      description: body.description,
      job_type: body.job_type,
      action_type: body.action_type,
      action_config: body.action_config,
      schedule_config: body.schedule_config,
      user_id: user.id,
      max_runs: body.max_runs,
    });

    return { id, message: 'Job created' };
  });

  // Pause a job
  fastify.patch('/jobs/:id/pause', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Pause a scheduled job', tags: ['scheduler'], security: [{ bearerAuth: [] }] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const ok = await scheduler.pauseJob(parseInt(id));
    if (!ok) return reply.status(404).send({ error: 'Job not found' });
    return { message: 'Job paused' };
  });

  // Resume a job
  fastify.patch('/jobs/:id/resume', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Resume a paused job', tags: ['scheduler'], security: [{ bearerAuth: [] }] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const ok = await scheduler.resumeJob(parseInt(id));
    if (!ok) return reply.status(404).send({ error: 'Job not found' });
    return { message: 'Job resumed' };
  });

  // Cancel a job
  fastify.delete('/jobs/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Cancel a scheduled job', tags: ['scheduler'], security: [{ bearerAuth: [] }] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const ok = await scheduler.cancelJob(parseInt(id));
    if (!ok) return reply.status(404).send({ error: 'Job not found' });
    return { message: 'Job cancelled' };
  });

  // Get execution history for a job
  fastify.get('/jobs/:id/executions', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Get job execution history', tags: ['scheduler'], security: [{ bearerAuth: [] }] },
  }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string };
    const executions = await scheduler.getExecutions(parseInt(id), parseInt(query.limit || '20'));
    return { executions };
  });
}
