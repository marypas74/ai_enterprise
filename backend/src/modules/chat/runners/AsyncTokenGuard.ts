/**
 * AsyncTokenGuard — DEBT-84-A / DEBT-84-B / T5
 *
 * Extracted from completions.ts.
 * Handles the two-stage token-limit check:
 * 1. MAX_TOKEN_LIMIT: reject with SSE done (finish_reason=length, DEBT-84-B fix)
 * 2. ASYNC_TOKEN_THRESHOLD: dispatch to async queue if too large for sync processing
 *
 * Returns { abort: true } when response was already sent (MAX or dispatched),
 * or { abort: false, model, providerName } to continue normal flow.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Message } from '../../ai/providers.js';
import type { SafetyResult } from '../types.js';
import { estimateMessageTokens, ASYNC_TOKEN_THRESHOLD, MAX_TOKEN_LIMIT } from '../../../utils/tokenEstimator.js';
import {
  createSseWriter, writeSseHeaders, sendInitialSseEvents, writeSseDone,
} from '../streaming.js';
import { maybeDispatchToAsyncQueue } from './AsyncQueueRunner.js';

export interface AsyncTokenGuardOptions {
  readonly userId: number;
  readonly conversationId: number;
  readonly model: string;
  readonly providerName: string;
  readonly originalModel: string;
  readonly messages: Message[];
  readonly safetyResult: SafetyResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly recalledVectorMemories: { episodic: any[]; declarative: any[]; procedural: any[] } | null;
  readonly webSearchPerformed: boolean;
  readonly reply: FastifyReply;
}

export interface AsyncTokenGuardResult {
  readonly abort: boolean;
  readonly model: string;
  readonly providerName: string;
}

/**
 * Check token limits and dispatch to async queue if needed.
 * Returns abort=true when the HTTP response was already sent.
 */
export async function runAsyncTokenGuard(
  fastify: FastifyInstance,
  opts: AsyncTokenGuardOptions,
): Promise<AsyncTokenGuardResult> {
  const { userId, conversationId, model, providerName, originalModel, messages,
    safetyResult, recalledVectorMemories, reply } = opts;

  const estimatedTokens = estimateMessageTokens(messages);

  // C2: Reject documents exceeding the model's context limit
  if (estimatedTokens > MAX_TOKEN_LIMIT) {
    reply.hijack();
    writeSseHeaders(reply, { conversationId, webSearchPerformed: false, model, providerName });
    const sseWrite = createSseWriter(reply);
    sendInitialSseEvents(sseWrite, { model, providerName, safetyResult, recalledVectorMemories });
    sseWrite(`data: ${JSON.stringify({
      content: `Il documento è troppo lungo per essere elaborato (${estimatedTokens.toLocaleString('it-IT')} token stimati, limite ${MAX_TOKEN_LIMIT.toLocaleString('it-IT')}). Per favore, dividi il documento in sezioni più piccole (massimo ~200 pagine o ~50.000 parole ciascuna) e invia ogni sezione separatamente.`,
      done: false,
    })}\n\n`);
    // DEBT-84-B: use writeSseDone for consistent SSE done structure with finish_reason
    writeSseDone(reply, { conversationId, finishReason: 'length', error: 'message too large' });
    fastify.log.warn({ estimatedTokens, limit: MAX_TOKEN_LIMIT, userId }, '[Chat] Document exceeds MAX_TOKEN_LIMIT, rejected');
    return { abort: true, model, providerName };
  }

  if (estimatedTokens > ASYNC_TOKEN_THRESHOLD) {
    const queueResult = await maybeDispatchToAsyncQueue(fastify, reply, {
      userId,
      conversationId,
      model,
      providerName,
      originalModel,
      estimatedTokens,
      messages,
      safetyResult,
      recalledVectorMemories,
    });
    if (queueResult.dispatched) {
      return { abort: true, model: queueResult.model, providerName: queueResult.providerName };
    }
    return { abort: false, model: queueResult.model, providerName: queueResult.providerName };
  }

  return { abort: false, model, providerName };
}
