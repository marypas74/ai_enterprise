import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { createProjectFolder } from '../../services/StorageService.js';
import { checkKanbanAccess, checkProjectAccess, Project, Board } from './access.js';

// Validation schemas
const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  icon: z.string().default('folder'),
  is_public: z.boolean().default(false)
});

const updateProjectSchema = createProjectSchema.partial().extend({
  is_archived: z.boolean().optional()
});

export async function projectCrudRoutes(fastify: FastifyInstance) {
  // Check Kanban access for current user
  fastify.get('/kanban-access', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Check if user has Kanban access',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const userId = (request.user as any).id;
    const hasAccess = await checkKanbanAccess(fastify, userId);

    // Get user's groups with Kanban status (handle missing column gracefully)
    let groups: { name: string; kanbanEnabled: boolean }[] = [];
    try {
      const groupsResult = await findAll<{ name: string; kanban_enabled: boolean }>(
        fastify.db,
        `SELECT g.name, g.kanban_enabled
         FROM user_groups ug
         JOIN \`groups\` g ON ug.group_id = g.id
         WHERE ug.user_id = ? AND g.is_active = TRUE`,
        [userId]
      );

      groups = groupsResult.map(g => ({
        name: g.name,
        kanbanEnabled: g.kanban_enabled === true || (g.kanban_enabled as unknown) === 1
      }));
    } catch (err: any) {
      // Column doesn't exist, just get group names
      const groupsResult = await findAll<{ name: string }>(
        fastify.db,
        `SELECT g.name
         FROM user_groups ug
         JOIN \`groups\` g ON ug.group_id = g.id
         WHERE ug.user_id = ? AND g.is_active = TRUE`,
        [userId]
      );

      groups = groupsResult.map(g => ({
        name: g.name,
        kanbanEnabled: true // Default to enabled if column doesn't exist
      }));
    }

    return {
      hasKanbanAccess: hasAccess,
      groups
    };
  });

  // Get all projects for user
  fastify.get('/', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all projects',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id;

    // Check Kanban access
    const hasKanbanAccess = await checkKanbanAccess(fastify, userId);
    if (!hasKanbanAccess) {
      return reply.status(403).send({
        error: 'Kanban access denied',
        message: 'Your user group does not have permission to access Kanban features'
      });
    }

    const projects = await findAll<Project & { role: string; board_count: number; card_count: number }>(
      fastify.db,
      `SELECT p.*,
              COALESCE(pm.role, CASE WHEN p.owner_id = ? THEN 'owner' ELSE 'viewer' END) as role,
              (SELECT COUNT(*) FROM kanban_boards WHERE project_id = p.id) as board_count,
              (SELECT COUNT(*) FROM kanban_cards kc
               JOIN kanban_columns kcol ON kc.column_id = kcol.id
               JOIN kanban_boards kb ON kcol.board_id = kb.id
               WHERE kb.project_id = p.id AND kc.is_archived = FALSE) as card_count
       FROM projects p
       LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
       WHERE p.owner_id = ? OR pm.user_id = ? OR p.is_public = TRUE
       ORDER BY p.updated_at DESC`,
      [userId, userId, userId, userId]
    );

    return projects;
  });

  // Get single project
  fastify.get('/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get project details',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { id } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(id))) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const project = await findOne<Project>(
      fastify.db,
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );

    // Get boards
    const boards = await findAll<Board>(
      fastify.db,
      'SELECT * FROM kanban_boards WHERE project_id = ? ORDER BY sort_order',
      [id]
    );

    // Get labels
    const labels = await findAll<any>(
      fastify.db,
      'SELECT * FROM kanban_labels WHERE project_id = ?',
      [id]
    );

    // Get members
    const members = await findAll<any>(
      fastify.db,
      `SELECT u.id, u.email, u.name, pm.role, pm.joined_at
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = ?`,
      [id]
    );

    return { ...project, boards, labels, members };
  });

  // Create project
  fastify.post('/', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new project',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const body = createProjectSchema.parse(request.body);

    // Get user info for folder creation
    const user = await findOne<{ name: string; email: string }>(
      fastify.db,
      'SELECT name, email FROM users WHERE id = ?',
      [userId]
    );
    const userName = user?.name || user?.email?.split('@')[0] || `user_${userId}`;

    const projectId = await insertOne(
      fastify.db,
      'INSERT INTO projects (name, description, owner_id, color, icon, is_public) VALUES (?, ?, ?, ?, ?, ?)',
      [body.name, body.description || null, userId, body.color, body.icon, body.is_public]
    );

    // Create project folder structure on storage
    let storagePath: string | undefined;
    try {
      const folders = await createProjectFolder(userName, body.name);
      storagePath = folders.basePath;
      fastify.log.info(`[Project] Created storage folder: ${storagePath}`);
    } catch (err: any) {
      fastify.log.warn(`[Project] Failed to create storage folder: ${err.message}`);
      // Non-blocking - project creation continues even if folder creation fails
    }

    // Create default board
    const boardId = await insertOne(
      fastify.db,
      'INSERT INTO kanban_boards (project_id, name, is_default) VALUES (?, ?, TRUE)',
      [projectId, 'Main Board']
    );

    // Create default columns
    const defaultColumns = [
      { name: 'To Do', color: '#6B7280', sort_order: 0 },
      { name: 'In Progress', color: '#F59E0B', sort_order: 1 },
      { name: 'Review', color: '#8B5CF6', sort_order: 2 },
      { name: 'Done', color: '#10B981', sort_order: 3 }
    ];

    for (const col of defaultColumns) {
      await insertOne(
        fastify.db,
        'INSERT INTO kanban_columns (board_id, name, color, sort_order) VALUES (?, ?, ?, ?)',
        [boardId, col.name, col.color, col.sort_order]
      );
    }

    return { id: projectId, ...body, board_id: boardId, storage_path: storagePath };
  });

  // Update project
  fastify.patch('/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update project',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { id } = request.params;

    if (!await checkProjectAccess(fastify, userId, Number(id), 'admin')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = updateProjectSchema.parse(request.body);
    const updates: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length > 0) {
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Delete project
  fastify.delete('/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete project',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { id } = request.params;

    const project = await findOne<Project>(
      fastify.db,
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );

    if (!project || project.owner_id !== userId) {
      return reply.status(403).send({ error: 'Only owner can delete project' });
    }

    await fastify.db.execute('DELETE FROM projects WHERE id = ?', [id]);

    return { success: true };
  });
}
