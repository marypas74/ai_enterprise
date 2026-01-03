import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';

// Task interface (maps to kanban_cards)
interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  project_id: number;
  column_id: number;
  assigned_to?: number;
  assigned_name?: string;
  due_date?: string;
  tags: string[];
  ai_context?: string;
  created_at: string;
  updated_at: string;
  position: number;
}

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  project_id: z.number(),
  status: z.string().default('To Do'),
  due_date: z.string().optional(),
  assigned_to: z.number().optional(),
  tags: z.array(z.string()).optional().default([])
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.string().optional(),
  due_date: z.string().nullable().optional(),
  assigned_to: z.number().nullable().optional(),
  feedback: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  position: z.number().optional()
});

export async function taskRoutes(fastify: FastifyInstance) {
  // Helper: Get column ID by status name for a project
  async function getColumnIdByStatus(projectId: number, status: string): Promise<number | null> {
    // Find default board for project
    const board = await findOne<{ id: number }>(
      fastify.db,
      'SELECT id FROM kanban_boards WHERE project_id = ? AND is_default = TRUE LIMIT 1',
      [projectId]
    );

    if (!board) {
      // Get first board
      const anyBoard = await findOne<{ id: number }>(
        fastify.db,
        'SELECT id FROM kanban_boards WHERE project_id = ? LIMIT 1',
        [projectId]
      );
      if (!anyBoard) return null;

      const column = await findOne<{ id: number }>(
        fastify.db,
        'SELECT id FROM kanban_columns WHERE board_id = ? AND name = ? LIMIT 1',
        [anyBoard.id, status]
      );
      return column?.id || null;
    }

    const column = await findOne<{ id: number }>(
      fastify.db,
      'SELECT id FROM kanban_columns WHERE board_id = ? AND name = ? LIMIT 1',
      [board.id, status]
    );

    if (!column) {
      // Get first column as fallback
      const firstCol = await findOne<{ id: number }>(
        fastify.db,
        'SELECT id FROM kanban_columns WHERE board_id = ? ORDER BY sort_order LIMIT 1',
        [board.id]
      );
      return firstCol?.id || null;
    }

    return column.id;
  }

  // Helper: Map card to task
  function cardToTask(card: any): Task {
    return {
      id: card.id,
      title: card.title,
      description: card.description || '',
      status: card.column_name || card.status || 'To Do',
      priority: card.priority || 'medium',
      project_id: card.project_id,
      column_id: card.column_id,
      assigned_to: card.assigned_to,
      assigned_name: card.assignee_name,
      due_date: card.due_date,
      tags: card.tags ? (typeof card.tags === 'string' ? JSON.parse(card.tags) : card.tags) : [],
      ai_context: card.ai_context,
      created_at: card.created_at,
      updated_at: card.updated_at || card.created_at,
      position: card.sort_order || 0
    };
  }

  // ==========================================
  // GET /projects/:projectId/tasks - Get all tasks for a project
  // ==========================================
  fastify.get('/projects/:projectId/tasks', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all tasks for a project',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const { projectId } = request.params;

    // Get all cards with column names
    const tasks = await findAll<any>(
      fastify.db,
      `SELECT c.*, col.name as column_name, col.id as column_id,
              u.name as assignee_name, b.project_id
       FROM kanban_cards c
       JOIN kanban_columns col ON c.column_id = col.id
       JOIN kanban_boards b ON col.board_id = b.id
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE b.project_id = ? AND c.is_archived = FALSE
       ORDER BY col.sort_order, c.sort_order`,
      [projectId]
    );

    return tasks.map(cardToTask);
  });

  // ==========================================
  // POST /tasks - Create new task
  // ==========================================
  fastify.post('/tasks', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new task',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const body = createTaskSchema.parse(request.body);

    // Get column ID for status
    const columnId = await getColumnIdByStatus(body.project_id, body.status);
    if (!columnId) {
      return reply.status(400).send({ error: 'No columns found for project' });
    }

    // Get max sort order
    const maxOrder = await findOne<{ max_order: number }>(
      fastify.db,
      'SELECT MAX(sort_order) as max_order FROM kanban_cards WHERE column_id = ?',
      [columnId]
    );

    const cardId = await insertOne(
      fastify.db,
      `INSERT INTO kanban_cards (column_id, title, description, priority, due_date, assigned_to, created_by, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        columnId,
        body.title,
        body.description || null,
        body.priority,
        body.due_date || null,
        body.assigned_to || null,
        userId,
        (maxOrder?.max_order || 0) + 1
      ]
    );

    // Log activity
    await insertOne(
      fastify.db,
      'INSERT INTO kanban_card_activity (card_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [cardId, userId, 'created', JSON.stringify({ title: body.title })]
    );

    return {
      id: cardId,
      title: body.title,
      description: body.description || '',
      status: body.status,
      priority: body.priority,
      project_id: body.project_id,
      column_id: columnId,
      due_date: body.due_date,
      assigned_to: body.assigned_to,
      tags: body.tags,
      position: (maxOrder?.max_order || 0) + 1
    };
  });

  // ==========================================
  // PATCH /tasks/:taskId - Update task
  // ==========================================
  fastify.patch('/tasks/:taskId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update task',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { taskId } = request.params;
    const body = updateTaskSchema.parse(request.body);

    // Get current card info
    const card = await findOne<{ column_id: number; project_id: number }>(
      fastify.db,
      `SELECT c.column_id, b.project_id
       FROM kanban_cards c
       JOIN kanban_columns col ON c.column_id = col.id
       JOIN kanban_boards b ON col.board_id = b.id
       WHERE c.id = ?`,
      [taskId]
    );

    if (!card) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    const changes: Record<string, any> = {};

    // Handle status change (move to different column)
    if (body.status) {
      const newColumnId = await getColumnIdByStatus(card.project_id, body.status);
      if (newColumnId && newColumnId !== card.column_id) {
        updates.push('column_id = ?');
        values.push(newColumnId);
        changes.status = body.status;
      }
    }

    // Handle other fields
    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      priority: 'priority',
      due_date: 'due_date',
      assigned_to: 'assigned_to',
      position: 'sort_order'
    };

    for (const [bodyKey, dbKey] of Object.entries(fieldMap)) {
      if ((body as any)[bodyKey] !== undefined) {
        updates.push(`${dbKey} = ?`);
        values.push((body as any)[bodyKey]);
        changes[bodyKey] = (body as any)[bodyKey];
      }
    }

    if (updates.length > 0) {
      values.push(taskId);
      await updateOne(
        fastify.db,
        `UPDATE kanban_cards SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Log activity
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_card_activity (card_id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [taskId, userId, 'updated', JSON.stringify(changes)]
      );
    }

    return { success: true };
  });

  // ==========================================
  // DELETE /tasks/:taskId - Delete task
  // ==========================================
  fastify.delete('/tasks/:taskId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete task',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
    const { taskId } = request.params;

    await fastify.db.execute('DELETE FROM kanban_cards WHERE id = ?', [taskId]);

    return { success: true };
  });

  // ==========================================
  // GET /tasks/:taskId - Get single task
  // ==========================================
  fastify.get('/tasks/:taskId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get task details',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
    const { taskId } = request.params;

    const card = await findOne<any>(
      fastify.db,
      `SELECT c.*, col.name as column_name, col.id as column_id,
              u.name as assignee_name, b.project_id
       FROM kanban_cards c
       JOIN kanban_columns col ON c.column_id = col.id
       JOIN kanban_boards b ON col.board_id = b.id
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE c.id = ?`,
      [taskId]
    );

    if (!card) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return cardToTask(card);
  });
}
