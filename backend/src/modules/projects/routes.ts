import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { createProjectFolder, getProjectFolder } from '../../services/StorageService.js';

// Types
interface Project {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  color: string;
  icon: string;
  is_archived: boolean;
  is_public: boolean;
}

interface Board {
  id: number;
  project_id: number;
  name: string;
  description: string;
  is_default: boolean;
  sort_order: number;
}

interface Column {
  id: number;
  board_id: number;
  name: string;
  color: string;
  wip_limit: number;
  sort_order: number;
}

interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  priority: string;
  due_date: string;
  created_by: number;
  assigned_to: number;
  sort_order: number;
  is_archived: boolean;
}

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

const createBoardSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  is_default: z.boolean().default(false)
});

const updateBoardSchema = createBoardSchema.partial();

const createColumnSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6B7280'),
  wip_limit: z.number().min(0).default(0),
  sort_order: z.number().default(0)
});

const updateColumnSchema = createColumnSchema.partial();

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

export async function projectRoutes(fastify: FastifyInstance) {
  // Helper: Check if user's group has Kanban access enabled
  async function checkKanbanAccess(userId: number): Promise<boolean> {
    // If user is admin, always allow Kanban access
    const user = await findOne<{ role: string }>(
      fastify.db,
      'SELECT role FROM users WHERE id = ?',
      [userId]
    );

    if (user?.role === 'admin') return true;

    // Try to check kanban_enabled column (may not exist in older databases)
    try {
      const result = await findOne<{ kanban_enabled: boolean }>(
        fastify.db,
        `SELECT MAX(g.kanban_enabled) as kanban_enabled
         FROM user_groups ug
         JOIN \`groups\` g ON ug.group_id = g.id
         WHERE ug.user_id = ? AND g.is_active = TRUE`,
        [userId]
      );

      return result?.kanban_enabled === true || (result?.kanban_enabled as unknown) === 1;
    } catch (err: any) {
      // Column doesn't exist yet - allow access by default
      fastify.log.warn(`kanban_enabled column not found, allowing access by default: ${err.message}`);
      return true;
    }
  }

  // Helper: Check project access
  async function checkProjectAccess(userId: number, projectId: number, requiredRole?: string): Promise<boolean> {
    // First check if user is a global Admin - they have full access to all projects
    const user = await findOne<{ role: string }>(
      fastify.db,
      'SELECT role FROM users WHERE id = ?',
      [userId]
    );

    if (user?.role === 'admin') {
      // Global admins have full access to everything
      return true;
    }

    const project = await findOne<Project & { member_role: string }>(
      fastify.db,
      `SELECT p.*, pm.role as member_role
       FROM projects p
       LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
       WHERE p.id = ? AND (p.owner_id = ? OR pm.user_id IS NOT NULL OR p.is_public = TRUE)`,
      [userId, projectId, userId]
    );

    if (!project) return false;
    if (project.owner_id === userId) return true;
    if (!requiredRole) return true;

    const roleHierarchy = ['viewer', 'member', 'admin'];
    const userRoleIndex = roleHierarchy.indexOf(project.member_role || 'viewer');
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    return userRoleIndex >= requiredRoleIndex;
  }

  // ==========================================
  // PROJECTS
  // ==========================================

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
    const hasAccess = await checkKanbanAccess(userId);

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
    const hasKanbanAccess = await checkKanbanAccess(userId);
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

    if (!await checkProjectAccess(userId, Number(id))) {
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

    if (!await checkProjectAccess(userId, Number(id), 'admin')) {
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

  // ==========================================
  // BOARDS
  // ==========================================

  // Get board with columns and cards
  fastify.get('/:projectId/boards/:boardId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get board with columns and cards',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; boardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, boardId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId))) {
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new board',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; boardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, boardId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; columnId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, columnId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = updateColumnSchema.parse(request.body);
    const updates: string[] = [];
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; columnId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, columnId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'admin')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await fastify.db.execute('DELETE FROM kanban_columns WHERE id = ?', [columnId]);

    return { success: true };
  });

  // Reorder columns
  fastify.put('/:projectId/boards/:boardId/columns/reorder', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Reorder columns',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; boardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

  // ==========================================
  // CARDS
  // ==========================================

  // Create card
  fastify.post('/:projectId/columns/:columnId/cards', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create new card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; columnId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, columnId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get card details',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId))) {
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
    const labels = await findAll<any>(
      fastify.db,
      `SELECT l.* FROM kanban_labels l
       JOIN kanban_card_labels cl ON l.id = cl.label_id
       WHERE cl.card_id = ?`,
      [cardId]
    );

    // Get comments
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
    const checklists = await findAll<any>(
      fastify.db,
      'SELECT * FROM kanban_checklists WHERE card_id = ? ORDER BY sort_order',
      [cardId]
    );

    const checklistsWithItems = await Promise.all(checklists.map(async (cl) => {
      const items = await findAll<any>(
        fastify.db,
        'SELECT * FROM kanban_checklist_items WHERE checklist_id = ? ORDER BY sort_order',
        [cl.id]
      );
      return { ...cl, items };
    }));

    // Get activity
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const body = updateCardSchema.parse(request.body);
    const updates: string[] = [];
    const values: any[] = [];

    // Track changes for activity log
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Move card to different column',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const { projectId, cardId } = request.params;
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
      if (!isAdmin && !await checkProjectAccess(userId, Number(projectId), 'member')) {
        fastify.log.warn(`[Card Move] Access denied for user ${userId} on project ${projectId}`);
        // Return 200 with warning instead of 403
        return { success: false, warning: 'Insufficient permissions, but session continues', userId, projectId };
      }

      // Parse body with flexible schema - accept both number and coercible values
      let columnId: number;
      let sortOrder = 0;

      try {
        const rawBody = request.body as any;
        columnId = Number(rawBody?.column_id ?? rawBody?.columnId);
        sortOrder = Number(rawBody?.sort_order ?? rawBody?.sortOrder ?? 0);

        if (isNaN(columnId)) {
          fastify.log.warn(`[Card Move] Invalid column_id: ${rawBody?.column_id}`);
          return { success: false, warning: 'Invalid column_id provided' };
        }
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete card',
      tags: ['projects'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { projectId: string; cardId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { projectId, cardId } = request.params;

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await fastify.db.execute('DELETE FROM kanban_cards WHERE id = ?', [cardId]);

    return { success: true };
  });

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

    if (!await checkProjectAccess(userId, Number(projectId))) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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
  // AI INTEGRATION
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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
    const body = request.body as { autoUpdateCard?: boolean };

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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

    if (!await checkProjectAccess(userId, Number(projectId))) {
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
    const body = request.body as {
      name?: string;
      modelId: number;
      systemPrompt?: string;
      config?: any;
      templateId?: number;
    };

    if (!await checkProjectAccess(userId, Number(projectId), 'member')) {
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
