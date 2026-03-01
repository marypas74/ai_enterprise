import { FastifyInstance } from 'fastify';
import { projectCrudRoutes } from './projectCrud.js';
import { boardRoutes } from './boards.js';
import { cardRoutes } from './cards.js';
import { cardFeatureRoutes } from './cardFeatures.js';

export async function projectRoutes(fastify: FastifyInstance) {
  // Project CRUD: /, /:id, /kanban-access
  await fastify.register(projectCrudRoutes);

  // Boards & Columns: /:projectId/boards/*, /:projectId/columns/*
  await fastify.register(boardRoutes);

  // Card CRUD: /:projectId/columns/:columnId/cards, /:projectId/cards/:cardId, move, delete
  await fastify.register(cardRoutes);

  // Card features: comments, labels, checklists, conversations, agents
  await fastify.register(cardFeatureRoutes);
}
