/**
 * RoutedModelResolver — DEBT-83-G
 *
 * Extracted from completions.ts as part of the T6 refactor.
 *
 * Handles:
 * 1. Pre-flight model validation (reject unknown/disabled models)
 * 2. Provider resolution (Parlant vs standard AIProviderFactory)
 * 3. Tool support check + tool context preparation
 *
 * Returns provider, providerName, supportsTools, toolContext, preflightAvailableModels.
 * Returns null (abort=true) if validation fails and response was already sent.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { AIProviderFactory } from '../../ai/providers.js';
import { ParlantProviderFactory, checkParlantHealth } from '../../../services/ParlantProvider.js';
import { validateChatModel } from '../model-validation.js';
import { prepareToolContext } from '../context-builder.js';
import { findOne } from '../../../database/index.js';
import type { ToolContext } from '../../../types/index.js';

export interface RoutedModelResolverOptions {
  readonly model: string;
  readonly userId: number;
}

export interface RoutedModelResolverResult {
  /** Set to true when validation failed and reply was already sent. */
  readonly abort: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider type
  readonly provider: any;
  readonly providerName: string;
  readonly isParlantAgent: boolean;
  readonly supportsTools: boolean;
  readonly toolContext: ToolContext | null;
  readonly preflightAvailableModels: string[];
}

/**
 * Resolve the AI provider for the given model and prepare tool context.
 * Returns { abort: true } if validation fails (response already sent).
 */
export async function resolveRoutedModel(
  fastify: FastifyInstance,
  reply: FastifyReply,
  opts: RoutedModelResolverOptions,
): Promise<RoutedModelResolverResult> {
  const { model, userId } = opts;
  const isParlantAgent = model.startsWith('parlant:');

  // ── Pre-flight model validation ─────────────────────────────────────────
  let preflightAvailableModels: string[] = [];
  if (!isParlantAgent) {
    const preflight = await validateChatModel(fastify.db, model);
    preflightAvailableModels = preflight.enabledChatModels;
    if (!preflight.ok) {
      fastify.log.warn(`[Chat] Pre-flight rejected model="${model}" (not registered or disabled)`);
      await reply.status(400).send({
        error: `Il modello \`${model}\` non è registrato o non è abilitato.`,
        supportedModels: preflightAvailableModels,
      });
      return { abort: true, provider: null, providerName: '', isParlantAgent, supportsTools: false, toolContext: null, preflightAvailableModels };
    }
  }

  // ── Provider resolution ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider type varies
  let provider: any;
  let providerName: string;

  if (isParlantAgent) {
    const agentId = model.split(':')[1];
    if (!agentId || agentId.trim() === '') {
      await reply.status(400).send({ error: 'Invalid Parlant model format', message: 'Expected format: parlant:{agentId}' });
      return { abort: true, provider: null, providerName: '', isParlantAgent, supportsTools: false, toolContext: null, preflightAvailableModels };
    }
    const parlantHealthy = await checkParlantHealth();
    if (!parlantHealthy) {
      fastify.log.error(`[Chat] Parlant service is not reachable`);
      await reply.status(503).send({
        error: 'Parlant service unavailable',
        message: 'The Parlant AI Agent service is not running or not reachable. Please contact your administrator.',
        hint: 'Ensure PARLANT_URL is configured and the Parlant service is running.',
      });
      return { abort: true, provider: null, providerName: '', isParlantAgent, supportsTools: false, toolContext: null, preflightAvailableModels };
    }
    provider = ParlantProviderFactory.getProvider(agentId.trim(), 'Parlant Agent', `user_${userId}`);
    providerName = 'parlant';
    fastify.log.info(`[Chat] Using Parlant agent: ${agentId}`);
  } else {
    providerName = AIProviderFactory.getProviderName(model);
    fastify.log.info(`[Chat] Using ${providerName} provider for model: ${model}`);
    provider = AIProviderFactory.getProvider(model);
    fastify.log.debug(`[Chat] Provider instance created: ${provider?.name || 'NULL'}`);
  }

  // ── Tool support check ───────────────────────────────────────────────────
  let supportsTools = false;
  if (!isParlantAgent) {
    try {
      const modelInfo = await findOne<{ supports_functions: number }>(fastify.db, 'SELECT supports_functions FROM ai_models WHERE model_id = ?', [model]);
      supportsTools = modelInfo?.supports_functions === 1;
      fastify.log.info(`[Chat] Model ${model} tool support: ${supportsTools}`);
    } catch (err) {
      fastify.log.warn(`[Chat] Failed to check model capabilities: ${err}`);
    }
  }

  // ── Tool context preparation ─────────────────────────────────────────────
  let toolContext: ToolContext | null = null;
  if (supportsTools) {
    try {
      toolContext = await prepareToolContext(fastify, userId);
    } catch (err) {
      fastify.log.warn(`[Chat] Failed to load or create tool context: ${err}`);
    }
  }

  return { abort: false, provider, providerName, isParlantAgent, supportsTools, toolContext, preflightAvailableModels };
}
