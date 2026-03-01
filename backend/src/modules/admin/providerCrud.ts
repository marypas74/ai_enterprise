import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { getOllamaModelSyncService } from '../../services/OllamaModelSyncService.js';

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
  // Middleware: Admin only
  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string };
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  };

  // ==========================================
  // PROVIDERS
  // ==========================================

  // Get all providers
  fastify.get('/providers', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Get all AI providers',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
    onRequest: [(fastify as any).authenticate, adminOnly],
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
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Update provider',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateProviderSchema.parse(request.body);

    const updates: string[] = [];
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
        const worker = (fastify as any).llmSyncWorker;
        if (worker) {
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
    onRequest: [(fastify as any).authenticate, adminOnly],
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

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [(request.user as any).id, 'update_provider_settings', 'ai_provider', id, request.ip]
    );

    // Trigger immediate model sync when settings change (API key, base_url, etc.)
    const worker = (fastify as any).llmSyncWorker;
    if (worker) {
      worker.triggerSync().catch((err: any) =>
        fastify.log.error(`[Provider] Triggered sync after settings update failed: ${err.message}`)
      );
    }

    return { success: true };
  });

  // Test provider connection
  fastify.post('/providers/:id/test', {
    onRequest: [(fastify as any).authenticate, adminOnly],
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
          // Any other response (200, 400, 429) means the key is accepted
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
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Get all AI models',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { provider_id?: string } }>, reply: FastifyReply) => {
    const { provider_id } = request.query;

    let query = `
      SELECT m.*, p.name as provider_name, p.display_name as provider_display_name, p.is_enabled as provider_enabled
      FROM ai_models m
      JOIN ai_providers p ON m.provider_id = p.id
    `;
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
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get models available to current user',
      tags: ['models'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id;

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
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Create new AI model',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { provider_id: string } }>, reply: FastifyReply) => {
    const { provider_id } = request.query;
    const body = createModelSchema.parse(request.body);

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
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Update AI model',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateModelSchema.parse(request.body);

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
        `UPDATE ai_models SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // If is_enabled changed, sync with Ollama if it's an Ollama model
    if (body.is_enabled !== undefined) {
      const model = await findOne<Model & { provider_name: string }>(
        fastify.db,
        `SELECT m.*, p.name as provider_name
         FROM ai_models m
         JOIN ai_providers p ON m.provider_id = p.id
         WHERE m.id = ?`,
        [id]
      );

      if (model && model.provider_name === 'ollama') {
        // Get Ollama base URL from settings
        const settings = await findAll<ProviderSetting>(
          fastify.db,
          'SELECT * FROM ai_provider_settings WHERE provider_id = ?',
          [model.provider_id]
        );
        const config: Record<string, string> = {};
        for (const s of settings) {
          config[s.setting_key] = s.is_secret ? decrypt(s.setting_value) : s.setting_value;
        }
        const baseUrl = config.base_url || 'http://localhost:11434';

        // Sync the model (pull or remove based on is_enabled)
        const ollamaService = getOllamaModelSyncService(baseUrl);
        const syncResult = await ollamaService.syncModel(model.model_id, body.is_enabled);

        fastify.log.info(`[OllamaSync] Model ${model.model_id}: ${syncResult.action} - ${syncResult.message}`);

        if (!syncResult.success && syncResult.action !== 'none') {
          // Log warning but don't fail the request - DB state is already updated
          fastify.log.warn(`[OllamaSync] Failed to sync model ${model.model_id}: ${syncResult.message}`);
        }

        return { success: true, ollamaSync: syncResult };
      }
    }

    return { success: true };
  });

  // Delete model
  fastify.delete('/models/:id', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Delete AI model',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    await fastify.db.execute('DELETE FROM ai_models WHERE id = ?', [id]);

    return { success: true };
  });
}
