import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findAll, insertOne, updateOne } from '../../database/index.js';
import { requireAdmin } from '../../middleware/index.js';

// Types
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
const createToolSchema = z.object({
  plugin_id: z.number().optional(),
  name: z.string().min(1).max(100),
  display_name: z.string().min(1).max(200),
  description: z.string().optional(),
  tool_type: z.enum(['function', 'api', 'mcp', 'system']).default('function'),
   
  input_schema: z.record(z.any()),
   
  output_schema: z.record(z.any()).optional(),
   
  handler_config: z.record(z.any()).optional(),
  requires_approval: z.boolean().default(false),
  is_enabled: z.boolean().default(true)
});

const updateToolSchema = createToolSchema.partial();

export async function pluginExecutionRoutes(fastify: FastifyInstance) {

  // ==========================================
  // TOOLS MANAGEMENT
  // ==========================================

  // Get all tools
  fastify.get('/tools', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all tools',
      tags: ['tools'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user as { role: string; id: number };
    const isAdmin = user.role === 'admin';

    let tools: Tool[];

    if (isAdmin) {
      tools = await findAll<Tool>(
        fastify.db,
        `SELECT t.*, p.display_name as plugin_name
         FROM tools t
         LEFT JOIN plugins p ON t.plugin_id = p.id
         ORDER BY t.display_name`
      );
    } else {
      tools = await findAll<Tool>(
        fastify.db,
        `SELECT t.*, p.display_name as plugin_name,
                COALESCE(utp.is_enabled, TRUE) as user_enabled,
                COALESCE(utp.auto_approve, FALSE) as user_auto_approve
         FROM tools t
         LEFT JOIN plugins p ON t.plugin_id = p.id
         LEFT JOIN user_tool_permissions utp ON t.id = utp.tool_id AND utp.user_id = ?
         WHERE t.is_enabled = TRUE
         ORDER BY t.display_name`,
        [user.id]
      );
    }

    return tools.map(t => ({
      ...t,
      input_schema: t.input_schema ? JSON.parse(t.input_schema) : null,
      output_schema: t.output_schema ? JSON.parse(t.output_schema) : null,
      handler_config: t.handler_config ? JSON.parse(t.handler_config) : null
    }));
  });

  // Create tool (Admin only)
  fastify.post('/tools', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Create new tool',
      tags: ['tools'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = createToolSchema.parse(request.body);

    const toolId = await insertOne(
      fastify.db,
      `INSERT INTO tools (plugin_id, name, display_name, description, tool_type, input_schema, output_schema, handler_config, requires_approval, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.plugin_id || null,
        body.name,
        body.display_name,
        body.description || null,
        body.tool_type,
        JSON.stringify(body.input_schema),
        body.output_schema ? JSON.stringify(body.output_schema) : null,
        body.handler_config ? JSON.stringify(body.handler_config) : null,
        body.requires_approval,
        body.is_enabled
      ]
    );

    return { id: toolId, ...body };
  });

  // Update tool (Admin only)
  fastify.patch('/tools/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update tool',
      tags: ['tools'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateToolSchema.parse(request.body);

    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        if (['input_schema', 'output_schema', 'handler_config'].includes(key)) {
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
        `UPDATE tools SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Delete tool (Admin only)
  fastify.delete('/tools/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Delete tool',
      tags: ['tools'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = request.params;

    await fastify.db.execute('DELETE FROM tools WHERE id = ?', [id]);

    return { success: true };
  });

  // ==========================================
  // USER TOOL PERMISSIONS
  // ==========================================

  // Update user tool permission
  fastify.put('/user/tools/:toolId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update user tool permission',
      tags: ['tools'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { toolId: string } }>, _reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { toolId } = request.params;
    const body = z.object({
      is_enabled: z.boolean(),
      auto_approve: z.boolean().optional()
    }).parse(request.body);

    await fastify.db.execute(
      `INSERT INTO user_tool_permissions (user_id, tool_id, is_enabled, auto_approve)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = ?, auto_approve = COALESCE(?, auto_approve)`,
      [
        userId, toolId, body.is_enabled, body.auto_approve ?? false,
        body.is_enabled, body.auto_approve
      ]
    );

    return { success: true };
  });

  // ==========================================
  // TOOL EXECUTION LOG
  // ==========================================

  // Get tool execution history
  fastify.get('/tool-executions', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get tool execution history',
      tags: ['tools'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { limit?: string; offset?: string; tool_id?: string } }>, _reply: FastifyReply) => {
    const user = request.user as { role: string; id: number };
    const isAdmin = user.role === 'admin';
    const { limit = '50', offset = '0', tool_id } = request.query;

    let query = `
      SELECT te.*, t.display_name as tool_name, u.name as user_name
      FROM tool_executions te
      JOIN tools t ON te.tool_id = t.id
      JOIN users u ON te.user_id = u.id
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [];

    if (!isAdmin) {
      query += ' WHERE te.user_id = ?';
      params.push(user.id);
    }

    if (tool_id) {
      query += isAdmin ? ' WHERE' : ' AND';
      query += ' te.tool_id = ?';
      params.push(tool_id);
    }

    query += ' ORDER BY te.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const executions = await findAll<any>(fastify.db, query, params);

    return executions.map(e => ({
      ...e,
      input_data: e.input_data ? JSON.parse(e.input_data) : null,
      output_data: e.output_data ? JSON.parse(e.output_data) : null
    }));
  });
}
