/**
 * Layer2WebRetry.ts — DEBT-87-C+E
 *
 * Extracted from completions.ts (lines 407-440).
 * Handles Layer 2 "no info" detection + automatic web retry after main LLM response.
 *
 * Exported:
 *   runLayer2WebRetry(opts) → Promise<{ updatedResponse: string; webResults: readonly WebResult[] }>
 */

import type { FastifyInstance } from 'fastify';
import { detectNoInfoResponse, buildWebSummary, triggerWebFallback, readSettingCached, type WebResult } from './RagWebFallback.js';

export interface Layer2WebRetryOptions {
  readonly fullResponse: string;
  readonly body: {
    readonly message: string;
    readonly force_web_search?: boolean;
  };
  readonly sseWrite: (event: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly existingWebSources: any[];
  readonly fastify: FastifyInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly db: any;
}

export interface Layer2WebRetryResult {
  readonly updatedResponse: string;
  readonly webResults: readonly WebResult[];
}

/**
 * Layer 2 detection and web retry runner.
 *
 * Checks if the LLM response indicates it has no information, and if so
 * triggers a web search to augment the response. Reads rag_layer2_enabled
 * setting from DB (with 30s cache) to allow runtime on/off without redeploy.
 *
 * Returns the (possibly) updated fullResponse and any web results added.
 */
export async function runLayer2WebRetry(
  opts: Layer2WebRetryOptions
): Promise<Layer2WebRetryResult> {
  const { fullResponse, body, sseWrite, existingWebSources, fastify, db } = opts;

  // Guard: skip if force_web_search already triggered (Layer 1 already did it)
  if (body.force_web_search === true) {
    return { updatedResponse: fullResponse, webResults: [] };
  }

  // Guard: skip if we already have web sources from Layer 1
  if (existingWebSources.length > 0) {
    return { updatedResponse: fullResponse, webResults: [] };
  }

  // Runtime feature flag: rag_layer2_enabled (default true)
  const layer2Enabled = await readSettingCached(db, 'rag_layer2_enabled', 'true');
  if (layer2Enabled !== 'true') {
    fastify.log.info('[Layer2] rag_layer2_enabled=false — skipping Layer 2 web retry');
    return { updatedResponse: fullResponse, webResults: [] };
  }

  // Detect "no info" pattern in LLM response
  if (!detectNoInfoResponse(fullResponse)) {
    return { updatedResponse: fullResponse, webResults: [] };
  }

  fastify.log.info('[Layer2] Detected "no info" pattern, triggering web fallback retry');

  try {
    const retryWeb = await triggerWebFallback(body.message, [], 5);
    if (!retryWeb.webResults || retryWeb.webResults.length === 0) {
      return { updatedResponse: fullResponse, webResults: [] };
    }

    // Stream integration header + summary inline
    const webSummary = buildWebSummary(retryWeb.webResults);
    const integrationBlock = '\n\n🌐 **Integrazione dal web:**\n\n' + webSummary;
    sseWrite(`data: ${JSON.stringify({ content: integrationBlock, done: false })}\n\n`);

    // Immutable update — append to fullResponse, do not mutate
    const updatedResponse = fullResponse + integrationBlock;

    fastify.log.info(`[Layer2] Added ${retryWeb.webResults.length} web results to response`);

    return { updatedResponse, webResults: retryWeb.webResults };
  } catch (l2Err: unknown) {
    fastify.log.warn({ err: l2Err }, '[Layer2] retry failed');
    return { updatedResponse: fullResponse, webResults: [] };
  }
}
