import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { checkProjectAccess, Board, Column, Card } from './access.js';

// Validation schemas
const createBoardSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  is_default: z.boolean().default(false)
});

const createColumnSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6B7280'),
  wip_limit: z.number().min(0).default(0),
  sort_order: z.number().default(0)
});

const updateColumnSchema = createColumnSchema.partial();

export async function boardRoutes(fastify: FastifyInstance) {
  // Get board with columns and cards
  fastify.get('/:projectId/boards/:boardId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get board with columns and cards',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; boardId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, boardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId))) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const board = await findOne<Board>(
      fastify.db,
      'SELECT * FROM kanban_boards WHERE id = ? AND project_id = ?',
      [boardId, projectId]
    );

    if (!board) {
      return reply.status(404).send({ error: 'Board not found' });
    }

    // Get columns with cards
    const columns = await findAll<Column>(
      fastify.db,
      'SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY sort_order',
      [boardId]
    );

    const columnsWithCards = await Promise.all(columns.map(async (col) => {
      const cards = await findAll<Card & { assignee_name: string; label_ids: string }>(
        fastify.db,
        `SELECT c.*, u.name as assignee_name,
                GROUP_CONCAT(cl.label_id) as label_ids
         FROM kanban_cards c
         LEFT JOIN users u ON c.assigned_to = u.id
         LEFT JOIN kanban_card_labels cl ON c.id = cl.card_id
         WHERE c.column_id = ? AND c.is_archived = FALSE
         GROUP BY c.id
         ORDER BY c.sort_order`,
        [col.id]
      );

      return {
        ...col,
        cards: cards.map(card => ({
          ...card,
          labels: card.label_ids ? card.label_ids.split(',').map(Number) : []
        }))
      };
    }));

    return { ...board, columns: columnsWithCards };
  });

  // Create board
  fastify.post('/:projectId/boards', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new board',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createBoardSchema.parse(request.body);

    const boardId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_boards (project_id, name, description, is_default) VALUES (?, ?, ?, ?)',
      [projectId, body.name, body.description || null, body.is_default]
    );

    return { id: boardId, ...body };
  });

  // ==========================================
  // COLUMNS
  // ==========================================

  // Create column
  fastify.post('/:projectId/boards/:boardId/columns', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; boardId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, boardId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = createColumnSchema.parse(request.body);

    // Get max sort order
    const maxOrder = await findOne<{ max_order: number }>(
      fastify.db,
      'SELECT MAX(sort_order) as max_order FROM kanban_columns WHERE board_id = ?',
      [boardId]
    );

    const columnId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_columns (board_id, name, color, wip_limit, sort_order) VALUES (?, ?, ?, ?, ?)',
      [boardId, body.name, body.color, body.wip_limit, (maxOrder?.max_order || 0) + 1]
    );

    return { id: columnId, ...body };
  });

  // Update column
  fastify.patch('/:projectId/columns/:columnId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update column',
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

    const body = updateColumnSchema.parse(request.body);
    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length > 0) {
      values.push(columnId);
      await updateOne(
        fastify.db,
        `UPDATE kanban_columns SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Delete column
  fastify.delete('/:projectId/columns/:columnId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; columnId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId, columnId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'admin')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await fastify.db.execute('DELETE FROM kanban_columns WHERE id = ?', [columnId]);

    return { success: true };
  });

  // Reorder columns
  fastify.put('/:projectId/boards/:boardId/columns/reorder', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Reorder columns',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; boardId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { projectId } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const columnOrder = z.array(z.object({ id: z.number(), sort_order: z.number() })).parse(request.body);

    for (const col of columnOrder) {
      await updateOne(
        fastify.db,
        'UPDATE kanban_columns SET sort_order = ? WHERE id = ?',
        [col.sort_order, col.id]
      );
    }

    return { success: true };
  });
}
