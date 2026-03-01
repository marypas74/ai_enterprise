import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';

// Types
interface Plugin {
  id: number;
  name: string;
  display_name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  icon: string;
  config_schema: string;
  is_system: boolean;
  is_enabled: boolean;
  install_path: string;
  entry_point: string;
}

interface MCPServer {
  id: number;
  name: string;
  display_name: string;
  description: string;
  transport_type: string;
  command: string;
  url: string;
  env_vars: string;
  is_enabled: boolean;
}

interface Tool {
  id: number;
  plugin_id: number;
  name: string;
  display_name: string;
  description: string;
  tool_type: string;
  input_schema: string;
  output_schema: string;
  handler_config: string;
  requires_approval: boolean;
  is_enabled: boolean;
}

// Validation schemas
const createPluginSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().min(1).max(200),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  author: z.string().optional(),
  category: z.enum(['tools', 'integrations', 'utilities', 'ai', 'data', 'other']).default('other'),
  icon: z.string().optional(),
  config_schema: z.record(z.any()).optional(),
  is_system: z.boolean().default(false),
  is_enabled: z.boolean().default(true)
});

const updatePluginSchema = createPluginSchema.partial();

const createMCPServerSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().min(1).max(200),
  description: z.string().optional(),
  transport_type: z.enum(['stdio', 'sse', 'websocket']).default('stdio'),
  command: z.string().optional(),
  url: z.string().optional(),
  env_vars: z.record(z.string()).optional(),
  is_enabled: z.boolean().default(false)
});

const updateMCPServerSchema = createMCPServerSchema.partial();

export async function pluginCrudRoutes(fastify: FastifyInstance) {
  // Middleware: Admin only
  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string };
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  };

  // ==========================================
  // PLUGINS MANAGEMENT
  // ==========================================

  // Get all plugins
  fastify.get('/plugins', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all plugins',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string; id: number };
    const isAdmin = user.role === 'admin';

    let plugins: Plugin[];

    if (isAdmin) {
      plugins = await findAll<Plugin>(
        fastify.db,
        'SELECT * FROM plugins ORDER BY category, display_name'
      );
    } else {
      // For regular users, show enabled plugins and their permissions
      plugins = await findAll<Plugin>(
        fastify.db,
        `SELECT p.*, COALESCE(upp.is_enabled, TRUE) as user_enabled
         FROM plugins p
         LEFT JOIN user_plugin_permissions upp ON p.id = upp.plugin_id AND upp.user_id = ?
         WHERE p.is_enabled = TRUE
         ORDER BY p.category, p.display_name`,
        [user.id]
      );
    }

    // Get tool count for each plugin
    const toolCounts = await findAll<{ plugin_id: number; count: number }>(
      fastify.db,
      'SELECT plugin_id, COUNT(*) as count FROM tools WHERE plugin_id IS NOT NULL GROUP BY plugin_id'
    );
    const toolCountMap = new Map(toolCounts.map(t => [t.plugin_id, t.count]));

    return plugins.map(p => ({
      ...p,
      config_schema: p.config_schema ? JSON.parse(p.config_schema) : null,
      tools_count: toolCountMap.get(p.id) || 0
    }));
  });

  // Get single plugin with tools
  fastify.get('/plugins/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get plugin details with tools',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const plugin = await findOne<Plugin>(
      fastify.db,
      'SELECT * FROM plugins WHERE id = ?',
      [id]
    );

    if (!plugin) {
      return reply.status(404).send({ error: 'Plugin not found' });
    }

    // Get tools for this plugin
    const tools = await findAll<Tool>(
      fastify.db,
      'SELECT * FROM tools WHERE plugin_id = ? ORDER BY display_name',
      [id]
    );

    // Get settings
    const settings = await findAll<{ setting_key: string; setting_value: string }>(
      fastify.db,
      'SELECT setting_key, setting_value FROM plugin_settings WHERE plugin_id = ? AND user_id IS NULL',
      [id]
    );

    return {
      ...plugin,
      config_schema: plugin.config_schema ? JSON.parse(plugin.config_schema) : null,
      tools: tools.map(t => ({
        ...t,
        input_schema: t.input_schema ? JSON.parse(t.input_schema) : null,
        output_schema: t.output_schema ? JSON.parse(t.output_schema) : null,
        handler_config: t.handler_config ? JSON.parse(t.handler_config) : null
      })),
      settings: Object.fromEntries(settings.map(s => [s.setting_key, s.setting_value]))
    };
  });

  // Create plugin (Admin only)
  fastify.post('/plugins', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Create new plugin',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createPluginSchema.parse(request.body);

    const pluginId = await insertOne(
      fastify.db,
      `INSERT INTO plugins (name, display_name, description, version, author, category, icon, config_schema, is_system, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name,
        body.display_name,
        body.description || null,
        body.version,
        body.author || null,
        body.category,
        body.icon || null,
        body.config_schema ? JSON.stringify(body.config_schema) : null,
        body.is_system,
        body.is_enabled
      ]
    );

    return { id: pluginId, ...body };
  });

  // Update plugin (Admin only)
  fastify.patch('/plugins/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Update plugin',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updatePluginSchema.parse(request.body);

    // Check if system plugin
    const plugin = await findOne<Plugin>(
      fastify.db,
      'SELECT is_system FROM plugins WHERE id = ?',
      [id]
    );

    if (plugin?.is_system && body.is_enabled === false) {
      return reply.status(400).send({ error: 'Cannot disable system plugin' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        if (key === 'config_schema') {
          updates.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
    }

    if (updates.length > 0) {
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE plugins SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Save plugin settings (Admin only)
  fastify.put('/plugins/:id/settings', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Save plugin settings',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const pluginSettingsSchema = z.record(z.any());
    let settings: z.infer<typeof pluginSettingsSchema>;
    try {
      settings = pluginSettingsSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    // Delete existing global settings
    await fastify.db.execute(
      'DELETE FROM plugin_settings WHERE plugin_id = ? AND user_id IS NULL',
      [id]
    );

    // Insert new settings
    for (const [key, value] of Object.entries(settings)) {
      await insertOne(
        fastify.db,
        'INSERT INTO plugin_settings (plugin_id, user_id, setting_key, setting_value) VALUES (?, NULL, ?, ?)',
        [id, key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
      );
    }

    return { success: true };
  });

  // Delete plugin (Admin only)
  fastify.delete('/plugins/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Delete plugin',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if system plugin
    const plugin = await findOne<Plugin>(
      fastify.db,
      'SELECT is_system FROM plugins WHERE id = ?',
      [id]
    );

    if (plugin?.is_system) {
      return reply.status(400).send({ error: 'Cannot delete system plugin' });
    }

    await fastify.db.execute('DELETE FROM plugins WHERE id = ?', [id]);

    return { success: true };
  });

  // ==========================================
  // USER PLUGIN PERMISSIONS
  // ==========================================

  // Get current user's plugin permissions
  fastify.get('/user/plugins', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get current user plugin permissions',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id;

    const plugins = await findAll<any>(
      fastify.db,
      `SELECT p.*, COALESCE(upp.is_enabled, TRUE) as user_enabled, upp.settings_override
       FROM plugins p
       LEFT JOIN user_plugin_permissions upp ON p.id = upp.plugin_id AND upp.user_id = ?
       WHERE p.is_enabled = TRUE
       ORDER BY p.category, p.display_name`,
      [userId]
    );

    return plugins.map(p => ({
      ...p,
      config_schema: p.config_schema ? JSON.parse(p.config_schema) : null,
      settings_override: p.settings_override ? JSON.parse(p.settings_override) : null
    }));
  });

  // Update user plugin permission
  fastify.put('/user/plugins/:pluginId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update user plugin permission',
      tags: ['plugins'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { pluginId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { pluginId } = request.params;
    const body = z.object({
      is_enabled: z.boolean(),
      settings_override: z.record(z.any()).optional()
    }).parse(request.body);

    await fastify.db.execute(
      `INSERT INTO user_plugin_permissions (user_id, plugin_id, is_enabled, settings_override)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = ?, settings_override = ?`,
      [
        userId, pluginId, body.is_enabled, body.settings_override ? JSON.stringify(body.settings_override) : null,
        body.is_enabled, body.settings_override ? JSON.stringify(body.settings_override) : null
      ]
    );

    return { success: true };
  });

  // ==========================================
  // MCP SERVERS MANAGEMENT
  // ==========================================

  // Get all MCP servers
  fastify.get('/mcp-servers', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all MCP servers',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string; id: number };
    const isAdmin = user.role === 'admin';

    let servers: MCPServer[];

    if (isAdmin) {
      servers = await findAll<MCPServer>(
        fastify.db,
        'SELECT * FROM mcp_servers ORDER BY display_name'
      );
    } else {
      servers = await findAll<MCPServer>(
        fastify.db,
        `SELECT m.*, COALESCE(ump.is_enabled, FALSE) as user_enabled
         FROM mcp_servers m
         LEFT JOIN user_mcp_permissions ump ON m.id = ump.mcp_server_id AND ump.user_id = ?
         WHERE m.is_enabled = TRUE
         ORDER BY m.display_name`,
        [user.id]
      );
    }

    return servers.map(s => ({
      ...s,
      env_vars: s.env_vars ? JSON.parse(s.env_vars) : {}
    }));
  });

  // Get single MCP server
  fastify.get('/mcp-servers/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Get MCP server details',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const server = await findOne<MCPServer>(
      fastify.db,
      'SELECT * FROM mcp_servers WHERE id = ?',
      [id]
    );

    if (!server) {
      return reply.status(404).send({ error: 'MCP server not found' });
    }

    // Get user count
    const [{ count }] = await findAll<{ count: number }>(
      fastify.db,
      'SELECT COUNT(*) as count FROM user_mcp_permissions WHERE mcp_server_id = ? AND is_enabled = TRUE',
      [id]
    );

    return {
      ...server,
      env_vars: server.env_vars ? JSON.parse(server.env_vars) : {},
      user_count: count
    };
  });

  // Create MCP server (Admin only)
  fastify.post('/mcp-servers', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Create MCP server',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createMCPServerSchema.parse(request.body);

    const serverId = await insertOne(
      fastify.db,
      `INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name,
        body.display_name,
        body.description || null,
        body.transport_type,
        body.command || null,
        body.url || null,
        body.env_vars ? JSON.stringify(body.env_vars) : '{}',
        body.is_enabled
      ]
    );

    return { id: serverId, ...body };
  });

  // Update MCP server (Admin only)
  fastify.patch('/mcp-servers/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Update MCP server',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateMCPServerSchema.parse(request.body);

    const updates: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        if (key === 'env_vars') {
          updates.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
    }

    if (updates.length > 0) {
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Delete MCP server (Admin only)
  fastify.delete('/mcp-servers/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Delete MCP server',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    await fastify.db.execute('DELETE FROM mcp_servers WHERE id = ?', [id]);

    return { success: true };
  });

  // Test MCP server connection (Admin only)
  fastify.post('/mcp-servers/:id/test', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Test MCP server connection',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const server = await findOne<MCPServer>(
      fastify.db,
      'SELECT * FROM mcp_servers WHERE id = ?',
      [id]
    );

    if (!server) {
      return reply.status(404).send({ error: 'MCP server not found' });
    }

    // Validate configuration
    if (server.transport_type === 'stdio' && !server.command) {
      return { success: false, message: 'Command is required for stdio transport' };
    }

    if ((server.transport_type === 'sse' || server.transport_type === 'websocket') && !server.url) {
      return { success: false, message: 'URL is required for SSE/WebSocket transport' };
    }

    // Actual connection test for stdio transport
    if (server.transport_type === 'stdio' && server.command) {
      try {
        const { MCPClientManager } = await import('../../services/MCPClientManager.js');
        const manager = MCPClientManager.getInstance();
        // Parse command — first token is the executable, rest are args
        const cmdParts = server.command.trim().split(/\s+/);
        const envVars = server.env_vars
          ? (typeof server.env_vars === 'string' ? JSON.parse(server.env_vars) : server.env_vars)
          : {};
        const config = {
          id: server.id,
          name: server.name,
          transport: server.transport_type as 'stdio',
          command: cmdParts[0],
          args: cmdParts.slice(1),
          env: envVars,
          isEnabled: true,
        };
        const connected = await manager.connectServer(config);
        if (connected) {
          const status = manager.getStatus().find(s => s.id === server.id);
          return {
            success: true,
            message: `Connected successfully. Discovered ${status?.tools || 0} tools.`,
            tools: status?.tools || 0,
          };
        }
        const status = manager.getStatus().find(s => s.id === server.id);
        return {
          success: false,
          message: status?.error || 'Connection failed',
        };
      } catch (err: any) {
        return { success: false, message: `Connection test failed: ${err.message}` };
      }
    }

    return { success: true, message: 'Configuration is valid (connection test not available for this transport type)' };
  });

  // ==========================================
  // USER MCP PERMISSIONS
  // ==========================================

  // Get current user's MCP permissions
  fastify.get('/user/mcp-servers', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get current user MCP server permissions',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id;

    const servers = await findAll<any>(
      fastify.db,
      `SELECT m.*, COALESCE(ump.is_enabled, FALSE) as user_enabled
       FROM mcp_servers m
       LEFT JOIN user_mcp_permissions ump ON m.id = ump.mcp_server_id AND ump.user_id = ?
       WHERE m.is_enabled = TRUE
       ORDER BY m.display_name`,
      [userId]
    );

    return servers.map(s => ({
      ...s,
      env_vars: s.env_vars ? JSON.parse(s.env_vars) : {}
    }));
  });

  // Update user MCP permission
  fastify.put('/user/mcp-servers/:serverId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Enable/disable MCP server for current user',
      tags: ['mcp'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    const userId = (request.user as any).id;
    const { serverId } = request.params;
    const body = z.object({ is_enabled: z.boolean() }).parse(request.body);

    await fastify.db.execute(
      `INSERT INTO user_mcp_permissions (user_id, mcp_server_id, is_enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = ?`,
      [userId, serverId, body.is_enabled, body.is_enabled]
    );

    return { success: true };
  });
}
