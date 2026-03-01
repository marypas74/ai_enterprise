import { FastifyInstance } from 'fastify';
import { userManagementRoutes } from './userManagement.js';
import { systemSettingsRoutes } from './systemSettings.js';

export async function adminRoutes(fastify: FastifyInstance) {
  await fastify.register(userManagementRoutes);
  await fastify.register(systemSettingsRoutes);
}
