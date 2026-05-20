/**
 * FallbackChain — Provider error fallback logic.
 *
 * DEBT-81-D: Extracted from completions.ts as part of the T4 refactor.
 *
 * When the primary model throws a retriable error (rate limit, overload, etc.),
 * this runner attempts to fall back to an alternative model from FALLBACK_MAP.
 *
 * Returns updated fullResponse, streamState tokens, and providerName on success.
 * Sends the error SSE and returns null if both primary and fallback fail.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Message } from '../../ai/providers.js';
import type { StreamState } from './ChatStreamRunner.js';
import { AIProviderFactory } from '../../ai/providers.js';
import { ModelConfigService } from '../../../services/ModelConfigService.js';
import { recordProviderError, recordProviderSuccess, isProviderHealthy } from '../../../services/CircuitBreakerService.js';
import { FALLBACK_MAP, isRetriableError } from '../context-builder.js';
import { mapStreamErrorToUserMessage } from '../stream-error.js';

export interface FallbackChainOptions {
  readonly error: unknown;
  readonly model: string;
  readonly providerName: string;
  readonly isParlantAgent: boolean;
  readonly preflightAvailableModels: string[];
  readonly messages: readonly Message[];
  readonly streamState: StreamState;
  readonly abortSignal: AbortSignal;
  readonly reply: FastifyReply;
  readonly request: FastifyRequest;
}

export interface FallbackChainResult {
  /** Final accumulated response (may be from fallback model). */
  readonly fullResponse: string;
  /** Updated provider name (may be from fallback model). */
  readonly providerName: string;
  /** True if fallback was attempted and succeeded. */
  readonly usedFallback: boolean;
  /** True if caller should abort (error already sent to SSE). */
  readonly abort: boolean;
  /** Updated token estimates (if fallback occurred). */
  readonly tokensInput: number;
  readonly tokensOutput: number;
}

/**
 * Attempts a fallback when the primary model throws a retriable error.
 * Returns null (abort=true) if both primary and fallback fail.
 */
export async function runFallbackChain(
  fastify: FastifyInstance,
  opts: FallbackChainOptions,
): Promise<FallbackChainResult> {
  const { error, model, providerName, isParlantAgent, preflightAvailableModels,
    messages, streamState, abortSignal, reply, request } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const errorMessage = (error as any)?.message || 'Unknown stream error';
  fastify.log.error(`[Chat] Stream error: ${errorMessage}`);
  recordProviderError(model);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  if (isRetriableError(errorMessage) && !isParlantAgent && !(request as any)._fallbackAttempted) {
    const fallbackChain = FALLBACK_MAP[model] || [];
    const fallbackModel = fallbackChain.find(m => m !== model && isProviderHealthy(m)) || null;

    if (fallbackModel) {
      fastify.log.warn(`[Chat] Fallback: ${model} -> ${fallbackModel} (reason: ${errorMessage.substring(0, 100)})`);
      reply.raw.write(`data: ${JSON.stringify({ content: `\n\n> ⚠️ Model ${model} unavailable, switching to ${fallbackModel}...\n\n`, done: false })}\n\n`);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        (request as any)._fallbackAttempted = true;
        const fbProvider = AIProviderFactory.getProvider(fallbackModel);
        const fbConfig = await ModelConfigService.getConfig(fastify.db, fallbackModel);
        const fbStream = fbProvider.streamComplete({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          model: fallbackModel, messages: messages as any,
          maxTokens: fbConfig.maxOutputTokens, temperature: fbConfig.temperature,
          stream: true, signal: abortSignal,
        });

        let fullResponse = '';
        for await (const chunk of fbStream) {
          if (chunk.content) {
            fullResponse += chunk.content;
            reply.raw.write(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
          }
        }

        recordProviderSuccess(fallbackModel);
        const tokensInput = Math.ceil(messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0) / 4, 0));
        const tokensOutput = Math.ceil(fullResponse.length / 4);
        const newProviderName = AIProviderFactory.getProviderName(fallbackModel);

        return { fullResponse, providerName: newProviderName, usedFallback: true, abort: false, tokensInput, tokensOutput };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (fbError: any) {
        recordProviderError(fallbackModel);
        fastify.log.error(`[Chat] Fallback also failed: ${fbError.message}`);
        reply.raw.write(`data: ${JSON.stringify({ error: 'Both primary and fallback models failed. Please try again later.', done: true })}\n\n`);
        reply.raw.end();
        return { fullResponse: '', providerName, usedFallback: false, abort: true, tokensInput: streamState.tokensInput, tokensOutput: streamState.tokensOutput };
      }
    }
  }

  // Non-retriable error or no fallback available
  reply.raw.write(`data: ${JSON.stringify({
    error: mapStreamErrorToUserMessage(errorMessage, {
      model,
      provider: providerName,
      availableModels: preflightAvailableModels,
      isParlant: isParlantAgent,
    }),
    done: true,
  })}\n\n`);
  reply.raw.end();
  return { fullResponse: '', providerName, usedFallback: false, abort: true, tokensInput: streamState.tokensInput, tokensOutput: streamState.tokensOutput };
}
