/**
 * AsyncQueueRunner — Large document async queue dispatcher.
 *
 * DEBT-81-D: Extracted from completions.ts as part of the T4 refactor.
 *
 * When estimated token count exceeds ASYNC_TOKEN_THRESHOLD, the request is
 * dispatched to a background DocumentJobQueue worker instead of being processed
 * synchronously. This prevents timeouts on large document analysis tasks.
 *
 * For auto-routed requests, always prefers vLLM to keep data on-premise.
 * Sends an SSE response with job ID and ETA so the frontend can poll for results.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Message } from '../../ai/providers.js';
import { findOne } from '../../../database/index.js';
import { AIProviderFactory } from '../../ai/providers.js';
import { DocumentJobQueue } from '../../../services/DocumentJobQueue.js';
import { writeSseHeaders, createSseWriter, sendInitialSseEvents, writeSseDone } from '../streaming.js';

export interface AsyncQueueOptions {
  readonly userId: number;
  readonly conversationId: number;
  readonly model: string;
  readonly providerName: string;
  readonly originalModel: string; // parsedBody.model (before auto-routing)
  readonly estimatedTokens: number;
  readonly messages: readonly Message[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly safetyResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly recalledVectorMemories: any;
}

export interface AsyncQueueResult {
  /** True when the request was dispatched to async queue (caller should return). */
  readonly dispatched: boolean;
  /** Possibly updated model ID (may be overridden to vLLM for local processing). */
  readonly model: string;
  /** Possibly updated providerName. */
  readonly providerName: string;
}

/**
 * Checks whether the request should be dispatched to the async queue.
 * If dispatched, sends the SSE job response and returns { dispatched: true }.
 * Otherwise returns { dispatched: false } and the (possibly updated) model.
 */
export async function maybeDispatchToAsyncQueue(
  fastify: FastifyInstance,
  reply: FastifyReply,
  opts: AsyncQueueOptions,
): Promise<AsyncQueueResult> {
  let { model, providerName } = opts;
  const { userId, conversationId, originalModel, estimatedTokens, messages, safetyResult, recalledVectorMemories } = opts;

  // For large documents with auto-routing, always prefer local/vLLM to keep data on-premise.
  if (originalModel === 'auto') {
    const vllmRow = await findOne<{ model_id: string }>(fastify.db,
      `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE
         AND m.model_type IN ('chat','completion') AND p.provider_type = 'vllm'
       ORDER BY m.sort_order ASC LIMIT 1`);
    if (vllmRow) {
      model = vllmRow.model_id;
      providerName = AIProviderFactory.getProviderName(model);
      fastify.log.info(`[Chat] Large doc async-queue: overriding auto-route to vLLM ${model}`);
    } else {
      const localRow = await findOne<{ model_id: string }>(fastify.db,
        `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
         WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE
           AND m.model_type IN ('chat','completion') AND p.provider_type IN ('ollama','custom')
         ORDER BY m.sort_order ASC LIMIT 1`);
      if (localRow) {
        model = localRow.model_id;
        providerName = AIProviderFactory.getProviderName(model);
        fastify.log.info(`[Chat] Large doc async-queue: no vLLM, overriding to local ${model}`);
      } else {
        fastify.log.warn(`[Chat] Large doc async-queue: no local model found, keeping ${model} — worker will warn before external API call`);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const redis = (fastify as any).redis;
  const jobQueue = new DocumentJobQueue(redis);

  // Save placeholder assistant message
  const placeholderContent = '⏳ Documento ricevuto — elaborazione in corso...';
  const [placeholderInsert] = await fastify.db.execute(
    'INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?)',
    [conversationId, 'assistant', placeholderContent, false, model, providerName],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const placeholderMessageId = (placeholderInsert as any).insertId;

  const { jobId, eta } = await jobQueue.enqueue({
    userId,
    conversationId,
    placeholderMessageId,
    model,
    providerName,
    messagesJson: JSON.stringify(messages),
    estimatedTokens,
  });

  const etaLabel = eta < 60
    ? `${eta} secondi`
    : `${Math.ceil(eta / 60)} minut${Math.ceil(eta / 60) === 1 ? 'o' : 'i'}`;

  // Return SSE-compatible response (frontend expects SSE format)
  reply.hijack();
  writeSseHeaders(reply, { conversationId, webSearchPerformed: false, model, providerName });
  const sseWrite = createSseWriter(reply);
  sendInitialSseEvents(sseWrite, { model, providerName, safetyResult, recalledVectorMemories });
  // DEBT-83-A: emit job info first, then use writeSseDone for consistent done structure
  sseWrite(`data: ${JSON.stringify({
    job: { id: jobId, eta, estimatedTokens },
    content: '⏳ Documento ricevuto — elaborazione in corso, risposta attesa in circa ' + etaLabel + '.',
    done: false,
    conversationId,
  })}\n\n`);
  writeSseDone({ raw: reply.raw } as import('fastify').FastifyReply, { conversationId, finishReason: null });
  fastify.log.info(`[Chat] Async job ${jobId} queued for user ${userId}, eta=${eta}s, tokens=${estimatedTokens}`);

  return { dispatched: true, model, providerName };
}
