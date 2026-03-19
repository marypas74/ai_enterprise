import type { FastifyInstance } from 'fastify';
import { catalogRoutes } from './catalog/catalogRoutes.js';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(catalogRoutes, { prefix: '/api/marketplace' });
}
