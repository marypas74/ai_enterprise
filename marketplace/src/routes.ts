import type { FastifyInstance } from 'fastify';
import { catalogRoutes } from './catalog/catalogRoutes.js';
import { syncRoutes } from './sync/syncRoutes.js';
import { installRoutes } from './install/installRoutes.js';
import { approvalRoutes } from './approval/approvalRoutes.js';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(catalogRoutes, { prefix: '/api/marketplace' });
  await fastify.register(syncRoutes, { prefix: '/api/marketplace' });
  await fastify.register(installRoutes, { prefix: '/api/marketplace' });
  await fastify.register(approvalRoutes, { prefix: '/api/marketplace' });
}
