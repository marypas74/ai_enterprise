import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
import { eventBus } from './services/EventBusService.js';
import { AIProviderFactory } from './modules/ai/providers.js';
import { AgentOrchestrator } from './services/AgentOrchestrator.js';
import { AgentEventEmitter } from './services/AgentEventEmitter.js';
import { LLMSyncWorker } from './services/LLMSyncWorker.js';
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

async function bootstrap() {
  // CORS
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
  });

  // Rate Limiting
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    allowList: (request) => {
      // Exclude health, version, admin, and WebSocket endpoints from rate limiting
      const url = request.url;
      if (url === '/health' || url === '/version' || url.startsWith('/api/version')) return true;
      if (url.startsWith('/api/admin')) return true;  // All admin endpoints
      if (url.startsWith('/ws/')) return true;  // WebSocket connections
      return false;
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

  // Swagger Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Enterprise AI Chat API',
        description: 'Multi-provider AI chat platform API',
        version: '1.0.0'
      },
      servers: [{ url: `http://localhost:${process.env.PORT || 3000}` }],
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
    routePrefix: '/docs'
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
  await fastify.register(formRoutes, { prefix: '/api/forms' });
  await fastify.register(ingestionRoutes, { prefix: '/api/ingestion' });

  // Initialize Agent Orchestrator
  try {
    await AgentOrchestrator.initialize(fastify.db);
    fastify.log.info('Agent Orchestrator initialized');
  } catch (err) {
    fastify.log.warn('Could not initialize Agent Orchestrator: ' + String(err));
  }

  // Initialize and start LLM Sync Worker
  try {
    console.log('[DEBUG] Starting LLMSyncWorker...');
    const syncWorker = new LLMSyncWorker(fastify);
    syncWorker.start();

    fastify.addHook('onClose', async () => {
      syncWorker.stop();
    });
  } catch (err) {
    fastify.log.warn('Could not initialize LLM Sync Worker: ' + String(err));
  }

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
  const debugClients = new Set<any>();

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

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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

    // Fire bootstrap event for hook system
    eventBus.emit('on_bootstrap', { port, host }, { userId: 0 }).catch(() => {});
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();

export { fastify };
