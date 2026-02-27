import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { getOllamaModelSyncService } from '../../services/OllamaModelSyncService.js';
import { encrypt, decrypt } from '../../utils/crypto.js';

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

export async function providerRoutes(fastify: FastifyInstance) {
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

  // ==========================================
  // SYNC ENDPOINTS
  // ==========================================

  // Placeholder - OAuth providers have been removed
  // See migration: remove_oauth_providers.sql

  // Sync OpenAI models
  fastify.post('/providers/openai/sync', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Sync OpenAI models',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Get OpenAI provider
    const provider = await findOne<Provider>(
      fastify.db,
      "SELECT * FROM ai_providers WHERE name = 'openai'",
      []
    );

    if (!provider) {
      return reply.status(404).send({ error: 'OpenAI provider not found' });
    }

    // OpenAI models to add
    const openaiModels = [
      { id: 'gpt-4o', name: 'GPT-4o', desc: 'Most capable and multimodal model', context: 128000, output: 16384 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Fast and affordable for everyday tasks', context: 128000, output: 16384 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', desc: 'High performance with vision capabilities', context: 128000, output: 4096 },
      { id: 'gpt-4', name: 'GPT-4', desc: 'Original GPT-4 model', context: 8192, output: 4096 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', desc: 'Fast and cost-effective', context: 16385, output: 4096 },
      { id: 'o1', name: 'o1', desc: 'Advanced reasoning model', context: 200000, output: 100000 },
      { id: 'o1-mini', name: 'o1 Mini', desc: 'Smaller reasoning model', context: 128000, output: 65536 },
      { id: 'o1-preview', name: 'o1 Preview', desc: 'Preview of o1 model', context: 128000, output: 32768 },
      { id: 'o3-mini', name: 'o3 Mini', desc: 'Latest reasoning model', context: 200000, output: 100000 }
    ];

    try {
      let added = 0;
      for (const model of openaiModels) {
        const existing = await findOne(
          fastify.db,
          'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
          [provider.id, model.id]
        );

        if (!existing) {
          await insertOne(
            fastify.db,
            `INSERT INTO ai_models (
              provider_id, model_id, display_name, description, model_type,
              context_window, max_output_tokens, supports_streaming, is_enabled, sort_order
            ) VALUES (?, ?, ?, ?, 'chat', ?, ?, TRUE, TRUE, ?)`,
            [provider.id, model.id, model.name, model.desc, model.context, model.output, added]
          );
          added++;
        }
      }

      return {
        success: true,
        message: `Synced ${openaiModels.length} OpenAI models, added ${added} new`,
        models: openaiModels.map(m => m.id)
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to sync OpenAI models'
      });
    }
  });

  // Sync Ollama models (fetch from Ollama server)
  fastify.post('/providers/ollama/sync', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Sync models from Ollama server',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Get Ollama provider
    const provider = await findOne<Provider>(
      fastify.db,
      "SELECT * FROM ai_providers WHERE name = 'ollama'",
      []
    );

    if (!provider) {
      return reply.status(404).send({ error: 'Ollama provider not found' });
    }

    // Get settings
    const settings = await findAll<ProviderSetting>(
      fastify.db,
      'SELECT * FROM ai_provider_settings WHERE provider_id = ?',
      [provider.id]
    );

    const config: Record<string, string> = {};
    for (const s of settings) {
      config[s.setting_key] = s.is_secret ? decrypt(s.setting_value) : s.setting_value;
    }

    const baseUrl = config.base_url || 'http://localhost:11434';

    try {
      const ollamaSyncHeaders: Record<string, string> = {};
      if (process.env.OLLAMA_AUTH_KEY) ollamaSyncHeaders['X-Ollama-Key'] = process.env.OLLAMA_AUTH_KEY;
      const response = await fetch(`${baseUrl}/api/tags`, { headers: ollamaSyncHeaders });
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);

      const data = await response.json() as { models: Array<{ name: string; details?: { family?: string; parameter_size?: string } }> };
      const ollamaModels = data.models || [];

      let added = 0;
      for (const model of ollamaModels) {
        // Check if model already exists
        const existing = await findOne(
          fastify.db,
          'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
          [provider.id, model.name]
        );

        if (!existing) {
          await insertOne(
            fastify.db,
            `INSERT INTO ai_models (
              provider_id, model_id, display_name, description, model_type,
              context_window, max_output_tokens, supports_streaming, is_enabled, sort_order
            ) VALUES (?, ?, ?, ?, 'chat', 4096, 4096, TRUE, TRUE, ?)`,
            [
              provider.id,
              model.name,
              model.name,
              `${model.details?.family || 'Unknown'} - ${model.details?.parameter_size || 'Unknown size'}`,
              100 + added
            ]
          );
          added++;
        }
      }

      return {
        success: true,
        message: `Synced ${ollamaModels.length} models, added ${added} new`,
        models: ollamaModels.map(m => m.name)
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to sync Ollama models'
      });
    }
  });

  // ==========================================
  // OLLAMA DOCKER MANAGEMENT
  // ==========================================

  const OLLAMA_CONTAINER_NAME = 'enterprise-ai-ollama';

  // Helper to execute commands safely using execFile
  const execCommand = (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      execFile(cmd, args, { timeout: 300000 }, (error: any, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  // Deploy Ollama Docker container
  fastify.post('/providers/ollama/docker/deploy', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Deploy Ollama Docker container',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      port?: number;
      gpuEnabled?: boolean;
      memoryLimit?: string;
      models?: string[];
    };

    const port = body.port || 11434;
    const gpuEnabled = body.gpuEnabled ?? false;
    const memoryLimit = body.memoryLimit || '8g';
    const models = body.models || [];

    // Validate inputs
    if (port < 1024 || port > 65535) {
      return reply.status(400).send({ error: 'Invalid port number' });
    }
    if (!/^\d+[mg]$/i.test(memoryLimit)) {
      return reply.status(400).send({ error: 'Invalid memory limit format (e.g., 8g, 4096m)' });
    }

    try {
      // Check if Docker is available
      await execCommand('docker', ['--version']);

      // Stop existing container if running
      try {
        await execCommand('docker', ['stop', OLLAMA_CONTAINER_NAME]);
      } catch {}
      try {
        await execCommand('docker', ['rm', OLLAMA_CONTAINER_NAME]);
      } catch {}

      // Build docker run arguments
      const dockerArgs = [
        'run', '-d',
        '--name', OLLAMA_CONTAINER_NAME,
        '-p', `${port}:11434`,
        '-v', 'ollama-data:/root/.ollama',
        `--memory=${memoryLimit}`,
        '--restart=unless-stopped'
      ];

      // Add GPU support if enabled
      if (gpuEnabled) {
        dockerArgs.push('--gpus', 'all');
      }

      dockerArgs.push('ollama/ollama');

      fastify.log.info(`Starting Ollama container with args: ${dockerArgs.join(' ')}`);
      const { stdout } = await execCommand('docker', dockerArgs);
      const containerId = stdout.trim().substring(0, 12);

      // Wait for container to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Pull requested models
      const pulledModels: string[] = [];
      for (const model of models) {
        // Validate model name (alphanumeric, dots, colons, hyphens only)
        if (!/^[a-zA-Z0-9.:_-]+$/.test(model)) {
          fastify.log.warn(`Invalid model name: ${model}`);
          continue;
        }
        try {
          fastify.log.info(`Pulling model: ${model}`);
          await execCommand('docker', ['exec', OLLAMA_CONTAINER_NAME, 'ollama', 'pull', model]);
          pulledModels.push(model);
        } catch (err: any) {
          fastify.log.warn(`Failed to pull model ${model}: ${err.message}`);
        }
      }

      // Update provider settings with new base_url
      const provider = await findOne<Provider>(
        fastify.db,
        "SELECT * FROM ai_providers WHERE name = 'ollama'",
        []
      );

      if (provider) {
        const baseUrl = `http://localhost:${port}`;
        await fastify.db.execute(
          `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
           VALUES (?, 'base_url', ?, FALSE)
           ON DUPLICATE KEY UPDATE setting_value = ?`,
          [provider.id, baseUrl, baseUrl]
        );

        // Enable the provider
        await fastify.db.execute(
          'UPDATE ai_providers SET is_enabled = TRUE WHERE id = ?',
          [provider.id]
        );
      }

      return {
        success: true,
        containerId,
        port,
        gpuEnabled,
        memoryLimit,
        pulledModels,
        message: `Ollama container started on port ${port}. ${pulledModels.length} models pulled.`
      };
    } catch (error: any) {
      fastify.log.error(`Ollama deploy error: ${error.message}`);
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to deploy Ollama container'
      });
    }
  });

  // Get Ollama Docker status
  fastify.get('/providers/ollama/docker/status', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Get Ollama Docker container status',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { stdout } = await execCommand('docker', [
        'inspect', OLLAMA_CONTAINER_NAME,
        '--format', '{{.State.Status}}|{{.State.StartedAt}}'
      ]);

      const parts = stdout.trim().split('|');
      const status = parts[0];
      const startedAt = parts[1];

      // Get available models
      let models: string[] = [];
      if (status === 'running') {
        try {
          const { stdout: modelsOutput } = await execCommand('docker', [
            'exec', OLLAMA_CONTAINER_NAME, 'ollama', 'list'
          ]);
          // Parse ollama list output (skip header line)
          const lines = modelsOutput.trim().split('\n').slice(1);
          models = lines.map(line => line.split(/\s+/)[0]).filter(m => m.length > 0);
        } catch {}
      }

      return {
        running: status === 'running',
        status,
        startedAt,
        containerName: OLLAMA_CONTAINER_NAME,
        models
      };
    } catch (error: any) {
      return { running: false, status: 'not_deployed', models: [] };
    }
  });

  // Pull a model to Ollama container
  fastify.post('/providers/ollama/docker/pull-model', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Pull a model to Ollama container',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { model: string };

    if (!body.model?.trim()) {
      return reply.status(400).send({ error: 'Model name is required' });
    }

    // Validate model name
    const model = body.model.trim();
    if (!/^[a-zA-Z0-9.:_-]+$/.test(model)) {
      return reply.status(400).send({ error: 'Invalid model name' });
    }

    try {
      fastify.log.info(`Pulling model: ${model}`);
      await execCommand('docker', ['exec', OLLAMA_CONTAINER_NAME, 'ollama', 'pull', model]);

      return {
        success: true,
        message: `Model ${model} pulled successfully`
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to pull model'
      });
    }
  });

  // Stop Ollama Docker container
  fastify.delete('/providers/ollama/docker/stop', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Stop Ollama Docker container',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await execCommand('docker', ['stop', OLLAMA_CONTAINER_NAME]);
      await execCommand('docker', ['rm', OLLAMA_CONTAINER_NAME]);

      return {
        success: true,
        message: 'Ollama container stopped and removed'
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to stop container'
      });
    }
  });

  // Get available Ollama models from registry
  fastify.get('/providers/ollama/models/available', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Get list of popular Ollama models',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Popular models with their info
    return {
      models: [
        { id: 'llama3.2', name: 'Llama 3.2', size: '2B/3B', description: 'Meta latest small model' },
        { id: 'llama3.1:8b', name: 'Llama 3.1 8B', size: '8B', description: 'Meta Llama 3.1 8B' },
        { id: 'llama3.1:70b', name: 'Llama 3.1 70B', size: '70B', description: 'Meta Llama 3.1 70B (requires 48GB+ VRAM)' },
        { id: 'mistral', name: 'Mistral 7B', size: '7B', description: 'Fast and efficient' },
        { id: 'mixtral', name: 'Mixtral 8x7B', size: '47B', description: 'Mixture of experts' },
        { id: 'codellama', name: 'Code Llama', size: '7B/13B/34B', description: 'Optimized for code' },
        { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', size: '16B/236B', description: 'Advanced coding model' },
        { id: 'qwen2.5', name: 'Qwen 2.5', size: '0.5B-72B', description: 'Alibaba multilingual model' },
        { id: 'phi3', name: 'Phi-3', size: '3.8B', description: 'Microsoft small but capable' },
        { id: 'gemma2', name: 'Gemma 2', size: '2B/9B/27B', description: 'Google open model' },
        { id: 'llava', name: 'LLaVA', size: '7B/13B', description: 'Vision-enabled model' },
        { id: 'nomic-embed-text', name: 'Nomic Embed', size: '137M', description: 'Text embeddings' }
      ]
    };
  });
}
