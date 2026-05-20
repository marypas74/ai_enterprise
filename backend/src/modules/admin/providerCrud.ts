import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { clearEmbeddingCache } from '../../services/EmbeddingService.js';
import { requireAdmin } from '../../middleware/index.js';
import { verifyModelOnProvider, mapModelExistsErrorBody } from './modelExistsCheck.js';

// Types
interface Provider {
  id: number;
  name: string;
  display_name: string;
  provider_type: string;
  is_enabled: boolean;
  is_local: boolean;
  config_schema: string;
  created_at: Date;
  updated_at: Date;
}

interface ProviderSetting {
  id: number;
  provider_id: number;
  setting_key: string;
  setting_value: string;
  is_secret: boolean;
}

interface Model {
  id: number;
  provider_id: number;
  model_id: string;
  display_name: string;
  description: string;
  model_type: string;
  context_window: number;
  max_output_tokens: number;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  supports_streaming: boolean;
  supports_functions: boolean;
  supports_vision: boolean;
  is_enabled: boolean;
  is_default: boolean;
  sort_order: number;
}

// Validation schemas
const updateProviderSchema = z.object({
  is_enabled: z.boolean().optional(),
  display_name: z.string().optional()
});

 
const providerSettingsSchema = z.record(z.string(), z.any());

const createModelSchema = z.object({
  model_id: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().optional(),
  model_type: z.enum(['chat', 'completion', 'embedding', 'image', 'audio']).default('chat'),
  context_window: z.number().default(4096),
  max_output_tokens: z.number().default(4096),
  input_cost_per_1k: z.number().default(0),
  output_cost_per_1k: z.number().default(0),
  supports_streaming: z.boolean().default(true),
  supports_functions: z.boolean().default(false),
  supports_vision: z.boolean().default(false),
  is_enabled: z.boolean().default(true),
  is_default: z.boolean().default(false)
});

const updateModelSchema = createModelSchema.partial();

export async function providerCrudRoutes(fastify: FastifyInstance) {

  // ==========================================
  // PROVIDERS
  // ==========================================

  // Get all providers
  fastify.get('/providers', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get all AI providers',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    const providers = await findAll<Provider>(
      fastify.db,
      `SELECT id, name, display_name, provider_type, is_enabled, is_local, config_schema, created_at, updated_at
       FROM ai_providers ORDER BY name`
    );

    // Parse config_schema JSON
    return providers.map(p => ({
      ...p,
      config_schema: typeof p.config_schema === 'string' ? JSON.parse(p.config_schema) : p.config_schema
    }));
  });

  // Get single provider with settings
  fastify.get('/providers/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get provider details with settings',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const provider = await findOne<Provider>(
      fastify.db,
      'SELECT * FROM ai_providers WHERE id = ?',
      [id]
    );

    if (!provider) {
      return reply.status(404).send({ error: 'Provider not found' });
    }

    // Get settings (mask secrets)
    const settings = await findAll<ProviderSetting>(
      fastify.db,
      'SELECT * FROM ai_provider_settings WHERE provider_id = ?',
      [id]
    );

    const settingsObj: Record<string, string> = {};
    for (const s of settings) {
      if (s.is_secret && s.setting_value) {
        settingsObj[s.setting_key] = '••••••••'; // Mask secret
      } else {
        settingsObj[s.setting_key] = s.setting_value;
      }
    }

    return {
      ...provider,
      config_schema: typeof provider.config_schema === 'string' ? JSON.parse(provider.config_schema) : provider.config_schema,
      settings: settingsObj
    };
  });

  // Update provider
  fastify.patch('/providers/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update provider',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateProviderSchema.parse(request.body);

    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const values: any[] = [];

    if (body.is_enabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(body.is_enabled);
    }
    if (body.display_name !== undefined) {
      updates.push('display_name = ?');
      values.push(body.display_name);
    }

    if (updates.length > 0) {
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE ai_providers SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Trigger immediate model sync when provider is enabled/disabled
      if (body.is_enabled !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const worker = (fastify as any).llmSyncWorker;
        if (worker) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          worker.triggerSync().catch((err: any) =>
            fastify.log.error(`[Provider] Triggered sync failed: ${err.message}`)
          );
        }
      }
    }

    return { success: true };
  });

  // Update provider settings
  fastify.put('/providers/:id/settings', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update provider settings',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const settings = providerSettingsSchema.parse(request.body);

    // Get provider schema to know which fields are secrets
    const provider = await findOne<Provider>(
      fastify.db,
      'SELECT config_schema FROM ai_providers WHERE id = ?',
      [id]
    );

    if (!provider) {
      return reply.status(404).send({ error: 'Provider not found' });
    }

    const schema = typeof provider.config_schema === 'string'
      ? JSON.parse(provider.config_schema)
      : provider.config_schema;

    // Update each setting
    for (const [key, value] of Object.entries(settings)) {
      if (value === '••••••••') continue; // Skip masked values

      const isSecret = schema.properties?.[key]?.format === 'password';
      const storedValue = isSecret && value ? encrypt(String(value)) : String(value);

      // Upsert setting
      await fastify.db.execute(
        `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = ?, is_secret = ?`,
        [id, key, storedValue, isSecret, storedValue, isSecret]
      );
    }

    // Invalidate cached embedding provider when settings change (base_url, api_key, etc.)
    clearEmbeddingCache();

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      [(request.user as any).id, 'update_provider_settings', 'ai_provider', id, request.ip]
    );

    // Trigger immediate model sync when settings change (API key, base_url, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const worker = (fastify as any).llmSyncWorker;
    if (worker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      worker.triggerSync().catch((err: any) =>
        fastify.log.error(`[Provider] Triggered sync after settings update failed: ${err.message}`)
      );
    }

    return { success: true };
  });

  // Test provider connection
  fastify.post('/providers/:id/test', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Test provider connection',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const provider = await findOne<Provider>(
      fastify.db,
      'SELECT * FROM ai_providers WHERE id = ?',
      [id]
    );

    if (!provider) {
      return reply.status(404).send({ error: 'Provider not found' });
    }

    // Get settings
    const settings = await findAll<ProviderSetting>(
      fastify.db,
      'SELECT * FROM ai_provider_settings WHERE provider_id = ?',
      [id]
    );

    const config: Record<string, string> = {};
    for (const s of settings) {
      config[s.setting_key] = s.is_secret ? decrypt(s.setting_value) : s.setting_value;
    }

    try {
      // Test connection based on provider name or provider_type (case-insensitive)
      const providerKey = (provider.provider_type || provider.name || '').toLowerCase();
      switch (providerKey) {
        case 'openai': {
          const response = await fetch(`${config.base_url || 'https://api.openai.com/v1'}/models`, {
            headers: { 'Authorization': `Bearer ${config.api_key}` }
          });
          if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
          break;
        }
        case 'anthropic_api':
        case 'anthropic': {
          // Claude API - actually test the connection with a minimal request
          if (!config.api_key) {
            throw new Error('API key non configurata');
          }
          const baseUrl = config.base_url || 'https://api.anthropic.com';
          const testResp = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
              'x-api-key': config.api_key,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'Hi' }]
            })
          });
          if (testResp.status === 401) {
            throw new Error('API key non valida (401 Unauthorized)');
          }
          if (testResp.status === 403) {
            throw new Error('API key non autorizzata (403 Forbidden)');
          }
          if (testResp.status >= 500) {
            throw new Error(`Errore server Anthropic (${testResp.status})`);
          }
          // 200 = success, 400 = bad request (key ok but request issue), 429 = rate limit (key ok)
          break;
        }
        case 'google':
        case 'google_ai': {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${config.api_key}`
          );
          if (!response.ok) throw new Error(`Google API error: ${response.status}`);
          break;
        }
        case 'ollama': {
          const ollamaHeaders: Record<string, string> = {};
          if (process.env.OLLAMA_AUTH_KEY) ollamaHeaders['X-Ollama-Key'] = process.env.OLLAMA_AUTH_KEY;
          const response = await fetch(`${config.base_url || 'http://localhost:11434'}/api/tags`, { headers: ollamaHeaders });
          if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
          break;
        }
        case 'custom': {
          // For custom OpenAI-compatible providers, test the /models endpoint
          if (!config.base_url) {
            throw new Error('Base URL non configurato per provider custom');
          }
          const headers: Record<string, string> = {};
          if (config.api_key) headers['Authorization'] = `Bearer ${config.api_key}`;
          const response = await fetch(`${config.base_url}/models`, { headers });
          if (!response.ok) throw new Error(`Custom provider error: ${response.status}`);
          break;
        }
        default:
          return { success: true, message: 'Provider type not recognized for testing' };
      }

      return { success: true, message: 'Connection successful' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Connection failed'
      });
    }
  });

  // ==========================================
  // MODELS
  // ==========================================

  // Get all models (optionally filtered by provider)
  fastify.get('/models', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get all AI models',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { provider_id?: string } }>, _reply: FastifyReply) => {
    const { provider_id } = request.query;

    let query = `
      SELECT m.*, p.name as provider_name, p.display_name as provider_display_name, p.is_enabled as provider_enabled
      FROM ai_models m
      JOIN ai_providers p ON m.provider_id = p.id
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [];

    if (provider_id) {
      query += ' WHERE m.provider_id = ?';
      params.push(provider_id);
    }

    query += ' ORDER BY p.name, m.sort_order';

    return findAll<Model>(fastify.db, query, params);
  });

  // Get models available to current user (based on their groups)
  fastify.get('/models/available', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get models available to current user',
      tags: ['models'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const models = await findAll<any>(
      fastify.db,
      `SELECT DISTINCT m.*, p.name as provider_name, p.display_name as provider_display_name
       FROM ai_models m
       JOIN ai_providers p ON m.provider_id = p.id
       LEFT JOIN group_model_permissions gmp ON m.id = gmp.model_id
       LEFT JOIN user_groups ug ON gmp.group_id = ug.group_id
       WHERE p.is_enabled = TRUE
         AND m.is_enabled = TRUE
         AND (gmp.is_allowed = TRUE OR gmp.model_id IS NULL)
         AND (ug.user_id = ? OR gmp.model_id IS NULL)
       ORDER BY p.name, m.sort_order`,
      [userId]
    );

    return models;
  });

  // Create model
  fastify.post('/models', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Create new AI model',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { provider_id: string; force?: string } }>, reply: FastifyReply) => {
    const { provider_id, force } = request.query;
    const body = createModelSchema.parse(request.body);

    // v2.1.62: verify the model id exists upstream, unless force=true was passed
    const isForced = force === 'true' || force === '1';
    if (!isForced) {
      const verification = await verifyModelOnProvider(fastify, Number(provider_id), body.model_id);
      if (!verification.skipped && verification.result && !verification.result.exists) {
        return reply
          .status(422)
          .send(mapModelExistsErrorBody(body.model_id, verification.providerType ?? 'unknown', verification.result.reason));
      }
    } else {
      fastify.log.warn(`[admin] Model creation forced for ${body.model_id} (provider_id=${provider_id})`);
    }

    const modelId = await insertOne(
      fastify.db,
      `INSERT INTO ai_models (
        provider_id, model_id, display_name, description, model_type,
        context_window, max_output_tokens, input_cost_per_1k, output_cost_per_1k,
        supports_streaming, supports_functions, supports_vision, is_enabled, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        provider_id, body.model_id, body.display_name, body.description || null, body.model_type,
        body.context_window, body.max_output_tokens, body.input_cost_per_1k, body.output_cost_per_1k,
        body.supports_streaming, body.supports_functions, body.supports_vision, body.is_enabled, body.is_default
      ]
    );

    return { id: modelId, ...body };
  });

  // Update model
  fastify.patch('/models/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update AI model',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (
    request: FastifyRequest<{ Params: { id: string }; Querystring: { force?: string } }>,
    reply: FastifyReply,
  ) => {
    const { id } = request.params;
    const { force } = request.query;
    const body = updateModelSchema.parse(request.body);

    // v2.1.62: when the admin renames `model_id`, re-verify against the upstream provider
    const isForced = force === 'true' || force === '1';
    if (body.model_id && !isForced) {
      const existing = await findOne<{ provider_id: number }>(
        fastify.db,
        'SELECT provider_id FROM ai_models WHERE id = ?',
        [id],
      );
      if (existing) {
        const verification = await verifyModelOnProvider(fastify, existing.provider_id, body.model_id);
        if (!verification.skipped && verification.result && !verification.result.exists) {
          return reply
            .status(422)
            .send(mapModelExistsErrorBody(body.model_id, verification.providerType ?? 'unknown', verification.result.reason));
        }
      }
    } else if (body.model_id && isForced) {
      fastify.log.warn(`[admin] Model update forced for ${body.model_id} (id=${id})`);
    }

    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    // v2.1.64: when admin explicitly forces is_enabled=true, mark the model as
    // manually enabled so the LLMSyncWorker auto-disable pass respects the choice.
    if (isForced && body.is_enabled === true) {
      updates.push('is_manually_enabled = ?');
      values.push(true);
      fastify.log.info(`[admin] Marking model id=${id} as is_manually_enabled=true (force=true override)`);
    }

    if (updates.length > 0) {
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE ai_models SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
      // Invalidate cached embedding provider when any model is updated
      clearEmbeddingCache();
    }

    return { success: true };
  });

  // Delete model
  fastify.delete('/models/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Delete AI model',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = request.params;

    await fastify.db.execute('DELETE FROM ai_models WHERE id = ?', [id]);

    return { success: true };
  });
}
