import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { checkProjectAccess, Card } from './access.js';

// Validation schemas
const createCardSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  due_date: z.string().optional(),
  assigned_to: z.number().optional(),
  estimated_hours: z.number().optional(),
  cover_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
});

const updateCardSchema = createCardSchema.partial().extend({
  column_id: z.number().optional(),
  sort_order: z.number().optional(),
  is_archived: z.boolean().optional(),
  actual_hours: z.number().optional()
});

const moveCardSchema = z.object({
  column_id: z.coerce.number().optional(),
  columnId: z.coerce.number().optional(),
  sort_order: z.coerce.number().optional(),
  sortOrder: z.coerce.number().optional(),
});

export async function cardRoutes(fastify: FastifyInstance) {
  // Create card
  fastify.post('/:projectId/columns/:columnId/cards', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; columnId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, columnId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createCardSchema.parse(request.body);

    // Get max sort order
    const maxOrder = await findOne<{ max_order: number }>(
      fastify.db,
      'SELECT MAX(sort_order) as max_order FROM kanban_cards WHERE column_id = ?',
      [columnId]
    );

    const cardId = await insertOne(
      fastify.db,
      `INSERT INTO kanban_cards (column_id, title, description, priority, due_date, assigned_to, estimated_hours, cover_color, created_by, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        columnId, body.title, body.description || null, body.priority,
        body.due_date || null, body.assigned_to || null, body.estimated_hours || 0,
        body.cover_color || null, userId, (maxOrder?.max_order || 0) + 1
      ]
    );

    // Log activity
    await insertOne(
      fastify.db,
      'INSERT INTO kanban_card_activity (card_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [cardId, userId, 'created', JSON.stringify({ title: body.title })]
    );

    return { id: cardId, ...body };
  });

  // Get card details
  fastify.get('/:projectId/cards/:cardId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get card details',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId))) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const card = await findOne<Card & { creator_name: string; assignee_name: string }>(
      fastify.db,
      `SELECT c.*, creator.name as creator_name, assignee.name as assignee_name
       FROM kanban_cards c
       JOIN users creator ON c.created_by = creator.id
       LEFT JOIN users assignee ON c.assigned_to = assignee.id
       WHERE c.id = ?`,
      [cardId]
    );

    if (!card) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    // Get labels
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const labels = await findAll<any>(
      fastify.db,
      `SELECT l.* FROM kanban_labels l
       JOIN kanban_card_labels cl ON l.id = cl.label_id
       WHERE cl.card_id = ?`,
      [cardId]
    );

    // Get comments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const comments = await findAll<any>(
      fastify.db,
      `SELECT c.*, u.name as user_name
       FROM kanban_card_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.card_id = ?
       ORDER BY c.created_at DESC`,
      [cardId]
    );

    // Get checklists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const checklists = await findAll<any>(
      fastify.db,
      'SELECT * FROM kanban_checklists WHERE card_id = ? ORDER BY sort_order',
      [cardId]
    );

    const checklistsWithItems = await Promise.all(checklists.map(async (cl) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const items = await findAll<any>(
        fastify.db,
        'SELECT * FROM kanban_checklist_items WHERE checklist_id = ? ORDER BY sort_order',
        [cl.id]
      );
      return { ...cl, items };
    }));

    // Get activity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const activity = await findAll<any>(
      fastify.db,
      `SELECT a.*, u.name as user_name
       FROM kanban_card_activity a
       JOIN users u ON a.user_id = u.id
       WHERE a.card_id = ?
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [cardId]
    );

    // Get linked conversations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const conversations = await findAll<any>(
      fastify.db,
      `SELECT c.id, c.title, c.model, c.created_at
       FROM conversations c
       JOIN kanban_card_conversations cc ON c.id = cc.conversation_id
       WHERE cc.card_id = ?`,
      [cardId]
    );

    return {
      ...card,
      labels,
      comments,
      checklists: checklistsWithItems,
      activity,
      conversations
    };
  });

  // Update card
  fastify.patch('/:projectId/cards/:cardId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = updateCardSchema.parse(request.body);
    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const values: any[] = [];

    // Track changes for activity log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const changes: Record<string, any> = {};

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
        changes[key] = value;
      }
    }

    if (updates.length > 0) {
      values.push(cardId);
      await updateOne(
        fastify.db,
        `UPDATE kanban_cards SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Log activity
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_card_activity (card_id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [cardId, userId, 'updated', JSON.stringify(changes)]
      );
    }

    return { success: true };
  });

  // Move card (change column/order) - NEVER returns 500, always 200
  fastify.post('/:projectId/cards/:cardId/move', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Move card to different column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const { projectId, cardId } = request.params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;

    // Log the request for debugging
    fastify.log.info(`[Card Move] User ${userId} attempting to move card ${cardId} in project ${projectId}`);

    try {
      // Check if user is global Admin - they can move ANY card
      const user = await findOne<{ role: string }>(
        fastify.db,
        'SELECT role FROM users WHERE id = ?',
        [userId]
      );

      const isAdmin = user?.role === 'admin';

      // Only check project access if NOT admin
      if (!isAdmin && !await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
        fastify.log.warn(`[Card Move] Access denied for user ${userId} on project ${projectId}`);
        // Return 200 with warning instead of 403
        return { success: false, warning: 'Insufficient permissions, but session continues', userId, projectId };
      }

      // Parse body with flexible schema - accept both number and coercible values
      let columnId: number;
      let sortOrder = 0;

      try {
        const rawBody = moveCardSchema.parse(request.body);
        columnId = Number(rawBody.column_id ?? rawBody.columnId);
        sortOrder = Number(rawBody.sort_order ?? rawBody.sortOrder ?? 0);

        if (isNaN(columnId)) {
          fastify.log.warn(`[Card Move] Invalid column_id`);
          return { success: false, warning: 'Invalid column_id provided' };
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (parseErr: any) {
        fastify.log.warn(`[Card Move] Body parse error: ${parseErr.message}`);
        return { success: false, warning: 'Could not parse request body' };
      }

      // Check if card exists
      const oldCard = await findOne<{ column_id: number; title: string }>(
        fastify.db,
        'SELECT column_id, title FROM kanban_cards WHERE id = ?',
        [cardId]
      );

      if (!oldCard) {
        fastify.log.warn(`[Card Move] Card ${cardId} not found`);
        // Return 200 with warning instead of 404
        return { success: false, warning: 'Card not found, but session continues', cardId };
      }

      // Update card column
      await updateOne(
        fastify.db,
        'UPDATE kanban_cards SET column_id = ?, sort_order = ? WHERE id = ?',
        [columnId, sortOrder, cardId]
      );

      fastify.log.info(`[Card Move] Card ${cardId} "${oldCard.title}" moved from column ${oldCard.column_id} to ${columnId}`);

      // Log activity (non-blocking, fire-and-forget)
      if (oldCard.column_id !== columnId) {
        insertOne(
          fastify.db,
          'INSERT INTO kanban_card_activity (card_id, user_id, action, details) VALUES (?, ?, ?, ?)',
          [cardId, userId, 'moved', JSON.stringify({ from_column: oldCard.column_id, to_column: columnId })]
        ).catch(() => {}); // Silently ignore activity log failures
      }

      return { success: true, cardId: Number(cardId), from: oldCard.column_id, to: columnId };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      // CRITICAL: Never return 500, always return 200 with warning
      fastify.log.error(`[Card Move] CAUGHT ERROR: ${error.message}`, error.stack);
      console.error('[Card Move] Full error:', error);

      // Return 200 OK with warning - keeps frontend session alive
      return {
        success: false,
        warning: 'Could not move card due to server error, but session continues.',
        error: error.message,
        cardId,
        projectId
      };
    }
  });

  // Delete card
  fastify.delete('/:projectId/cards/:cardId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await fastify.db.execute('DELETE FROM kanban_cards WHERE id = ?', [cardId]);

    return { success: true };
  });
}
