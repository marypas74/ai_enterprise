import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { ConversationalFormService } from '../../services/ConversationalFormService.js';
import { requireAdmin } from '../../middleware/index.js';

// Validation schemas
const idParamSchema = z.object({ id: z.string().regex(/^\d+$/, 'ID must be numeric') });

const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  display_name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
   
  json_schema: z.record(z.any()),
  start_examples: z.array(z.string()).optional().nullable(),
  stop_examples: z.array(z.string()).optional().nullable(),
  ask_confirm: z.boolean().optional().default(true),
  on_complete_action: z.string().max(100).optional().default('save'),
   
  on_complete_config: z.record(z.any()).optional().nullable(),
  plugin_id: z.number().optional().nullable(),
  is_enabled: z.boolean().optional().default(true),
});

 
const updateFormSchema = z.record(z.any()).refine(
  (obj) => Object.keys(obj).length > 0,
  { message: 'At least one field is required' }
);

const startSessionSchema = z.object({
  form_id: z.number().int().positive(),
  conversation_id: z.number().int().positive(),
});

const processFormSchema = z.object({
   
  extracted_data: z.record(z.any()),
});

const confirmFormSchema = z.object({
  confirmed: z.boolean(),
});

const activeSessionQuerySchema = z.object({
  conversation_id: z.string().regex(/^\d+$/, 'conversation_id must be numeric').optional(),
});

const listSessionsQuerySchema = z.object({
  state: z.string().max(50).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export async function formRoutes(fastify: FastifyInstance) {
  const formService = new ConversationalFormService(fastify.db);
  fastify.decorate('formService', formService);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  fastify.addHook('onRequest', (fastify as any).authenticate);


  // --- Form Definitions (Admin) ---

  fastify.get('/definitions', async () => {
    const forms = await findAll(fastify.db, 'SELECT * FROM conversational_forms ORDER BY display_name');
    return { forms: forms.map(parseFormJson) };
  });

  fastify.get('/definitions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const form = await findOne(fastify.db, 'SELECT * FROM conversational_forms WHERE id = ?', [id]);
    if (!form) return reply.status(404).send({ error: 'Form not found' });
    return { form: parseFormJson(form) };
  });

  fastify.post('/definitions', { onRequest: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createFormSchema.parse(request.body);
    const id = await insertOne(fastify.db,
      `INSERT INTO conversational_forms (name, display_name, description, json_schema, start_examples, stop_examples, ask_confirm, on_complete_action, on_complete_config, plugin_id, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name, body.display_name, body.description || null,
        JSON.stringify(body.json_schema),
        body.start_examples ? JSON.stringify(body.start_examples) : null,
        body.stop_examples ? JSON.stringify(body.stop_examples) : null,
        body.ask_confirm ?? true,
        body.on_complete_action || 'save',
        body.on_complete_config ? JSON.stringify(body.on_complete_config) : null,
        body.plugin_id || null,
        body.is_enabled ?? true,
      ],
    );
    return reply.status(201).send({ id, message: 'Form created' });
  });

  fastify.patch('/definitions/:id', { onRequest: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateFormSchema.parse(request.body);

    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const vals: any[] = [];
    const jsonFields = ['json_schema', 'start_examples', 'stop_examples', 'on_complete_config'];
    const allowedColumns = ['name', 'display_name', 'description', 'json_schema', 'start_examples', 'stop_examples', 'ask_confirm', 'on_complete_action', 'on_complete_config', 'is_enabled'];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && allowedColumns.includes(key)) {
        sets.push(`${key} = ?`);
        vals.push(jsonFields.includes(key) ? JSON.stringify(value) : value);
      }
    }

    if (sets.length > 0) {
      vals.push(id);
      await updateOne(fastify.db, `UPDATE conversational_forms SET ${sets.join(', ')} WHERE id = ?`, vals);
    }

    return { success: true };
  });

  fastify.delete('/definitions/:id', { onRequest: [requireAdmin] }, async (request: FastifyRequest) => {
    const { id } = idParamSchema.parse(request.params);
    await fastify.db.execute('DELETE FROM conversational_forms WHERE id = ?', [id]);
    return { success: true };
  });

  // --- Form Sessions ---

  // Get active session for current conversation
  fastify.get('/sessions/active', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const q = activeSessionQuerySchema.parse(request.query);
    if (!q.conversation_id) return reply.status(400).send({ error: 'conversation_id required' });

    const session = await formService.getActiveSession(user.id, parseInt(q.conversation_id));
    if (!session) return { session: null };

    const form = await findOne(fastify.db, 'SELECT * FROM conversational_forms WHERE id = ?', [session.form_id]);
    return { session: parseSessionJson(session), form: form ? parseFormJson(form) : null };
  });

  // Start a new form session
  fastify.post('/sessions/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = startSessionSchema.parse(request.body);

    try {
      const session = await formService.startSession(user.id, body.conversation_id, body.form_id);
      const form = await findOne(fastify.db, 'SELECT * FROM conversational_forms WHERE id = ?', [body.form_id]);
      return reply.status(201).send({ session: parseSessionJson(session), form: form ? parseFormJson(form) : null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // Helper to verify session ownership
  const verifySessionOwnership = async (sessionId: number, userId: number): Promise<boolean> => {
    const session = await findOne<{ user_id: number }>(fastify.db, 'SELECT user_id FROM form_sessions WHERE id = ?', [sessionId]);
    return session?.user_id === userId;
  };

  // Process message in active form
  fastify.post('/sessions/:id/process', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { id } = idParamSchema.parse(request.params);
    const body = processFormSchema.parse(request.body);

    if (!await verifySessionOwnership(parseInt(id), user.id)) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    try {
      const result = await formService.updateWithExtraction(parseInt(id), body.extracted_data);
      return { result };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // Confirm / reject form
  fastify.post('/sessions/:id/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { id } = idParamSchema.parse(request.params);
    const body = confirmFormSchema.parse(request.body);

    if (!await verifySessionOwnership(parseInt(id), user.id)) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    try {
      const result = await formService.handleConfirmation(parseInt(id), body.confirmed);
      return { result };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // Cancel active session
  fastify.post('/sessions/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { id } = request.params as { id: string };

    if (!await verifySessionOwnership(parseInt(id), user.id)) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await formService.cancelSession(parseInt(id));
    return { success: true, message: 'Session cancelled' };
  });

  // List all sessions (admin)
  fastify.get('/sessions', { onRequest: [requireAdmin] }, async (request: FastifyRequest) => {
    const q = request.query as { state?: string; limit?: string };
    let sql = `SELECT fs.*, cf.display_name as form_name, u.name as user_name
               FROM form_sessions fs
               JOIN conversational_forms cf ON fs.form_id = cf.id
               JOIN users u ON fs.user_id = u.id`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [];

    if (q.state) {
      sql += ' WHERE fs.state = ?';
      params.push(q.state);
    }

    sql += ' ORDER BY fs.updated_at DESC LIMIT ?';
    params.push(parseInt(q.limit || '50'));

    const sessions = await findAll(fastify.db, sql, params);
    return { sessions: sessions.map(parseSessionJson) };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
function parseFormJson(form: any): any {
  return {
    ...form,
    json_schema: tryParse(form.json_schema),
    start_examples: tryParse(form.start_examples),
    stop_examples: tryParse(form.stop_examples),
    on_complete_config: tryParse(form.on_complete_config),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
function parseSessionJson(session: any): any {
  return {
    ...session,
    collected_data: tryParse(session.collected_data),
    missing_fields: tryParse(session.missing_fields),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
function tryParse(val: any): any {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}
