import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import crypto from 'crypto';

// Simple encryption for API keys (use a proper KMS in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production!!';

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  try {
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return text; // Return as-is if decryption fails
  }
}

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
      // Test connection based on provider name (more specific than provider_type)
      switch (provider.name) {
        case 'openai': {
          const response = await fetch(`${config.base_url || 'https://api.openai.com/v1'}/models`, {
            headers: { 'Authorization': `Bearer ${config.api_key}` }
          });
          if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
          break;
        }
        case 'anthropic_oauth': {
          // Claude Pro OAuth - test OAuth token
          const oauthTokenSetting = await findOne<ProviderSetting>(
            fastify.db,
            "SELECT * FROM ai_provider_settings WHERE provider_id = ? AND setting_key = 'oauth_token'",
            [id]
          );

          if (!oauthTokenSetting?.setting_value) {
            throw new Error('OAuth token non configurato. Configura il token OAuth.');
          }

          const decryptedToken = decrypt(oauthTokenSetting.setting_value);
          fastify.log.info(`Testing Claude OAuth - token prefix: ${decryptedToken.substring(0, 20)}...`);

          const testResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${decryptedToken}`,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'oauth-2025-04-20',
              'User-Agent': 'Claude-Code/2.1.0'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hi' }]
            })
          });

          const responseText = await testResponse.text();
          fastify.log.info(`Claude OAuth test response: ${testResponse.status} - ${responseText.substring(0, 200)}`);

          if (!testResponse.ok) {
            let errorMessage = `OAuth test fallito: ${testResponse.status}`;
            try {
              const errorData = JSON.parse(responseText);
              errorMessage = errorData.error?.message || errorMessage;
            } catch {}
            throw new Error(errorMessage);
          }
          break;
        }
        case 'anthropic_api':
        case 'anthropic': {
          // Claude API Key - test API key format
          if (!config.api_key) {
            throw new Error('API key non configurata');
          }
          if (!config.api_key.startsWith('sk-ant-')) {
            throw new Error('Formato API key non valido (deve iniziare con sk-ant-)');
          }
          // Key format is valid, will be tested when used
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
          const response = await fetch(`${config.base_url || 'http://localhost:11434'}/api/tags`);
          if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
          break;
        }
        default:
          return { success: true, message: 'Cannot test custom provider' };
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
  // CLAUDE PRO OAUTH
  // ==========================================

  // Claude OAuth Configuration
  // Reference: https://github.com/sst/opencode-anthropic-auth, https://github.com/grll/claude-code-login
  const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
  const CLAUDE_OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
  const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'; // IMPORTANT: /v1/ not /api/

  // Helper to store/get OAuth state in Redis (shared between pods)
  const OAUTH_STATE_PREFIX = 'oauth:claude:state:';
  const OAUTH_STATE_TTL = 600; // 10 minutes

  // Initiate Claude Pro OAuth flow
  fastify.post('/providers/anthropic/oauth/init', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Initiate Claude Pro OAuth flow',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    // Store code verifier in Redis for later token exchange (shared between pods)
    await fastify.redis.setex(
      `${OAUTH_STATE_PREFIX}${state}`,
      OAUTH_STATE_TTL,
      JSON.stringify({ codeVerifier, createdAt: Date.now() })
    );

    // The redirect URI that shows the code to copy (console.anthropic.com shows a nice UI)
    const redirectUri = 'https://console.anthropic.com/oauth/code/callback';

    const authUrl = new URL(CLAUDE_OAUTH_AUTHORIZE_URL);
    authUrl.searchParams.set('code', 'true');  // Important: enables code display page
    authUrl.searchParams.set('client_id', CLAUDE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'org:create_api_key user:profile user:inference'); // These are the correct scopes
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', redirectUri);

    return {
      authUrl: authUrl.toString(),
      state,
      instructions: 'Apri il link nel browser, autorizza, e poi copia il codice dalla URL di callback (parametro code=...) e invialo all\'endpoint /providers/anthropic/oauth/complete'
    };
  });

  // Complete Claude Pro OAuth flow with authorization code
  fastify.post('/providers/anthropic/oauth/complete', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Complete Claude Pro OAuth flow with authorization code',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { code: string; state: string };

    if (!body.code || !body.state) {
      return reply.status(400).send({ error: 'Missing code or state' });
    }

    // The code might be in format "code#state" - handle both cases
    let authCode = body.code;
    let authState = body.state;

    // If code contains #, split it (format: code#state from callback URL)
    if (authCode.includes('#')) {
      const parts = authCode.split('#');
      authCode = parts[0];
      // If state wasn't provided separately, extract from code
      if (!authState && parts[1]) {
        authState = parts[1];
      }
    }

    // Get stored code verifier from Redis
    const stateData = await fastify.redis.get(`${OAUTH_STATE_PREFIX}${authState}`);
    if (!stateData) {
      fastify.log.error(`OAuth state not found: ${authState}`);
      return reply.status(400).send({
        error: 'Invalid or expired state',
        details: 'The OAuth state has expired or was not found. Please restart the OAuth flow.'
      });
    }

    const { codeVerifier } = JSON.parse(stateData);
    // Delete the state from Redis after use
    await fastify.redis.del(`${OAUTH_STATE_PREFIX}${authState}`);

    try {
      // Exchange code for token - MUST match the redirect_uri used in init
      const redirectUri = 'https://console.anthropic.com/oauth/code/callback';

      fastify.log.info(`OAuth token exchange: code=${authCode.substring(0, 10)}..., state=${authState}`);

      const tokenRequestBody = {
        grant_type: 'authorization_code',
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        code: authCode,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        state: authState
      };

      const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(tokenRequestBody)
      });

      const responseText = await response.text();
      fastify.log.info(`OAuth token response: ${response.status} - ${responseText.substring(0, 200)}`);

      if (!response.ok) {
        let errorMessage = `Token exchange failed: ${response.status}`;
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error_description || errorData.error || errorMessage;
        } catch {
          errorMessage = responseText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const tokenData = JSON.parse(responseText) as { access_token: string; refresh_token?: string; expires_in?: number };

      if (!tokenData.access_token) {
        throw new Error('No access token in response');
      }

      // Get Anthropic OAuth provider (not anthropic_api)
      const provider = await findOne<Provider>(
        fastify.db,
        "SELECT * FROM ai_providers WHERE name = 'anthropic_oauth'",
        []
      );

      if (!provider) {
        return reply.status(404).send({ error: 'Anthropic OAuth provider not found' });
      }

      // Store OAuth token (encrypted)
      const encryptedToken = encrypt(tokenData.access_token);
      await fastify.db.execute(
        `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
         VALUES (?, 'oauth_token', ?, TRUE)
         ON DUPLICATE KEY UPDATE setting_value = ?, is_secret = TRUE`,
        [provider.id, encryptedToken, encryptedToken]
      );

      // Store refresh token if available
      if (tokenData.refresh_token) {
        const encryptedRefresh = encrypt(tokenData.refresh_token);
        await fastify.db.execute(
          `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
           VALUES (?, 'oauth_refresh_token', ?, TRUE)
           ON DUPLICATE KEY UPDATE setting_value = ?, is_secret = TRUE`,
          [provider.id, encryptedRefresh, encryptedRefresh]
        );
      }

      // Log audit (details must be valid JSON due to CHECK constraint)
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [(request.user as any).id, 'configure_oauth', 'ai_provider', provider.id, JSON.stringify({ message: 'Claude Pro OAuth configured' }), request.ip]
      );

      return {
        success: true,
        message: 'Claude Pro OAuth token configurato con successo! Tutti gli utenti possono ora usare Claude con la tua subscription.'
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Token exchange failed'
      });
    }
  });

  // Check Claude Pro OAuth status
  fastify.get('/providers/anthropic/oauth/status', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Check if Claude Pro OAuth is configured',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const provider = await findOne<Provider>(
      fastify.db,
      "SELECT * FROM ai_providers WHERE name = 'anthropic_oauth'",
      []
    );

    if (!provider) {
      return { configured: false, hasApiKey: false, hasOAuthToken: false };
    }

    const settings = await findAll<ProviderSetting>(
      fastify.db,
      'SELECT setting_key FROM ai_provider_settings WHERE provider_id = ? AND setting_value IS NOT NULL AND setting_value != ?',
      [provider.id, '']
    );

    const settingKeys = settings.map(s => s.setting_key);

    return {
      configured: settingKeys.includes('api_key') || settingKeys.includes('oauth_token'),
      hasApiKey: settingKeys.includes('api_key'),
      hasOAuthToken: settingKeys.includes('oauth_token'),
      preferOAuth: settingKeys.includes('oauth_token') // OAuth has priority over API key
    };
  });

  // Remove Claude Pro OAuth token
  fastify.delete('/providers/anthropic/oauth', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Remove Claude Pro OAuth token',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const provider = await findOne<Provider>(
      fastify.db,
      "SELECT * FROM ai_providers WHERE name = 'anthropic_oauth'",
      []
    );

    if (!provider) {
      return reply.status(404).send({ error: 'Anthropic OAuth provider not found' });
    }

    await fastify.db.execute(
      "DELETE FROM ai_provider_settings WHERE provider_id = ? AND setting_key IN ('oauth_token', 'oauth_refresh_token')",
      [provider.id]
    );

    // Log audit (details must be valid JSON)
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [(request.user as any).id, 'remove_oauth', 'ai_provider', provider.id, JSON.stringify({ message: 'Claude Pro OAuth removed' }), request.ip]
    );

    return { success: true, message: 'Claude Pro OAuth token rimosso' };
  });

  // Set Claude Pro OAuth token manually (from claude login credentials)
  fastify.post('/providers/anthropic/oauth/token', {
    onRequest: [(fastify as any).authenticate, adminOnly],
    schema: {
      description: 'Set Claude Pro OAuth token manually',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { accessToken: string; refreshToken?: string };

    if (!body.accessToken?.trim()) {
      return reply.status(400).send({ error: 'Access token is required' });
    }

    const accessToken = body.accessToken.trim();

    // Validate token format (should start with specific prefix for OAuth tokens)
    if (!accessToken.startsWith('sk-ant-')) {
      return reply.status(400).send({
        error: 'Invalid token format. Token should start with sk-ant-. Make sure you copied the accessToken from ~/.claude/credentials.json'
      });
    }

    try {
      // Test the token by making a simple API call
      const testResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20'  // Required for OAuth tokens
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (!testResponse.ok) {
        const errorData = await testResponse.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(errorData.error?.message || `Token validation failed: ${testResponse.status}`);
      }

      // Get Anthropic OAuth provider
      const provider = await findOne<Provider>(
        fastify.db,
        "SELECT * FROM ai_providers WHERE name = 'anthropic_oauth'",
        []
      );

      if (!provider) {
        return reply.status(404).send({ error: 'Anthropic OAuth provider not found' });
      }

      // Store OAuth token (encrypted)
      const encryptedToken = encrypt(accessToken);
      await fastify.db.execute(
        `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
         VALUES (?, 'oauth_token', ?, TRUE)
         ON DUPLICATE KEY UPDATE setting_value = ?, is_secret = TRUE`,
        [provider.id, encryptedToken, encryptedToken]
      );

      // Store refresh token if provided
      if (body.refreshToken?.trim()) {
        const encryptedRefresh = encrypt(body.refreshToken.trim());
        await fastify.db.execute(
          `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
           VALUES (?, 'oauth_refresh_token', ?, TRUE)
           ON DUPLICATE KEY UPDATE setting_value = ?, is_secret = TRUE`,
          [provider.id, encryptedRefresh, encryptedRefresh]
        );
      }

      // Log audit (details must be valid JSON due to CHECK constraint)
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [(request.user as any).id, 'set_oauth_token', 'ai_provider', provider.id, JSON.stringify({ message: 'Claude Pro OAuth token set manually' }), request.ip]
      );

      return {
        success: true,
        message: 'Claude Pro OAuth token configurato con successo! Il token è stato validato e funziona correttamente.'
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to validate token'
      });
    }
  });

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
      const response = await fetch(`${baseUrl}/api/tags`);
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
}
