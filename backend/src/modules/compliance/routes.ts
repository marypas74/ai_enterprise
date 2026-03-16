import { FastifyInstance } from 'fastify';
import { consentRoutes } from './consent-routes.js';
import { dataExportRoutes } from './data-export-routes.js';
import { accountDeletionRoutes } from './account-deletion-routes.js';
import { adminRoutes } from './admin-routes.js';

export async function complianceRoutes(fastify: FastifyInstance) {
  await fastify.register(consentRoutes);
  await fastify.register(dataExportRoutes);
  await fastify.register(accountDeletionRoutes);
  await fastify.register(adminRoutes);
}
