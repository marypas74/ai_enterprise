import { FastifyInstance } from 'fastify';
import { completionRoutes } from './completions.js';
import { conversationRoutes } from './conversations.js';
import { modelRoutes } from './models.js';
import { agenticRoutes } from './agentic.js';

export async function chatRoutes(fastify: FastifyInstance) {
  await fastify.register(completionRoutes);
  await fastify.register(conversationRoutes);
  await fastify.register(modelRoutes);
  await fastify.register(agenticRoutes);
}
