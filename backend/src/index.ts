import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import path from 'path';
import 'dotenv/config';

import { databasePlugin } from './database/index.js';
import { redisPlugin } from './cache/index.js';
import { geoPlugin } from './modules/geo/index.js';
import { authRoutes } from './modules/auth/routes.js';
import { publicRoutes } from './modules/public/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { providerRoutes } from './modules/admin/providers.js';
import { settingsRoutes } from './modules/admin/settings.js';
import { orchestratorAdminRoutes } from './modules/admin/orchestrator.js';
import { skillRoutes } from './modules/admin/skills.js';
import { pluginRoutes } from './modules/admin/plugins.js';
import { projectRoutes } from './modules/projects/routes.js';
import { activityRoutes } from './modules/activity/routes.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { agentRoutes } from './modules/agents/routes.js';
import { agentSdkRoutes } from './modules/agents/agentSdkRoutes.js';
import { orchestratorRoutes } from './modules/orchestrator/routes.js';
import { googleOAuthRoutes } from './modules/auth/googleOAuthRoutes.js';
import { debugRoutes, addToLogBuffer } from './modules/admin/debug.js';
import { downloadRoutes } from './modules/downloads/routes.js';
import { parlantRoutes } from './modules/parlant/routes.js';
import { ralphRoutes } from './modules/ralph/routes.js';
import fileRoutes from './modules/files/routes.js';
import attachmentRoutes from './modules/attachments/routes.js';
import { toolsRoutes } from './modules/tools/routes.js';
import { memoryRoutes } from './modules/memory/routes.js';
import { vectorMemoryRoutes } from './modules/memory/vectorMemoryRoutes.js';
import { hookRoutes } from './modules/admin/hooks.js';
import { formRoutes } from './modules/forms/routes.js';
import { ingestionRoutes } from './modules/ingestion/routes.js';
import { schedulerRoutes } from './modules/scheduler/routes.js';
import { batchRoutes } from './modules/batch/routes.js';
import { permissionRoutes } from './modules/admin/permissions.js';
import { complianceRoutes } from './modules/compliance/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { BiasMonitorService } from './modules/compliance/biasMonitorService.js';
import { eventBus } from './services/EventBusService.js';
import { HyDEService } from './services/HyDEService.js';
import { AIProviderFactory } from './modules/ai/providers.js';
import { AgentOrchestrator } from './services/AgentOrchestrator.js';
import { AgentEventEmitter } from './services/AgentEventEmitter.js';
import { LLMSyncWorker } from './services/LLMSyncWorker.js';
import { MCPClientManager } from './services/MCPClientManager.js';
import { MemoryDecayService } from './services/MemoryDecayService.js';
import { ConversationCleanupService } from './services/ConversationCleanupService.js';
import websocket from '@fastify/websocket';
import { findAll, findOne } from './database/index.js';
import { decryptSecret } from './utils/crypto.js';

// Validate ENCRYPTION_KEY is set
if (!process.env.ENCRYPTION_KEY) {
  console.error('FATAL: ENCRYPTION_KEY environment variable is required. Set it before starting the server.');
  process.exit(1);
}

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined
  },
  bodyLimit: 50 * 1024 * 1024 // 50MB limit for JSON bodies (needed for large document generation)
});

// ─── Application plugin ───────────────────────────────────────────────
// Everything that needs register/addHook/decorate MUST live inside this
// plugin so that avvio keeps the boot phase open while async DB queries
// and provider configuration run.  Without this wrapper, any non-register
// `await` at root level causes avvio to finalise boot prematurely and all
// subsequent register()/addHook()/get() calls throw
// AVV_ERR_ROOT_PLG_BOOTED or FST_ERR_INSTANCE_ALREADY_LISTENING.
const appPlugin = fp(async function (fastify) {

  // Load AI provider configurations from database
  try {
    interface ProviderSetting {
      provider_name: string;
      setting_key: string;
      setting_value: string;
      is_secret: boolean;
    }

    const providerSettings = await findAll<ProviderSetting>(
      fastify.db,
      `SELECT p.provider_type as provider_name, ps.setting_key, ps.setting_value, ps.is_secret
       FROM ai_provider_settings ps
       JOIN ai_providers p ON ps.provider_id = p.id
       WHERE p.is_enabled = TRUE`
    );

    // Group settings by provider
    const configByProvider: Record<string, Record<string, string>> = {};
    for (const setting of providerSettings) {
      if (!configByProvider[setting.provider_name]) {
        configByProvider[setting.provider_name] = {};
      }
      const value = setting.is_secret ? decryptSecret(setting.setting_value) : setting.setting_value;
      configByProvider[setting.provider_name][setting.setting_key] = value;
    }

    // Configure each provider
    // For Anthropic: API Key takes priority (OAuth tokens are restricted to Claude Code only)
    const anthropicOAuthSettings = configByProvider['anthropic_oauth'];
    const anthropicApiSettings = configByProvider['anthropic_api'] || configByProvider['anthropic'];

    // Set up Anthropic provider - API Key takes priority (OAuth restricted by Anthropic)
    let anthropicApiKey: string | undefined;
    if (anthropicApiSettings?.api_key) {
      anthropicApiKey = anthropicApiSettings.api_key;
      fastify.log.info('Using API key for Anthropic provider');
    } else if (anthropicOAuthSettings?.oauth_token) {
      // OAuth tokens are restricted to Claude Code only - will likely fail for web chat
      anthropicApiKey = anthropicOAuthSettings.oauth_token;
      fastify.log.warn('Using OAuth token for Anthropic - may be restricted by Anthropic to Claude Code only');
    }

    if (anthropicApiKey) {
      AIProviderFactory.setProviderConfig('anthropic', { apiKey: anthropicApiKey });
      fastify.log.info('Loaded configuration for provider: anthropic');
    }

    // Configure other providers
    for (const [providerName, settings] of Object.entries(configByProvider)) {
      // Skip anthropic variants - already handled above
      if (providerName === 'anthropic' || providerName === 'anthropic_oauth' || providerName === 'anthropic_api') {
        continue;
      }

      AIProviderFactory.setProviderConfig(providerName as any, {
        apiKey: settings.api_key,
        baseUrl: settings.base_url,
        timeout: settings.timeout ? parseInt(settings.timeout, 10) : 120000,
        keepAlive: settings.keep_alive || '5m'
      });

      fastify.log.info(`Loaded configuration for provider: ${providerName}`);
    }
  } catch (err) {
    fastify.log.warn('Could not load provider configurations from database: ' + String(err));
  }

  // JWT Authentication Decorator with detailed logging
  fastify.decorate('authenticate', async function (request: any, reply: any) {
    const authHeader = request.headers.authorization;
    const url = request.url;

    // Log auth attempt for debugging
    if (!authHeader) {
      fastify.log.warn(`[Auth] No Authorization header for ${url}`);
      return reply.status(401).send({ error: 'Unauthorized', reason: 'Missing Authorization header' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      fastify.log.warn(`[Auth] Invalid Authorization format for ${url}`);
      return reply.status(401).send({ error: 'Unauthorized', reason: 'Invalid token format' });
    }

    try {
      await request.jwtVerify();
      fastify.log.debug(`[Auth] OK for ${url} - User: ${request.user?.id}`);

      // CRITICAL: Enforce mfa_verified — setup tokens can only access MFA routes
      const mfaVerified = request.user?.mfa_verified;
      if (mfaVerified === false) {
        const isMfaRoute = url.startsWith('/api/auth/mfa/') || url === '/api/auth/me';
        if (!isMfaRoute) {
          fastify.log.warn(`[Auth] MFA setup token used on non-MFA route: ${url}`);
          return reply.status(403).send({ error: 'MFA setup required', reason: 'Complete MFA setup before accessing the application' });
        }
      }

      // Verify session is still active using the session ID embedded in the JWT
      const userId = request.user?.id;
      const sessionId = request.user?.sid;
      if (userId && fastify.db) {
        if (sessionId) {
          // JWT has a session ID — verify THIS specific session is still active
          const [sessions] = await fastify.db.execute(
            `SELECT id, last_activity_at FROM user_sessions
             WHERE user_id = ? AND LEFT(token_hash, 16) = ? AND revoked_at IS NULL AND logged_out_at IS NULL AND expires_at > NOW()
             LIMIT 1`,
            [userId, sessionId]
          ) as any;

          if (!sessions || sessions.length === 0) {
            fastify.log.warn(`[Auth] Session revoked or expired for user ${userId} (sid: ${sessionId})`);
            return reply.status(401).send({ error: 'Unauthorized', reason: 'Session revoked' });
          }

          const session = sessions[0];
          const lastActivity = session.last_activity_at ? new Date(session.last_activity_at).getTime() : 0;
          const fifteenMinMs = 15 * 60 * 1000;

          if (Date.now() - lastActivity > fifteenMinMs) {
            await fastify.db.execute(
              'UPDATE user_sessions SET revoked_at = NOW(), logged_out_at = NOW() WHERE id = ?',
              [session.id]
            );
            fastify.log.warn(`[Auth] Session expired due to inactivity for user ${userId}`);
            return reply.status(401).send({ error: 'Unauthorized', reason: 'Session expired due to inactivity' });
          }

          // Update last_activity_at (fire & forget)
          fastify.db.execute(
            'UPDATE user_sessions SET last_activity_at = NOW() WHERE id = ?',
            [session.id]
          ).catch(() => { /* non-critical */ });
        } else {
          // Legacy JWT without session ID — fallback to any active session check
          const [sessions] = await fastify.db.execute(
            `SELECT id, last_activity_at FROM user_sessions
             WHERE user_id = ? AND revoked_at IS NULL AND logged_out_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
          ) as any;

          if (!sessions || sessions.length === 0) {
            fastify.log.warn(`[Auth] No active session found for user ${userId}`);
            return reply.status(401).send({ error: 'Unauthorized', reason: 'Session expired' });
          }

          const session = sessions[0];
          const lastActivity = session.last_activity_at ? new Date(session.last_activity_at).getTime() : 0;
          const fifteenMinMs = 15 * 60 * 1000;

          if (Date.now() - lastActivity > fifteenMinMs) {
            await fastify.db.execute(
              'UPDATE user_sessions SET revoked_at = NOW(), logged_out_at = NOW() WHERE id = ?',
              [session.id]
            );
            fastify.log.warn(`[Auth] Session expired due to inactivity for user ${userId}`);
            return reply.status(401).send({ error: 'Unauthorized', reason: 'Session expired due to inactivity' });
          }

          // Update last_activity_at (fire & forget)
          fastify.db.execute(
            'UPDATE user_sessions SET last_activity_at = NOW() WHERE id = ?',
            [session.id]
          ).catch(() => { /* non-critical */ });
        }
      }
    } catch (err: any) {
      fastify.log.warn(`[Auth] JWT verify failed for ${url}: ${err.message}`);
      return reply.status(401).send({ error: 'Unauthorized', reason: err.message });
    }
  });

  // Routes
  await fastify.register(publicRoutes, { prefix: '/api/public' });
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(chatRoutes, { prefix: '/api/chat' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(providerRoutes, { prefix: '/api/admin' });
  await fastify.register(settingsRoutes, { prefix: '/api/admin' });
  await fastify.register(skillRoutes, { prefix: '/api' });
  await fastify.register(pluginRoutes, { prefix: '/api' });
  await fastify.register(projectRoutes, { prefix: '/api/projects' });
  await fastify.register(taskRoutes, { prefix: '/api' });
  await fastify.register(activityRoutes, { prefix: '/api' });
  await fastify.register(agentRoutes, { prefix: '/api/agents' });
  await fastify.register(agentSdkRoutes, { prefix: '/api/agents' });
  await fastify.register(orchestratorRoutes, { prefix: '/api/orchestrator' });
  await fastify.register(googleOAuthRoutes, { prefix: '/api/auth' });
  await fastify.register(debugRoutes, { prefix: '/api/admin' });
  await fastify.register(downloadRoutes, { prefix: '/api' });
  await fastify.register(parlantRoutes, { prefix: '/api/parlant' });
  await fastify.register(ralphRoutes, { prefix: '/api/ralph' });
  await fastify.register(fileRoutes, { prefix: '/api/files' });
  await fastify.register(attachmentRoutes, { prefix: '/api/attachments' });
  await fastify.register(toolsRoutes, { prefix: '/api' });
  await fastify.register(memoryRoutes, { prefix: '/api/memory' });
  await fastify.register(vectorMemoryRoutes, { prefix: '/api/memory/vector' });
  await fastify.register(hookRoutes, { prefix: '/api/admin' });
  await fastify.register(orchestratorAdminRoutes, { prefix: '/api/admin' });
  await fastify.register(formRoutes, { prefix: '/api/forms' });
  await fastify.register(ingestionRoutes, { prefix: '/api/ingestion' });
  await fastify.register(schedulerRoutes, { prefix: '/api/scheduler' });
  await fastify.register(batchRoutes, { prefix: '/api/batch' });
  await fastify.register(permissionRoutes, { prefix: '/api/permissions' });
  await fastify.register(complianceRoutes, { prefix: '/api' });
  await fastify.register(documentRoutes, { prefix: '/api/documents' });

  // Debug WebSocket clients set (defined early so addHook can reference it)
  const debugClients = new Set<any>();

  // Hook to capture all request logs
  fastify.addHook('onResponse', (request, reply, done) => {
    const log = {
      type: 'log',
      level: reply.statusCode >= 400 ? 'error' : 'info',
      msg: `${request.method} ${request.url} - ${reply.statusCode}`,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
      timestamp: new Date().toISOString()
    };

    // Add to buffer
    addToLogBuffer(log);

    // Broadcast to debug WebSocket clients
    const message = JSON.stringify(log);
    debugClients.forEach(client => {
      try {
        client.send(message);
      } catch {
        debugClients.delete(client);
      }
    });

    done();
  });

  // WebSocket JWT authentication helper
  const authenticateWs = async (request: any): Promise<boolean> => {
    try {
      // Check token from query string (?token=xxx) since WebSocket doesn't support custom headers
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      if (token) {
        request.headers.authorization = `Bearer ${token}`;
      }
      await request.jwtVerify();
      return true;
    } catch {
      return false;
    }
  };

  // WebSocket routes for real-time agent updates
  fastify.register(async function (fastify) {
    // WebSocket for specific session
    fastify.get('/ws/agents/:sessionId', { websocket: true }, async (socket, request) => {
      if (!(await authenticateWs(request))) {
        socket.send(JSON.stringify({ error: 'Unauthorized' }));
        socket.close();
        return;
      }

      const params = request.params as { sessionId: string };
      const sessionId = parseInt(params.sessionId);

      // Subscribe to session events
      const unsubscribe = AgentEventEmitter.subscribeToSession(sessionId, (event) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          unsubscribe();
        }
      });

      socket.on('close', () => {
        unsubscribe();
      });

      socket.on('error', () => {
        unsubscribe();
      });
    });

    // WebSocket for orchestrator updates
    fastify.get('/ws/orchestrator', { websocket: true }, async (socket, request) => {
      if (!(await authenticateWs(request))) {
        socket.send(JSON.stringify({ error: 'Unauthorized' }));
        socket.close();
        return;
      }

      // Send initial metrics
      try {
        const metrics = await AgentOrchestrator.getDashboardMetrics(fastify.db);
        socket.send(JSON.stringify({ type: 'initial', ...metrics }));
      } catch { /* ignore */ }

      // Subscribe to orchestrator events
      const unsubscribe = AgentEventEmitter.subscribeToOrchestrator((event) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          unsubscribe();
        }
      });

      socket.on('close', () => {
        unsubscribe();
      });

      socket.on('error', () => {
        unsubscribe();
      });
    });
  });

  // Debug WebSocket for real-time logs
  fastify.register(async function (fastify) {
    fastify.get('/ws/debug', { websocket: true }, async (socket, request) => {
      if (!(await authenticateWs(request))) {
        socket.send(JSON.stringify({ error: 'Unauthorized' }));
        socket.close();
        return;
      }

      debugClients.add(socket);

      socket.on('close', () => {
        debugClients.delete(socket);
      });

      socket.on('error', () => {
        debugClients.delete(socket);
      });
    });
  });

  // Health check — verifies DB and Redis connectivity
  fastify.get('/health', async (request, reply) => {
    const checks: Record<string, string> = { status: 'ok', timestamp: new Date().toISOString() };
    try {
      await fastify.db.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      checks.status = 'degraded';
    }
    try {
      if ((fastify as any).redis) {
        await (fastify as any).redis.ping();
        checks.redis = 'ok';
      } else {
        checks.redis = 'not_configured';
      }
    } catch {
      checks.redis = 'error';
      checks.status = 'degraded';
    }
    const statusCode = checks.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(checks);
  });

  // Version endpoint - reads app_version from system_settings (single source of truth)
  const BUILD_TIME = new Date().toISOString();
  const versionHandler = async () => {
    let version = '0.0.0';
    try {
      const row = await findOne<{ setting_value: string }>(
        fastify.db,
        "SELECT setting_value FROM system_settings WHERE setting_key = 'app_version'",
        []
      );
      if (row) version = row.setting_value;
    } catch { /* DB not ready yet */ }
    return {
      name: 'enterprise-ai-chat-backend',
      version,
      buildTime: BUILD_TIME,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    };
  };
  fastify.get('/version', versionHandler);
  fastify.get('/api/version', versionHandler);
});

async function bootstrap() {
  // CORS - support multiple origins (comma-separated in env var)
  const corsOriginEnv = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const corsOrigins = corsOriginEnv.includes(',')
    ? corsOriginEnv.split(',').map(o => o.trim())
    : corsOriginEnv;
  await fastify.register(cors, {
    origin: corsOrigins,
    credentials: true
  });

  // H-05: Security headers via helmet
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Managed by frontend/nginx
    crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources
  });

  // Rate Limiting
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    allowList: (request) => {
      // Exclude health, version, and WebSocket endpoints from rate limiting
      const url = request.url;
      if (url === '/health' || url === '/version' || url.startsWith('/api/version')) return true;
      // SECURITY: /api/public NO LONGER excluded — has its own per-route rate limits
      if (url.startsWith('/ws/')) return true;  // WebSocket connections
      return false;
    },
    // SECURITY: Use real client IP from Cloudflare Tunnel (CF-Connecting-IP header)
    // Behind Cloudflare Tunnel, request.ip is always ::1, breaking per-IP rate limiting
    keyGenerator: (request) => {
      return (request.headers['cf-connecting-ip'] as string) || request.ip;
    }
  });


  // JWT
  await fastify.register(jwt, {
    secret: (() => {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        console.error('FATAL: JWT_SECRET environment variable is required. Set it before starting the server.');
        process.exit(1);
      }
      return jwtSecret;
    })(),
    sign: { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  });

  // Cookies
  await fastify.register(cookie);

  // Multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max
      files: 10, // Max 10 files per request
    },
  });

  // WebSocket support for real-time updates
  await fastify.register(websocket);

  // H-04: Swagger/OpenAPI Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Enterprise AI Chat API',
        description: 'Multi-provider AI chat platform with agent orchestration, project management, and RAG pipeline',
        version: process.env.APP_VERSION || '2.1.12'
      },
      servers: [
        { url: `http://localhost:${process.env.PORT || 3000}`, description: 'Local' },
        ...(process.env.NODE_ENV === 'production' ? [{ url: 'https://plane.lushlolli.com', description: 'Production' }] : [])
      ],
      tags: [
        { name: 'auth', description: 'Authentication and session management' },
        { name: 'chat', description: 'Chat completions and conversations' },
        { name: 'agents', description: 'AI agent sessions and templates' },
        { name: 'projects', description: 'Project management and Kanban boards' },
        { name: 'admin', description: 'Administration and system settings' },
        { name: 'memory', description: 'Vector memory and observations' },
        { name: 'tools', description: 'File generation and document tools' },
        { name: 'files', description: 'File operations' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      }
    }
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
  });

  // Global no-cache headers on all API responses
  fastify.addHook('onSend', (request, reply, payload, done) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    reply.header('Surrogate-Control', 'no-store');
    done();
  });

  // Database & Cache
  await fastify.register(databasePlugin);

  await fastify.register(redisPlugin);

  // Geo-Referencing Middleware
  await fastify.register(geoPlugin);

  // ─── Application logic (wrapped in plugin to keep avvio boot open) ───
  await fastify.register(appPlugin);

  // Start server
  const port = parseInt(process.env.PORT || '3000');
  const host = process.env.HOST || '0.0.0.0';

  // Cleanup stuck processing jobs (After all plugins/decorators are loaded)
  fastify.ready().then(async () => {
    try {
      await fastify.db.execute(
        "UPDATE chat_attachments SET processing_status = 'failed', processing_error = 'Server restarted during processing' WHERE processing_status = 'processing'"
      );
      fastify.log.info('[Startup] Cleaned up stuck processing jobs');
    } catch (err) {
      fastify.log.warn('[Startup] Failed to cleanup stuck jobs: ' + err);
    }
  });

  try {
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);
    fastify.log.info(`Documentation available at http://${host}:${port}/docs`);

    // ── Post-boot initialization (no register/addHook allowed after listen) ──

    // Initialize Plugin Loader ("Mad Hatter")
    try {
      const { PluginLoaderService } = await import('./services/PluginLoaderService.js');
      const pluginLoader = PluginLoaderService.getInstance(fastify, fastify.db);
      await pluginLoader.discoverAndLoad();
      const loadedCount = pluginLoader.getLoadedPlugins().filter(p => p.active).length;
      if (loadedCount > 0) {
        fastify.log.info(`[PluginLoader] ${loadedCount} plugins activated`);
      }
    } catch (err) {
      fastify.log.warn('Could not initialize Plugin Loader: ' + String(err));
    }

    // Initialize Agent Orchestrator
    try {
      await AgentOrchestrator.initialize(fastify.db);
      fastify.log.info('Agent Orchestrator initialized');
    } catch (err) {
      fastify.log.warn('Could not initialize Agent Orchestrator: ' + String(err));
    }

    // Initialize and start LLM Sync Worker
    let syncWorker: LLMSyncWorker | null = null;
    try {
      syncWorker = new LLMSyncWorker(fastify);
      syncWorker.start();
      // Expose worker for on-demand trigger from admin routes
      (fastify as any).llmSyncWorker = syncWorker;
    } catch (err) {
      fastify.log.warn('Could not initialize LLM Sync Worker: ' + String(err));
    }

    // All shutdown handlers consolidated below (after service initialization)

    // Initialize HyDE service and register hook
    try {
      const hydeService = new HyDEService(fastify, fastify.db);
      await hydeService.loadConfig();
      hydeService.registerHook();
      fastify.log.info('[Startup] HyDE service initialized');
    } catch (err) {
      fastify.log.warn('[Startup] HyDE service initialization failed: ' + err);
    }

    // Initialize Vision Service with DB for dynamic model resolution
    try {
      const { VisionService } = await import('./services/VisionService.js');
      VisionService.getInstance().setDb(fastify.db);
      fastify.log.info('[Startup] VisionService initialized with DB pool');
    } catch (err) {
      fastify.log.warn('[Startup] VisionService initialization failed: ' + err);
    }

    // Initialize MCP Client Manager
    try {
      const mcpManager = MCPClientManager.getInstance();
      await mcpManager.initialize(fastify.db);
      const mcpStatus = mcpManager.getStatus();
      if (mcpStatus.length > 0) {
        fastify.log.info(`[Startup] MCP Client Manager: ${mcpStatus.filter(s => s.connected).length}/${mcpStatus.length} servers connected`);
      }
    } catch (err) {
      fastify.log.warn('[Startup] MCP Client Manager initialization failed: ' + err);
    }

    // Initialize Memory Decay Service
    const memoryDecay = new MemoryDecayService();
    memoryDecay.start(fastify.db);
    // Initialize Bias Monitor Service (AI Act GAP-11)
    const biasMonitor = new BiasMonitorService(fastify);
    biasMonitor.start();

    // Initialize Conversation Cleanup Service (archive >24h, delete >60d)
    const conversationCleanup = new ConversationCleanupService();
    conversationCleanup.start(fastify.db);

    // Cleanup old generated files every hour (delete files older than 24h)
    const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
    const cleanupGeneratedFiles = async () => {
      try {
        const { readdir, stat, unlink } = await import('fs/promises');
        const files = await readdir(generatedDir).catch(() => [] as string[]);
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        let cleaned = 0;
        for (const file of files) {
          const filePath = path.join(generatedDir, file);
          const fileStat = await stat(filePath).catch(() => null);
          if (fileStat && Date.now() - fileStat.mtimeMs > maxAge) {
            await unlink(filePath).catch(() => { });
            cleaned++;
          }
        }
        if (cleaned > 0) {
          fastify.log.info(`[Cleanup] Removed ${cleaned} expired generated files`);
        }
      } catch (err) {
        fastify.log.warn(`[Cleanup] Generated files cleanup failed: ${err}`);
      }
    };
    // Run once on startup, then every hour
    cleanupGeneratedFiles();
    const cleanupInterval = setInterval(cleanupGeneratedFiles, 60 * 60 * 1000);
    // Consolidated graceful shutdown handler
    const gracefulShutdown = async () => {
      fastify.log.info('[Shutdown] Graceful shutdown initiated...');
      syncWorker?.stop();
      memoryDecay.stop();
      biasMonitor.stop();
      conversationCleanup.stop();
      clearInterval(cleanupInterval);
      await fastify.close();
    };
    process.once('SIGTERM', gracefulShutdown);
    process.once('SIGINT', gracefulShutdown);

    // Register built-in tools as procedural memory for semantic tool selection
    try {
      const { storeProcedural } = await import('./services/VectorMemoryService.js');
      const { getToolDefinitions } = await import('./services/ToolService.js');
      const tools = getToolDefinitions();
      let registered = 0;
      for (const tool of tools) {
        const success = await storeProcedural(fastify.db, registered + 1, tool.name, tool.description, 'tool', 'built-in');
        if (success) registered++;
      }
      if (registered > 0) {
        fastify.log.info(`[Startup] Registered ${registered} built-in tools in procedural memory`);
      }
    } catch (err) {
      fastify.log.warn('[Startup] Procedural memory registration failed: ' + err);
    }

    // Fire bootstrap event for hook system
    eventBus.emit('on_bootstrap', { port, host }, { userId: 0 }).catch(() => { });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();

export { fastify };
