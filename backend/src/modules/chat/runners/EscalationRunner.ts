/**
 * EscalationRunner — Empty-response escalation to a higher-tier model.
 *
 * HIGH-1: Extracted from completions.ts to keep that file under 800 lines.
 *
 * When the primary model returns an empty response, this runner:
 *  1. Queries the routing tiers for the best available alternative model.
 *  2. Streams a response from the escalated model.
 *  3. Returns the new fullResponse and the updated model/provider identifiers.
 *
 * If escalation is not possible (no healthy tier model found), returns an
 * Italian error message as fullResponse.
 */

import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { Message } from '../../ai/providers.js';
import { findOne } from '../../../database/index.js';
import { AIProviderFactory } from '../../ai/providers.js';
import { ModelConfigService } from '../../../services/ModelConfigService.js';
import { recordProviderError, recordProviderSuccess, isProviderHealthy } from '../../../services/CircuitBreakerService.js';
import type { StreamState } from './ChatStreamRunner.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EscalationOptions {
  readonly model: string;
  readonly messages: readonly Message[];
  readonly toolDefs: unknown[] | undefined;
  readonly abortSignal: AbortSignal;
  readonly reply: FastifyReply;
  readonly sseWrite: (event: string) => void;
  readonly log: FastifyBaseLogger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify DB handle is untyped at this level
  readonly db: any;
}

export interface EscalationResult {
  /** Response text produced by the escalated model (or error message if escalation failed). */
  readonly fullResponse: string;
  /** Model ID actually used (may be the original if escalation was skipped). */
  readonly costModel: string;
  /** Provider name of the model actually used. */
  readonly providerName: string;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Attempts to escalate an empty response to a higher-tier model.
 *
 * Records a provider error for the failing model unconditionally.
 * Records a provider success for the escalated model if it produces content.
 */
export async function runEmptyResponseEscalation(
  opts: EscalationOptions,
): Promise<EscalationResult> {
  const { model, messages, toolDefs, abortSignal, reply, sseWrite, log, db } = opts;

  recordProviderError(model);

  const escalatedModel = await findOne<{ model_id: string }>(db,
    `SELECT rt.model_id FROM model_routing_tiers rt
     INNER JOIN ai_models m ON rt.model_id = m.model_id
     INNER JOIN ai_providers p ON m.provider_id = p.id
     WHERE rt.is_enabled = TRUE AND m.is_enabled = TRUE AND p.is_enabled = TRUE
       AND rt.model_id != ?
       AND m.model_id NOT LIKE '%audio%'
     ORDER BY FIELD(rt.tier_name, 'balanced', 'powerful', 'fast'), rt.priority ASC LIMIT 1`,
    [model],
  );

  let fullResponse = '';
  let costModel = model;
  let providerName = AIProviderFactory.getProviderName(model);

  if (escalatedModel && isProviderHealthy(escalatedModel.model_id)) {
    reply.raw.write(
      `data: ${JSON.stringify({ content: `> Il modello ${model} non ha generato contenuto. Sto riprovando con ${escalatedModel.model_id}...\n\n`, done: false })}\n\n`,
    );
    try {
      const escProvider = AIProviderFactory.getProvider(escalatedModel.model_id);
      const escConfig = await ModelConfigService.getConfig(db, escalatedModel.model_id);
      const escStream = escProvider.streamComplete({
        model: escalatedModel.model_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Message[] cast required by provider interface
        messages: messages as any,
        maxTokens: escConfig.maxOutputTokens,
        temperature: escConfig.temperature,
        stream: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- toolDefs type varies by provider
        tools: toolDefs as any,
        signal: abortSignal,
      });

      for await (const chunk of escStream) {
        if (chunk.thinking) sseWrite(`data: ${JSON.stringify({ thinking: chunk.thinking, done: false })}\n\n`);
        if (chunk.thinkingDone) sseWrite(`data: ${JSON.stringify({ thinkingDone: true, done: false })}\n\n`);
        if (chunk.content) {
          fullResponse += chunk.content;
          reply.raw.write(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
        }
      }

      recordProviderSuccess(escalatedModel.model_id);
      costModel = escalatedModel.model_id;
      providerName = AIProviderFactory.getProviderName(escalatedModel.model_id);
      log.info(`[EscalationRunner] Escalation to ${escalatedModel.model_id} produced ${fullResponse.length} chars`);
    } catch (escErr: unknown) {
      recordProviderError(escalatedModel.model_id);
      const msg = escErr instanceof Error ? escErr.message : String(escErr);
      log.error(`[EscalationRunner] Escalation stream failed: ${msg}`);
    }
  }

  if (fullResponse.trim().length === 0) {
    const emptyMsg = 'Il modello non ha generato una risposta. Riprova o seleziona un modello diverso.';
    reply.raw.write(`data: ${JSON.stringify({ content: emptyMsg, done: false })}\n\n`);
    fullResponse = emptyMsg;
  }

  return { fullResponse, costModel, providerName };
}

// Re-export StreamState for callers that need it alongside this module
export type { StreamState };
