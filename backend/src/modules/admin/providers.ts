import { FastifyInstance } from 'fastify';
import { providerCrudRoutes } from './providerCrud.js';
import { providerSyncRoutes } from './providerSync.js';

export async function providerRoutes(fastify: FastifyInstance) {
  await fastify.register(providerCrudRoutes);
  await fastify.register(providerSyncRoutes);
}
