import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { requireAdmin } from '../../middleware/index.js';

// Types
interface SystemSetting {
  id: number;
  setting_key: string;
  setting_value: string;
  setting_type: string;
  description: string;
  is_public: boolean;
}

interface Group {
  id: number;
  name: string;
  description: string;
  max_tokens_per_month: number;
  allowed_models: string;
  kanban_enabled: boolean;
  is_active: boolean;
}

interface GroupModelPermission {
  group_id: number;
  model_id: number;
  max_tokens_per_request: number;
  max_requests_per_day: number;
  is_allowed: boolean;
}

// Validation schemas
const updateSettingSchema = z.object({
  setting_value: z.string(),
  description: z.string().optional()
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  max_tokens_per_month: z.number().default(1000000),
  kanban_enabled: z.boolean().default(false),
  is_active: z.boolean().default(true)
});

const updateGroupSchema = createGroupSchema.partial();

const groupModelPermissionSchema = z.object({
  model_id: z.number(),
  max_tokens_per_request: z.number().default(4096),
  max_requests_per_day: z.number().default(1000),
  is_allowed: z.boolean().default(true)
});

export async function settingsRoutes(fastify: FastifyInstance) {

  // ==========================================
  // SYSTEM SETTINGS
  // ==========================================

  // Get all settings (admin sees all, users see only public)
  fastify.get('/settings', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get system settings',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user as { role: string };
    const isAdmin = user.role === 'admin';

    const settings = await findAll<SystemSetting>(
      fastify.db,
      isAdmin
        ? 'SELECT * FROM system_settings ORDER BY setting_key'
        : 'SELECT * FROM system_settings WHERE is_public = TRUE ORDER BY setting_key'
    );

    // Convert to object format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const result: Record<string, any> = {};
    for (const s of settings) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      let value: any = s.setting_value;
      switch (s.setting_type) {
        case 'number':
          value = Number(s.setting_value);
          break;
        case 'boolean':
          value = s.setting_value === 'true';
          break;
        case 'json':
          try {
            value = JSON.parse(s.setting_value);
          } catch {}
          break;
      }
      result[s.setting_key] = {
        value,
        type: s.setting_type,
        description: s.description,
        is_public: s.is_public
      };
    }

    return result;
  });

  // Update setting
  fastify.put('/settings/:key', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update system setting',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const { key } = request.params;
    const body = updateSettingSchema.parse(request.body);

    const existing = await findOne<SystemSetting>(
      fastify.db,
      'SELECT * FROM system_settings WHERE setting_key = ?',
      [key]
    );

    if (!existing) {
      return reply.status(404).send({ error: 'Setting not found' });
    }

    await updateOne(
      fastify.db,
      'UPDATE system_settings SET setting_value = ?, description = COALESCE(?, description) WHERE setting_key = ?',
      [body.setting_value, body.description ?? null, key]
    );

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, details, ip_address) VALUES (?, ?, ?, ?, ?)',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      [(request.user as any).id, 'update_setting', 'system_setting', JSON.stringify({ key, value: body.setting_value }), request.ip]
    );

    return { success: true };
  });

  // ==========================================
  // GROUPS MANAGEMENT
  // ==========================================

  // Get all groups
  fastify.get('/groups', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get all groups',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const groups = await findAll<Group & { user_count: number }>(
      fastify.db,
      `SELECT g.*, COUNT(ug.user_id) as user_count
       FROM \`groups\` g
       LEFT JOIN user_groups ug ON g.id = ug.group_id
       GROUP BY g.id
       ORDER BY g.name`
    );

    return groups;
  });

  // Get single group with model permissions
  fastify.get('/groups/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get group details with model permissions',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const group = await findOne<Group>(
      fastify.db,
      'SELECT * FROM `groups` WHERE id = ?',
      [id]
    );

    if (!group) {
      return reply.status(404).send({ error: 'Group not found' });
    }

    // Get model permissions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const permissions = await findAll<any>(
      fastify.db,
      `SELECT gmp.*, m.model_id, m.display_name, p.name as provider_name
       FROM group_model_permissions gmp
       JOIN ai_models m ON gmp.model_id = m.id
       JOIN ai_providers p ON m.provider_id = p.id
       WHERE gmp.group_id = ?`,
      [id]
    );

    // Get users in group
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const users = await findAll<any>(
      fastify.db,
      `SELECT u.id, u.email, u.name, ug.joined_at
       FROM users u
       JOIN user_groups ug ON u.id = ug.user_id
       WHERE ug.group_id = ?
       ORDER BY u.name`,
      [id]
    );

    return {
      ...group,
      model_permissions: permissions,
      users
    };
  });

  // Create group
  fastify.post('/groups', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Create new group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = createGroupSchema.parse(request.body);

    const groupId = await insertOne(
      fastify.db,
      'INSERT INTO `groups` (name, description, max_tokens_per_month, kanban_enabled, is_active) VALUES (?, ?, ?, ?, ?)',
      [body.name, body.description || null, body.max_tokens_per_month, body.kanban_enabled, body.is_active]
    );

    return { id: groupId, ...body };
  });

  // Update group
  fastify.patch('/groups/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateGroupSchema.parse(request.body);

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
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE \`groups\` SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Delete group
  fastify.delete('/groups/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Delete group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Prevent deleting group 1 (Default)
    if (id === '1') {
      return reply.status(400).send({ error: 'Cannot delete default group' });
    }

    await fastify.db.execute('DELETE FROM `groups` WHERE id = ?', [id]);

    return { success: true };
  });

  // ==========================================
  // GROUP MODEL PERMISSIONS
  // ==========================================

  // Set model permission for group
  fastify.put('/groups/:groupId/models/:modelId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Set model permission for group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { groupId: string; modelId: string } }>, _reply: FastifyReply) => {
    const { groupId, modelId } = request.params;
    const body = groupModelPermissionSchema.omit({ model_id: true }).parse(request.body);

    await fastify.db.execute(
      `INSERT INTO group_model_permissions (group_id, model_id, max_tokens_per_request, max_requests_per_day, is_allowed)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE max_tokens_per_request = ?, max_requests_per_day = ?, is_allowed = ?`,
      [groupId, modelId, body.max_tokens_per_request, body.max_requests_per_day, body.is_allowed,
        body.max_tokens_per_request, body.max_requests_per_day, body.is_allowed]
    );

    return { success: true };
  });

  // Remove model permission
  fastify.delete('/groups/:groupId/models/:modelId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Remove model permission from group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { groupId: string; modelId: string } }>, _reply: FastifyReply) => {
    const { groupId, modelId } = request.params;

    await fastify.db.execute(
      'DELETE FROM group_model_permissions WHERE group_id = ? AND model_id = ?',
      [groupId, modelId]
    );

    return { success: true };
  });

  // Bulk update model permissions for group
  fastify.put('/groups/:groupId/models', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Bulk update model permissions for group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { groupId: string } }>, _reply: FastifyReply) => {
    const { groupId } = request.params;
    const permissions = z.array(groupModelPermissionSchema).parse(request.body);

    // Delete existing permissions
    await fastify.db.execute('DELETE FROM group_model_permissions WHERE group_id = ?', [groupId]);

    // Insert new permissions
    for (const perm of permissions) {
      await insertOne(
        fastify.db,
        `INSERT INTO group_model_permissions (group_id, model_id, max_tokens_per_request, max_requests_per_day, is_allowed)
         VALUES (?, ?, ?, ?, ?)`,
        [groupId, perm.model_id, perm.max_tokens_per_request, perm.max_requests_per_day, perm.is_allowed]
      );
    }

    return { success: true, count: permissions.length };
  });

  // ==========================================
  // USER GROUP MANAGEMENT
  // ==========================================

  // Add user to group
  fastify.post('/groups/:groupId/users/:userId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Add user to group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { groupId: string; userId: string } }>, reply: FastifyReply) => {
    const { groupId, userId } = request.params;

    try {
      await insertOne(
        fastify.db,
        'INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)',
        [userId, groupId]
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.status(409).send({ error: 'User already in group' });
      }
      throw err;
    }

    return { success: true };
  });

  // Remove user from group
  fastify.delete('/groups/:groupId/users/:userId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Remove user from group',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { groupId: string; userId: string } }>, _reply: FastifyReply) => {
    const { groupId, userId } = request.params;

    await fastify.db.execute(
      'DELETE FROM user_groups WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    return { success: true };
  });
}
