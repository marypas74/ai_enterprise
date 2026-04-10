import { FastifyInstance, FastifyRequest } from 'fastify';
import { findMany, findOne } from '../../database/index.js';
import { clearModelsCache } from '../../services/ModelFetcher.js';
import { fetchParlantAgents, checkParlantHealth } from '../../services/ParlantProvider.js';

export async function modelRoutes(fastify: FastifyInstance) {

  // Get available models - from database (admin-enabled only)
  fastify.get('/models', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get AI models enabled by admin',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const { id: userId } = request.user as { id: number };
    const userRecord = await findOne<{ local_only: boolean }>(
      fastify.db,
      'SELECT local_only FROM users WHERE id = ?',
      [userId]
    );
    const isLocalOnly = userRecord?.local_only === true || (userRecord as any)?.local_only === 1;
    interface EnabledModel {
      model_id: string;
      display_name: string;
      description: string | null;
      provider_name: string;
      provider_type: string;
      supports_streaming: boolean;
      supports_functions: boolean;
      supports_vision: boolean;
    }

    const LOCAL_PROVIDER_TYPES = new Set(['ollama', 'vllm', 'custom']);

    const modelsQuery = isLocalOnly
      ? `SELECT m.model_id, m.display_name, m.description,
                p.name as provider_name, p.provider_type,
                m.supports_streaming, m.supports_functions, m.supports_vision
         FROM ai_models m
         JOIN ai_providers p ON m.provider_id = p.id
         WHERE m.is_enabled = TRUE
           AND p.is_enabled = TRUE
           AND m.model_type IN ('chat', 'completion')
           AND p.provider_type IN ('ollama', 'vllm', 'custom')
         ORDER BY p.name, m.sort_order, m.display_name`
      : `SELECT m.model_id, m.display_name, m.description,
                p.name as provider_name, p.provider_type,
                m.supports_streaming, m.supports_functions, m.supports_vision
         FROM ai_models m
         JOIN ai_providers p ON m.provider_id = p.id
         WHERE m.is_enabled = TRUE
           AND p.is_enabled = TRUE
           AND m.model_type IN ('chat', 'completion')
         ORDER BY p.name, m.sort_order, m.display_name`;

    const models = await findMany<EnabledModel>(fastify.db, modelsQuery);

    // Build result list with optional "auto" routing at the top
    const result: Array<{ id: string; name: string; provider: string; provider_type: string; is_local: boolean; description?: string; supportsStreaming: boolean; supportsFunctions: boolean; supportsVision: boolean }> = [];

    // Add "Auto" smart routing option if enabled (never for local-only users)
    try {
      const [settingRows] = await fastify.db.execute(
        `SELECT setting_value FROM model_routing_settings WHERE setting_key = 'auto_routing_enabled'`
      ) as any;
      const autoEnabled = settingRows?.[0]?.setting_value === 'true';
      if (autoEnabled && models.length > 1 && !isLocalOnly) {
        const hasExternalModels = models.some(m => !LOCAL_PROVIDER_TYPES.has(m.provider_type));
        result.push({
          id: 'auto',
          name: 'Auto (Smart Routing)',
          provider: 'Orchestrator',
          provider_type: 'orchestrator',
          is_local: !hasExternalModels,
          description: 'Seleziona automaticamente il modello migliore in base alla complessità della richiesta',
          supportsStreaming: true,
          supportsFunctions: true,
          supportsVision: true,
        });
      }
    } catch { /* model_routing_settings table may not exist yet */ }

    // Transform DB models to expected format
    result.push(...models.map(m => ({
      id: m.model_id,
      name: m.display_name,
      provider: m.provider_name,
      provider_type: m.provider_type,
      is_local: LOCAL_PROVIDER_TYPES.has(m.provider_type),
      description: m.description || undefined,
      supportsStreaming: m.supports_streaming,
      supportsFunctions: m.supports_functions,
      supportsVision: m.supports_vision,
    })));

    // Also fetch Parlant agents if the service is healthy
    try {
      const parlantHealthy = await checkParlantHealth();
      if (parlantHealthy) {
        const parlantAgents = await fetchParlantAgents();
        fastify.log.info(`Found ${parlantAgents.length} Parlant agents`);

        for (const agent of parlantAgents) {
          result.push({
            id: `parlant:${agent.id}`,
            name: agent.name || `Parlant Agent`,
            provider: 'Parlant',
            provider_type: 'parlant',
            is_local: true,
            description: agent.description || 'Controlled AI Agent with Guidelines',
            supportsStreaming: true,
            supportsFunctions: false,
            supportsVision: false
          });
        }
      }
    } catch (err: any) {
      fastify.log.warn(`Failed to fetch Parlant agents: ${err?.message || err}`);
    }

    fastify.log.info(`Returning ${result.length} enabled models from database`);
    return result;
  });

  // Get recommended model based on server load
  fastify.get('/models/recommended', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get recommended model based on current server load',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Count active sessions
    const [countRows] = await fastify.db.execute(
      `SELECT COUNT(*) as active_count FROM user_sessions
       WHERE logged_out_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
         AND last_activity_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
    ) as any;
    const activeUsers = countRows[0]?.active_count || 0;

    // Determine load tier
    let tier: 'low' | 'medium' | 'high';
    let tierLabel: string;
    if (activeUsers <= 2) {
      tier = 'low';
      tierLabel = 'Basso';
    } else if (activeUsers <= 5) {
      tier = 'medium';
      tierLabel = 'Medio';
    } else {
      tier = 'high';
      tierLabel = 'Alto';
    }

    // Get all enabled models sorted by admin sort_order
    const enabledModels = await findMany<{ model_id: string; display_name: string; provider_name: string; sort_order: number }>(
      fastify.db,
      `SELECT m.model_id, m.display_name, p.name as provider_name, m.sort_order
       FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE
         AND m.model_type IN ('chat', 'completion')
       ORDER BY m.sort_order ASC, m.display_name ASC`
    );

    if (enabledModels.length === 0) {
      return { recommended: null, load: { activeUsers, tier, tierLabel } };
    }

    let recommended;
    const total = enabledModels.length;
    if (tier === 'high') {
      recommended = enabledModels[0];
    } else if (tier === 'low') {
      recommended = enabledModels[total - 1];
    } else {
      recommended = enabledModels[Math.floor(total / 2)];
    }

    return {
      recommended: {
        id: recommended.model_id,
        name: recommended.display_name,
        provider: recommended.provider_name
      },
      load: {
        activeUsers,
        tier,
        tierLabel
      }
    };
  });

  // Clear models cache
  fastify.post('/models/refresh', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Clear the models cache to force refresh',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    clearModelsCache();
    return { message: 'Models cache cleared' };
  });
}
