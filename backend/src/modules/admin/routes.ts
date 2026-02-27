import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { MetricsService } from '../../services/MetricsService.js';

const execAsync = promisify(exec);

// Prometheus API response type
interface PrometheusResponse {
  status: string;
  data: {
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
}

// Middleware: Admin only
async function adminOnly(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { role: string };
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

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

interface Group {
  id: number;
  name: string;
  description: string;
  max_tokens_per_month: number;
  allowed_models: string;
  is_active: boolean;
}

interface UsageStats {
  user_id: number;
  email: string;
  name: string;
  total_tokens: number;
  total_cost: number;
  request_count: number;
}

interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: number;
  details: string;
  ip_address: string;
  created_at: Date;
}

export async function adminRoutes(fastify: FastifyInstance) {
  // All routes require authentication + admin role
  fastify.addHook('onRequest', async (request, reply) => {
    await (fastify as any).authenticate(request, reply);
    await adminOnly(request, reply);
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
    const limit = parseInt(query.limit || '50');
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
    const body = request.body as {
      email: string;
      password: string;
      name: string;
      role?: 'admin' | 'user';
      groupIds?: number[];
      phone?: string;
      company?: string;
      department?: string;
      job_title?: string;
      notes?: string;
    };

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
    const body = request.body as {
      name?: string;
      role?: 'admin' | 'user';
      is_active?: boolean;
      password?: string;
      phone?: string;
      company?: string;
      department?: string;
      job_title?: string;
      notes?: string;
    };

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
      [admin.id, 'update_user', 'user', params.id, JSON.stringify(body), request.ip]
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

  // ==================== USAGE & STATS ====================

  // Get usage statistics
  fastify.get('/usage', {
    schema: {
      description: 'Get usage statistics (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as { month?: string; userId?: string };
    const month = query.month || new Date().toISOString().slice(0, 7);

    let sql = `
      SELECT u.id as user_id, u.email, u.name,
             COALESCE(SUM(mu.total_tokens_input + mu.total_tokens_output), 0) as total_tokens,
             COALESCE(SUM(mu.total_cost_usd), 0) as total_cost,
             COALESCE(SUM(mu.request_count), 0) as request_count
      FROM users u
      LEFT JOIN monthly_usage mu ON u.id = mu.user_id AND mu.\`year_month\` = ?
    `;

    const params: any[] = [month];

    if (query.userId) {
      sql += ' WHERE u.id = ?';
      params.push(query.userId);
    }

    sql += ' GROUP BY u.id ORDER BY total_cost DESC';

    const userStats = await findMany<UsageStats>(fastify.db, sql, params);

    // Get provider breakdown
    const providerStats = await findMany(
      fastify.db,
      `SELECT provider,
              SUM(total_tokens_input) as tokens_input,
              SUM(total_tokens_output) as tokens_output,
              SUM(total_cost_usd) as cost,
              SUM(request_count) as requests
       FROM monthly_usage
       WHERE \`year_month\` = ?
       GROUP BY provider`,
      [month]
    );

    // Get totals
    const [totals] = await fastify.db.execute(
      `SELECT
         SUM(total_tokens_input + total_tokens_output) as total_tokens,
         SUM(total_cost_usd) as total_cost,
         SUM(request_count) as total_requests
       FROM monthly_usage
       WHERE \`year_month\` = ?`,
      [month]
    ) as any;

    return {
      month,
      totals: totals[0] || { total_tokens: 0, total_cost: 0, total_requests: 0 },
      byProvider: providerStats,
      byUser: userStats
    };
  });

  // ==================== SYSTEM STATS ====================

  // Get system statistics for dashboard
  fastify.get('/system-stats', {
    schema: {
      description: 'Get system statistics for dashboard (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Users stats
    let userStats = { totalUsers: 0, activeUsers: 0 };
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as totalUsers, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeUsers FROM users`
      ) as any;
      userStats = rows[0] || userStats;
    } catch {
      try {
        const [rows] = await fastify.db.execute(`SELECT COUNT(*) as totalUsers FROM users`) as any;
        const total = rows[0]?.totalUsers || 0;
        userStats = { totalUsers: total, activeUsers: total };
      } catch { /* Table may not exist */ }
    }

    // Providers stats
    let providerStats = { totalProviders: 0, activeProviders: 0 };
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as totalProviders, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeProviders FROM ai_providers`
      ) as any;
      providerStats = rows[0] || providerStats;
    } catch {
      try {
        const [rows] = await fastify.db.execute(`SELECT COUNT(*) as totalProviders FROM ai_providers`) as any;
        const total = rows[0]?.totalProviders || 0;
        providerStats = { totalProviders: total, activeProviders: total };
      } catch { /* Table may not exist */ }
    }

    // Models stats
    let modelStats = { totalModels: 0, activeModels: 0 };
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as totalModels, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeModels FROM ai_models`
      ) as any;
      modelStats = rows[0] || modelStats;
    } catch {
      try {
        const [rows] = await fastify.db.execute(`SELECT COUNT(*) as totalModels FROM ai_models`) as any;
        const total = rows[0]?.totalModels || 0;
        modelStats = { totalModels: total, activeModels: total };
      } catch { /* Table may not exist */ }
    }

    // Agents stats
    let agentStats = { activeAgents: 0 };
    try {
      const [agentResult] = await fastify.db.execute(
        `SELECT COUNT(*) as activeAgents FROM agents WHERE status = 'active'`
      ) as any;
      agentStats = agentResult[0] || { activeAgents: 0 };
    } catch { /* Table may not exist */ }

    // Plugins stats
    let pluginStats = { totalPlugins: 0 };
    try {
      const [pluginResult] = await fastify.db.execute(
        `SELECT COUNT(*) as totalPlugins FROM plugins`
      ) as any;
      pluginStats = pluginResult[0] || { totalPlugins: 0 };
    } catch { /* Table may not exist */ }

    // MCP Servers stats
    let mcpStats = { mcpServers: 0 };
    try {
      const [mcpResult] = await fastify.db.execute(
        `SELECT COUNT(*) as mcpServers FROM mcp_servers`
      ) as any;
      mcpStats = mcpResult[0] || { mcpServers: 0 };
    } catch { /* Table may not exist */ }

    // Today's requests
    let todayRequests = 0;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as cnt FROM usage_log WHERE DATE(created_at) = ?`,
        [today]
      ) as any;
      todayRequests = Number(rows[0]?.cnt) || 0;
    } catch { /* Table may not exist */ }

    // This week's requests
    let weekRequests = 0;
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as cnt FROM usage_log WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      ) as any;
      weekRequests = Number(rows[0]?.cnt) || 0;
    } catch { /* Table may not exist */ }

    // This month's cost
    let monthCost = 0;
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const [rows] = await fastify.db.execute(
        `SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM monthly_usage WHERE \`year_month\` = ?`,
        [currentMonth]
      ) as any;
      monthCost = Number(rows[0]?.cost) || 0;
    } catch { /* Table may not exist */ }

    // Success rate and avg response time
    let successRate = 100;
    let avgResponseTime = 0;
    try {
      const [rows] = await fastify.db.execute(
        `SELECT
           ROUND(AVG(CASE WHEN status = 'success' THEN 100 ELSE 0 END), 1) as rate,
           ROUND(AVG(response_time_ms) / 1000, 2) as respTime
         FROM usage_log
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ) as any;
      if (rows[0]?.rate !== null) {
        successRate = Number(rows[0].rate) || 100;
        avgResponseTime = Number(rows[0].respTime) || 0;
      }
    } catch { /* Column may not exist */ }

    return {
      activeUsers: Number(userStats?.activeUsers) || 0,
      totalUsers: Number(userStats?.totalUsers) || 0,
      activeProviders: Number(providerStats?.activeProviders) || 0,
      totalProviders: Number(providerStats?.totalProviders) || 0,
      activeModels: Number(modelStats?.activeModels) || 0,
      totalModels: Number(modelStats?.totalModels) || 0,
      activeAgents: Number(agentStats?.activeAgents) || 0,
      totalPlugins: Number(pluginStats?.totalPlugins) || 0,
      mcpServers: Number(mcpStats?.mcpServers) || 0,
      todayRequests,
      weekRequests,
      monthCost,
      successRate,
      avgResponseTime
    };
  });

  // ==================== AUDIT LOG ====================

  // Get audit log
  fastify.get('/audit-log', {
    schema: {
      description: 'Get audit log (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      action?: string;
      userId?: string;
    };

    const limit = parseInt(query.limit || '100');
    const offset = parseInt(query.offset || '0');

    let sql = `
      SELECT al.*, u.email as user_email, u.name as user_name
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (query.action) {
      sql += ' AND al.action = ?';
      params.push(query.action);
    }

    if (query.userId) {
      sql += ' AND al.user_id = ?';
      params.push(query.userId);
    }

    sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return findMany<AuditLog>(fastify.db, sql, params);
  });

  // ==================== SYSTEM MONITOR & METRICS ====================

  // Public metrics (Legacy - redirected to /api/public/metrics)
  fastify.get('/public/metrics', {
    schema: {
      description: 'Public system metrics console (exhaustive) - Legacy redirect',
      tags: ['public']
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return MetricsService.getExhaustiveMetrics(fastify.db);
  });

  // System Monitor (admin)
  fastify.get('/system-monitor', {
    schema: {
      description: 'Get real-time system monitoring data from Prometheus (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    return MetricsService.getExhaustiveMetrics(fastify.db);
  });

  // ==================== OLLAMA MANAGEMENT ====================

  // Pull a model
  fastify.post('/ollama/pull', {
    schema: {
      description: 'Pull an Ollama model (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { model } = request.body as { model: string };
    if (!model) return reply.status(400).send({ error: 'Model name is required' });

    try {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://10.0.1.1:8086/ollama';
      // Start pull in background (Ollama handles this)
      fetch(`${baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || '' },
        body: JSON.stringify({ name: model, stream: false })
      }).catch(err => console.error(`[Ollama] Pull background error: ${err.message}`));

      return { message: `Started pulling model: ${model}. This may take some time.` };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Delete a model
  fastify.delete('/ollama/models/:model', {
    schema: {
      description: 'Delete an Ollama model (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { model } = request.params as { model: string };

    try {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://10.0.1.1:8086/ollama';
      const response = await fetch(`${baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || '' },
        body: JSON.stringify({ name: model })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err || 'Failed to delete model');
      }

      return { message: `Model ${model} deleted successfully` };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Helper functions
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getAge(timestamp: string): string {
    if (!timestamp) return '-';
    const now = new Date();
    const created = new Date(timestamp);
    const diffMs = now.getTime() - created.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    return `${diffMinutes}m`;
  }

  // ========== Prompt Templates ==========

  // GET /admin/prompt-templates — List all templates
  fastify.get('/prompt-templates', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: { description: 'List all prompt templates', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { PromptTemplateService } = await import('../../services/PromptTemplateService.js');
    const service = new PromptTemplateService(fastify.db);
    const templates = await service.getAllTemplates();
    return { templates };
  });

  // GET /admin/prompt-templates/:id — Get single template
  fastify.get('/prompt-templates/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: { description: 'Get a single prompt template', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const template = await findOne<any>(fastify.db, 'SELECT * FROM prompt_templates WHERE id = ?', [id]);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    if (typeof template.variables === 'string') template.variables = JSON.parse(template.variables);
    return template;
  });

  // POST /admin/prompt-templates — Create template
  fastify.post('/prompt-templates', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: { description: 'Create a new prompt template', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const { PromptTemplateService } = await import('../../services/PromptTemplateService.js');
    const service = new PromptTemplateService(fastify.db);
    const id = await service.create({
      name: body.name,
      display_name: body.display_name,
      template_type: body.template_type,
      content: body.content,
      is_default: body.is_default || false,
      is_active: body.is_active !== false,
      description: body.description || null,
      variables: body.variables || null,
    });
    return { id, message: 'Template created' };
  });

  // PATCH /admin/prompt-templates/:id — Update template
  fastify.patch('/prompt-templates/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: { description: 'Update a prompt template', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const { PromptTemplateService } = await import('../../services/PromptTemplateService.js');
    const service = new PromptTemplateService(fastify.db);
    const affected = await service.updateTemplate(parseInt(id), body);
    if (affected === 0) return reply.status(404).send({ error: 'Template not found or no changes' });
    return { message: 'Template updated' };
  });

  // DELETE /admin/prompt-templates/:id — Delete non-default template
  fastify.delete('/prompt-templates/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: { description: 'Delete a prompt template (non-default only)', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { PromptTemplateService } = await import('../../services/PromptTemplateService.js');
    const service = new PromptTemplateService(fastify.db);
    const affected = await service.deleteTemplate(parseInt(id));
    if (affected === 0) return reply.status(400).send({ error: 'Cannot delete default template or template not found' });
    return { message: 'Template deleted' };
  });

  // POST /admin/prompt-templates/preview — Preview rendered template
  fastify.post('/prompt-templates/preview', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: { description: 'Preview a rendered prompt template', tags: ['admin'], security: [{ bearerAuth: [] }] }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { content: string; context?: Record<string, string> };
    const { PromptTemplateService } = await import('../../services/PromptTemplateService.js');
    const service = new PromptTemplateService(fastify.db);
    const sampleContext = {
      currentDate: new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      userName: 'Test User',
      episodicContext: '## Relevant past conversations\n- (score 0.92) User asked about project setup...',
      declarativeContext: '## Relevant knowledge\n- [docs] (score 0.88) API documentation for /users endpoint...',
      proceduralContext: '## Available tools/procedures\n- search_web: Search the web for information',
      toolOutput: '',
      formContext: '',
      availableTools: '- "search_web": Search the web\n- "generate_document": Generate a document',
      ...body.context,
    };
    const rendered = service.renderTemplate(body.content, sampleContext);
    return { rendered };
  });
}
