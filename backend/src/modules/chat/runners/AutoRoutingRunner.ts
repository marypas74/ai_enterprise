/**
 * AutoRoutingRunner — Model Orchestrator auto-routing logic.
 *
 * DEBT-81-D: Extracted from completions.ts as part of the T4 refactor.
 * Handles the 'auto' model selection path:
 *   1. Estimates token count from message length.
 *   2. Calls ModelRouter.route() to select tier + model.
 *   3. Falls back to first enabled chat model if no tier matches.
 *   4. Warns if a cloud model is selected (LOCALE-FIRST policy).
 *
 * Returns { routingDecision, routedModel } or sends an error reply (503)
 * and returns null to signal the caller to abort.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ModelRouter, RoutingDecision } from '../../../services/ModelRouter.js';
import { findOne } from '../../../database/index.js';

export interface AutoRoutingContext {
  readonly model: string;
  readonly message: string;
  readonly conversationId?: number | null;
  readonly attachmentIds?: number[] | null;
  readonly use_rag?: boolean;
  readonly document_ids?: number[] | null;
  readonly force_web_search?: boolean;
  readonly userId: number;
}

export interface AutoRoutingResult {
  readonly routingDecision: RoutingDecision;
  readonly routedModel: string;
}

/**
 * Runs auto-routing for `model === 'auto'` requests.
 *
 * Returns null and sends a 503 reply if no models are available.
 * Returns AutoRoutingResult on success.
 */
export async function runAutoRouting(
  fastify: FastifyInstance,
  modelRouter: ModelRouter,
  ctx: AutoRoutingContext,
  reply: FastifyReply,
): Promise<AutoRoutingResult | null> {
  // Get conversation message count for routing context
  let convMsgCount = 0;
  if (ctx.conversationId) {
    try {
      const countRow = await findOne<{ cnt: number }>(fastify.db,
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?',
        [ctx.conversationId]);
      convMsgCount = countRow?.cnt || 0;
    } catch { /* non-critical — routing degrades gracefully */ }
  }

  // AI-77: estimate tokens from raw message (before context build) so router
  // can apply the fast-tier rule (<512 tok, no vision/docs).
  const routingEstimatedTokens = Math.ceil((ctx.message?.length || 0) / 4);

  const routingDecision = await modelRouter.route({
    query: ctx.message,
    conversationLength: convMsgCount,
    hasAttachments: (ctx.attachmentIds?.length || 0) > 0,
    attachmentCount: ctx.attachmentIds?.length || 0,
    hasVisionAttachments: false,
    toolsRequested: false,
    userId: ctx.userId,
    hasDocuments: ctx.use_rag || (ctx.document_ids?.length || 0) > 0,
    estimatedTokens: routingEstimatedTokens,
    hasWebSearch: !!ctx.force_web_search,
  });

  if (routingDecision.model) {
    const routedModel = routingDecision.model;
    fastify.log.info(`[Router] Auto-routed to ${routedModel} (tier=${routingDecision.tier}, reason=${routingDecision.reason})`);

    // AI-77: LOCALE-FIRST policy — warn explicitly if cloud provider selected
    const cloudModelPatterns = /^(gpt-|claude-|gemini-|text-davinci|o1-|o3-)/i;
    if (cloudModelPatterns.test(routedModel)) {
      fastify.log.warn(`[Router] AI-77 CLOUD-FALLBACK: selected cloud model "${routedModel}" (tier=${routingDecision.tier}). Local models may be unavailable or circuit-broken.`);
    }

    return { routingDecision, routedModel };
  }

  // No tier match — fallback to first enabled chat model
  const fallbackRow = await findOne<{ model_id: string }>(fastify.db,
    `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
     WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
       AND m.model_id NOT LIKE '%audio%'
     ORDER BY m.sort_order ASC LIMIT 1`);

  if (fallbackRow) {
    fastify.log.warn(`[Router] No tier match, fallback to ${fallbackRow.model_id}`);
    return { routingDecision, routedModel: fallbackRow.model_id };
  }

  // No models available at all
  reply.status(503).send({ error: 'No AI models available. Contact administrator.' });
  return null;
}
