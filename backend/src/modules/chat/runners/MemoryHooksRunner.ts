/**
 * MemoryHooksRunner — DEBT-83-G
 *
 * Extracted from completions.ts as part of the T6 refactor.
 *
 * Handles post-stream memory operations (non-blocking, async):
 * 1. Auto-capture episodic memory via MemoryService
 * 2. Store episodic vector memory via VectorMemoryService
 * 3. Emit after_message_send event via EventBus
 *
 * All operations are fire-and-forget — errors are logged but never thrown.
 */

import type { FastifyInstance } from 'fastify';
import { MemoryService } from '../../memory/service.js';
import { storeEpisodic } from '../../../services/VectorMemoryService.js';
import { eventBus } from '../../../services/EventBusService.js';

export interface MemoryHooksOptions {
  readonly userId: number;
  readonly conversationId: number;
  readonly userMessage: string;
  readonly fullResponse: string;
  readonly model: string;
  readonly providerName: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly cost: number;
  readonly hookCtx: Readonly<{ userId: number; conversationId: number }>;
}

/**
 * Run all post-stream memory and event hooks (non-blocking).
 * All operations are fire-and-forget — errors are logged as warnings.
 */
export function runMemoryHooks(
  fastify: FastifyInstance,
  opts: MemoryHooksOptions,
): void {
  const { userId, conversationId, userMessage, fullResponse, model, providerName,
    tokensInput, tokensOutput, cost, hookCtx } = opts;

  // Auto-capture episodic memory (async, non-blocking)
  try {
    const memoryService = new MemoryService(fastify.db);
    memoryService.autoCapture(userId, conversationId, userMessage, fullResponse)
      .catch(err => fastify.log.warn(`[Memory] Auto-capture failed: ${err.message}`));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (memErr: any) {
    fastify.log.warn(`[Memory] Auto-capture init failed: ${memErr.message}`);
  }

  // Episodic vector memory store (async, non-blocking)
  eventBus.pipe('before_memory_store', { userMessage, assistantResponse: fullResponse }, hookCtx)
    .then(memHook => {
      const finalMem = memHook.data || { userMessage, assistantResponse: fullResponse };
      storeEpisodic(fastify.db, userId, conversationId, finalMem.userMessage, finalMem.assistantResponse)
        .catch(err => fastify.log.warn(`[VectorMemory] Episodic store failed: ${err.message}`));
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    .catch((memErr: any) => fastify.log.warn(`[VectorMemory] Store hook failed: ${memErr.message}`));

  // Emit after_message_send event (fire-and-forget)
  eventBus.emit(
    'after_message_send',
    { userMessage, assistantResponse: fullResponse, model, provider: providerName, tokensInput, tokensOutput, cost },
    hookCtx,
  ).catch(() => { /* non-critical */ });
}
