import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { checkProjectAccess, Card } from './access.js';

// Validation schemas
const createCommentSchema = z.object({
  content: z.string().min(1)
});

const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6')
});

const createChecklistSchema = z.object({
  name: z.string().min(1).max(200)
});

const createChecklistItemSchema = z.object({
  content: z.string().min(1).max(500)
});

const linkAgentSchema = z.object({
  autoUpdateCard: z.boolean().optional()
});

const createAgentSessionSchema = z.object({
  name: z.string().optional(),
  modelId: z.number(),
  systemPrompt: z.string().optional(),
  config: z.any().optional(),
  templateId: z.number().optional(),
});

export async function cardFeatureRoutes(fastify: FastifyInstance) {
  // ==========================================
  // COMMENTS
  // ==========================================

  // Add comment
  fastify.post('/:projectId/cards/:cardId/comments', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Add comment to card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId))) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createCommentSchema.parse(request.body);

    const commentId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_card_comments (card_id, user_id, content) VALUES (?, ?, ?)',
      [cardId, userId, body.content]
    );

    // Log activity
    await insertOne(
      fastify.db,
      'INSERT INTO kanban_card_activity (card_id, user_id, action) VALUES (?, ?, ?)',
      [cardId, userId, 'commented']
    );

    return { id: commentId, ...body };
  });

  // ==========================================
  // LABELS
  // ==========================================

  // Create label
  fastify.post('/:projectId/labels', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create project label',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createLabelSchema.parse(request.body);

    const labelId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_labels (project_id, name, color) VALUES (?, ?, ?)',
      [projectId, body.name, body.color]
    );

    return { id: labelId, ...body };
  });

  // Add label to card
  fastify.post('/:projectId/cards/:cardId/labels/:labelId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Add label to card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string; labelId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId, labelId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    try {
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_card_labels (card_id, label_id) VALUES (?, ?)',
        [cardId, labelId]
      );
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        return { success: true }; // Already exists
      }
      throw err;
    }

    return { success: true };
  });

  // Remove label from card
  fastify.delete('/:projectId/cards/:cardId/labels/:labelId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Remove label from card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string; labelId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId, labelId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await fastify.db.execute('DELETE FROM kanban_card_labels WHERE card_id = ? AND label_id = ?', [cardId, labelId]);

    return { success: true };
  });

  // ==========================================
  // CHECKLISTS
  // ==========================================

  // Create checklist
  fastify.post('/:projectId/cards/:cardId/checklists', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create checklist',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createChecklistSchema.parse(request.body);

    const checklistId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_checklists (card_id, name) VALUES (?, ?)',
      [cardId, body.name]
    );

    return { id: checklistId, ...body, items: [] };
  });

  // Add checklist item
  fastify.post('/:projectId/checklists/:checklistId/items', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Add checklist item',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; checklistId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, checklistId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createChecklistItemSchema.parse(request.body);

    const itemId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_checklist_items (checklist_id, content) VALUES (?, ?)',
      [checklistId, body.content]
    );

    return { id: itemId, ...body, is_checked: false };
  });

  // Toggle checklist item
  fastify.patch('/:projectId/checklist-items/:itemId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Toggle checklist item',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; itemId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, itemId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = z.object({ is_checked: z.boolean() }).parse(request.body);

    await updateOne(
      fastify.db,
      'UPDATE kanban_checklist_items SET is_checked = ?, checked_by = ?, checked_at = ? WHERE id = ?',
      [body.is_checked, body.is_checked ? userId : null, body.is_checked ? new Date() : null, itemId]
    );

    return { success: true };
  });

  // ==========================================
  // AI INTEGRATION - Conversations
  // ==========================================

  // Link conversation to card
  fastify.post('/:projectId/cards/:cardId/conversations/:conversationId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Link conversation to card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string; conversationId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId, conversationId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    try {
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_card_conversations (card_id, conversation_id) VALUES (?, ?)',
        [cardId, conversationId]
      );
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        return { success: true };
      }
      throw err;
    }

    return { success: true };
  });

  // ==========================================
  // AGENT INTEGRATION
  // ==========================================

  // Link agent session to card
  fastify.post('/:projectId/cards/:cardId/agents/:sessionId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Link agent session to card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string; sessionId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId, sessionId } = request.params;
    const body = linkAgentSchema.parse(request.body);

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    try {
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_card_agents (card_id, session_id, status, auto_update_card) VALUES (?, ?, ?, ?)',
        [cardId, sessionId, 'assigned', body.autoUpdateCard ?? true]
      );

      // Log activity
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_card_activity (card_id, user_id, action_type, details) VALUES (?, ?, ?, ?)',
        [cardId, userId, 'agent_linked', JSON.stringify({ session_id: sessionId })]
      );
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        return { success: true, message: 'Already linked' };
      }
      throw err;
    }

    return { success: true };
  });

  // Unlink agent session from card
  fastify.delete('/:projectId/cards/:cardId/agents/:sessionId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Unlink agent session from card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string; sessionId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId, sessionId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await updateOne(
      fastify.db,
      'DELETE FROM kanban_card_agents WHERE card_id = ? AND session_id = ?',
      [cardId, sessionId]
    );

    // Log activity
    await insertOne(
      fastify.db,
      'INSERT INTO kanban_card_activity (card_id, user_id, action_type, details) VALUES (?, ?, ?, ?)',
      [cardId, userId, 'agent_unlinked', JSON.stringify({ session_id: sessionId })]
    );

    return { success: true };
  });

  // Get agents linked to card
  fastify.get('/:projectId/cards/:cardId/agents', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get agent sessions linked to card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId))) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const agents = await findAll<any>(
      fastify.db,
      `SELECT kca.*, s.name as session_name, s.status as session_status, s.task_specification,
              s.terminal_slot, s.iteration_count, s.max_iterations, s.created_at as session_created_at
       FROM kanban_card_agents kca
       JOIN agent_sessions s ON kca.session_id = s.id
       WHERE kca.card_id = ?
       ORDER BY kca.assigned_at DESC`,
      [cardId]
    );

    return agents;
  });

  // Create new agent session from card
  fastify.post('/:projectId/cards/:cardId/agents', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create agent session from card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;
    const body = createAgentSessionSchema.parse(request.body);

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    // Get card details to use as task specification
    const card = await findOne<Card>(
      fastify.db,
      'SELECT * FROM kanban_cards WHERE id = ?',
      [cardId]
    );

    if (!card) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    // Import orchestrator (dynamic to avoid circular deps)
    const { AgentOrchestrator } = await import('../../services/AgentOrchestrator.js');

    // Create session with card linked
    const session = await AgentOrchestrator.createSession(fastify.db, userId, {
      name: body.name || `Task: ${card.title}`,
      taskSpecification: `${card.title}\n\n${card.description || ''}`,
      modelId: body.modelId,
      systemPrompt: body.systemPrompt,
      config: body.config,
      templateId: body.templateId,
      cardId: Number(cardId)
    });

    return session;
  });
}
