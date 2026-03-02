import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']).optional(),
  groupIds: z.array(z.number()).optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  department: z.string().optional(),
  job_title: z.string().optional(),
  notes: z.string().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'user']).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  phone: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// Types
interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: Date;
  last_login_at: Date;
  mfa_enabled: boolean;
}

export async function userManagementRoutes(fastify: FastifyInstance) {
  // All routes require authentication + admin role
  fastify.addHook('onRequest', async (request, reply) => {
    await (fastify as any).authenticate(request, reply);
    const user = request.user as { role: string };
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

  // ==================== USERS ====================

  // List users
  fastify.get('/users', {
    schema: {
      description: 'List all users (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; offset?: string; search?: string };
    const limit = Math.min(parseInt(query.limit || '50') || 50, 200);
    const offset = parseInt(query.offset || '0');
    const search = query.search || '';

    let sql = `
      SELECT u.*,
             GROUP_CONCAT(g.name) as groups,
             (SELECT SUM(total_tokens_input + total_tokens_output) FROM monthly_usage WHERE user_id = u.id) as total_tokens
      FROM users u
      LEFT JOIN user_groups ug ON u.id = ug.user_id
      LEFT JOIN \`groups\` g ON ug.group_id = g.id
    `;

    const params: any[] = [];

    if (search) {
      sql += ' WHERE u.email LIKE ? OR u.name LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return findMany<User>(fastify.db, sql, params);
  });

  // Get user details
  fastify.get('/users/:id', {
    schema: {
      description: 'Get user details (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };

    const user = await findOne(
      fastify.db,
      `SELECT u.*,
              JSON_ARRAYAGG(JSON_OBJECT('id', g.id, 'name', g.name)) as groups
       FROM users u
       LEFT JOIN user_groups ug ON u.id = ug.user_id
       LEFT JOIN \`groups\` g ON ug.group_id = g.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [params.id]
    );

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return user;
  });

  // Create user
  fastify.post('/users', {
    schema: {
      description: 'Create new user (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let body: z.infer<typeof createUserSchema>;
    try {
      body = createUserSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    // Check if exists
    const existing = await findOne(fastify.db, 'SELECT id FROM users WHERE email = ?', [body.email]);
    if (existing) {
      return reply.status(409).send({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const userId = await insertOne(
      fastify.db,
      'INSERT INTO users (email, password_hash, name, role, phone, company, department, job_title, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [body.email, passwordHash, body.name, body.role || 'user', body.phone || null, body.company || null, body.department || null, body.job_title || null, body.notes || null]
    );

    // Add to groups
    if (body.groupIds && body.groupIds.length > 0) {
      for (const groupId of body.groupIds) {
        await insertOne(
          fastify.db,
          'INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)',
          [userId, groupId]
        );
      }
    } else {
      // Add to default group
      await insertOne(fastify.db, 'INSERT INTO user_groups (user_id, group_id) VALUES (?, 1)', [userId]);
    }

    // Audit log
    const admin = request.user as { id: number };
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [admin.id, 'create_user', 'user', userId, request.ip]
    );

    return reply.status(201).send({ userId, message: 'User created' });
  });

  // Update user
  fastify.patch('/users/:id', {
    schema: {
      description: 'Update user (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    let body: z.infer<typeof updateUserSchema>;
    try {
      body = updateUserSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (body.name) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.role) {
      updates.push('role = ?');
      values.push(body.role);
    }
    if (body.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(body.is_active);
    }
    if (body.password) {
      updates.push('password_hash = ?');
      values.push(await bcrypt.hash(body.password, 10));
    }
    // Profile fields - allow empty string to clear
    if (body.phone !== undefined) {
      updates.push('phone = ?');
      values.push(body.phone || null);
    }
    if (body.company !== undefined) {
      updates.push('company = ?');
      values.push(body.company || null);
    }
    if (body.department !== undefined) {
      updates.push('department = ?');
      values.push(body.department || null);
    }
    if (body.job_title !== undefined) {
      updates.push('job_title = ?');
      values.push(body.job_title || null);
    }
    if (body.notes !== undefined) {
      updates.push('notes = ?');
      values.push(body.notes || null);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    values.push(params.id);
    const result = await updateOne(
      fastify.db,
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Audit log
    const admin = request.user as { id: number };
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [admin.id, 'update_user', 'user', params.id, JSON.stringify({ ...body, password: body.password ? '[REDACTED]' : undefined }), request.ip]
    );

    return { message: 'User updated' };
  });

  // Delete user
  fastify.delete('/users/:id', {
    schema: {
      description: 'Delete user (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const admin = request.user as { id: number };

    // Prevent self-deletion
    if (parseInt(params.id) === admin.id) {
      return reply.status(400).send({ error: 'Cannot delete yourself' });
    }

    const result = await updateOne(fastify.db, 'DELETE FROM users WHERE id = ?', [params.id]);

    if (result === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [admin.id, 'delete_user', 'user', params.id, request.ip]
    );

    return { message: 'User deleted' };
  });

  // Reset User MFA
  fastify.post('/users/:id/mfa-reset', {
    schema: {
      description: 'Reset user MFA (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const admin = request.user as { id: number };

    const result = await updateOne(
      fastify.db,
      'UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = ?',
      [params.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [admin.id, 'reset_user_mfa', 'user', params.id, request.ip]
    );

    return { message: 'MFA reset successfully' };
  });

  // Note: Groups routes are defined in settings.ts to avoid duplication

  // ==================== ACTIVE SESSIONS ====================

  // Get active sessions (for ActiveSessionsPage)
  fastify.get('/active-sessions', {
    schema: {
      description: 'Get all active user sessions with geo data',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const sessions = await findMany<any>(
      fastify.db,
      `SELECT us.id, us.user_id, u.email, u.name, u.role, u.mfa_enabled,
              us.ip_address, us.country, us.user_agent,
              us.created_at as login_at, us.last_activity_at, us.expires_at, us.logged_out_at
       FROM user_sessions us
       JOIN users u ON us.user_id = u.id
       WHERE us.logged_out_at IS NULL AND us.revoked_at IS NULL AND us.expires_at > NOW()
         AND us.last_activity_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       ORDER BY us.created_at DESC`
    );

    const mapped = sessions.map((s: any) => ({
      id: s.id,
      userId: s.user_id,
      email: s.email,
      name: s.name,
      role: s.role,
      mfaEnabled: !!s.mfa_enabled,
      ip: s.ip_address || 'N/A',
      country: s.country || 'XX',
      countryCode: s.country || 'XX',
      city: '',
      region: '',
      isp: '',
      userAgent: s.user_agent || '',
      loginAt: s.login_at,
      lastActivity: s.last_activity_at
    }));

    return { sessions: mapped, total: mapped.length };
  });

  // Disconnect user session
  fastify.delete('/active-sessions/:userId', {
    schema: {
      description: 'Terminate all sessions for a user',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const admin = request.user as { id: number };

    const result = await updateOne(
      fastify.db,
      'UPDATE user_sessions SET revoked_at = NOW(), logged_out_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
      [userId]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'No active sessions found' });
    }

    // Also revoke refresh tokens
    await updateOne(
      fastify.db,
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
      [userId]
    );

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [admin.id, 'force_disconnect', 'user', userId, JSON.stringify({ revoked_sessions: result }), request.ip]
    );

    return { success: true, message: `${result} session(s) terminated` };
  });
}
