import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MetricsService } from '../../services/MetricsService.js';

export async function publicRoutes(fastify: FastifyInstance) {
    // Public metrics endpoint — no authentication, no IP restriction
    // Security: only exposes system metrics (CPU, memory, etc.), no sensitive data
    // The page URL itself (/metrics) serves as the access control
    fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const metrics = await MetricsService.getExhaustiveMetrics(fastify.db);
            return metrics;
        } catch (error: any) {
            fastify.log.error(`[PublicMetrics] Error: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to fetch metrics' });
        }
    });
}
