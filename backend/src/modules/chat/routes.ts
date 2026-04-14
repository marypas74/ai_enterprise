import { FastifyInstance } from 'fastify';
import { completionRoutes } from './completions.js';
import { conversationRoutes } from './conversations.js';
import { modelRoutes } from './models.js';
import { agenticRoutes } from './agentic.js';
import { voiceRoutes } from './voice.js';

export async function chatRoutes(fastify: FastifyInstance) {
  await fastify.register(completionRoutes);
  await fastify.register(conversationRoutes);
  await fastify.register(modelRoutes);
  await fastify.register(agenticRoutes);
  await fastify.register(voiceRoutes);

  // Async document job status
  fastify.get('/jobs/:jobId', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Get async document job status', tags: ['chat'] }
  }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { DocumentJobQueue } = await import('../../services/DocumentJobQueue.js');
    const redis = (fastify as any).redis;
    const queue = new DocumentJobQueue(redis);
    const job = await queue.getJob(jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const user = (request as any).user as { id: number };
    if (job.userId !== user.id) return reply.status(403).send({ error: 'Forbidden' });

    return reply.send({
      jobId: job.id,
      status: job.status,
      eta: job.etaSeconds,
      conversationId: job.conversationId,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      errorMessage: job.errorMessage,
    });
  });
}
