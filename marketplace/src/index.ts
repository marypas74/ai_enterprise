import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { jwtPlugin } from './auth/jwtPlugin.js';
import { getPool, runMigrations, closePool } from './database/connection.js';
import { registerRoutes } from './routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors);
  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await fastify.register(jwtPlugin);

  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'marketplace',
    timestamp: new Date().toISOString(),
  }));

  await registerRoutes(fastify);

  return fastify;
}

async function start(): Promise<void> {
  const pool = getPool();
  await runMigrations(pool);

  const app = await buildApp();

  const shutdown = async (): Promise<void> => {
    app.log.info('Shutting down...');
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

start().catch((err) => {
  console.error('Failed to start marketplace service:', err);
  process.exit(1);
});
