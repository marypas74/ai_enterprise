import { FastifyInstance } from 'fastify';
import { pluginCrudRoutes } from './pluginCrud.js';
import { pluginExecutionRoutes } from './pluginExecution.js';

export async function pluginRoutes(fastify: FastifyInstance) {
  await fastify.register(pluginCrudRoutes);
  await fastify.register(pluginExecutionRoutes);
}
