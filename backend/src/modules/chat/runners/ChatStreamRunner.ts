/**
 * ChatStreamRunner — SSE token streaming and chunk emission.
 *
 * Encapsulates the inner streaming loop that reads chunks from an AI provider
 * and forwards them to the SSE connection.  Extracted from completions.ts as
 * part of DEBT-80-D to reduce file size and separate concerns.
 *
 * Responsibilities:
 *   - Iterate over the async generator returned by provider.streamComplete()
 *   - Emit content, thinking, thinkingDone, citations, usage chunks via sseWrite
 *   - Collect accumulated tool-call fragments into complete ToolCall objects
 *   - Return updated token counts and the tool calls found in this round
 *   - Honour the clientDisconnected signal (abort early without throwing)
 */

import type { FastifyBaseLogger } from 'fastify';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StreamChunk {
  readonly content?: string;
  readonly thinking?: string;
  readonly thinkingDone?: boolean;
  readonly citations?: unknown[];
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheCreationTokens?: number;
    readonly cacheReadTokens?: number;
    readonly thinkingTokens?: number;
  };
  readonly toolCalls?: Array<{
    readonly id?: string;
    readonly function?: {
      readonly name?: string;
      readonly arguments?: string;
    };
  }>;
}

export interface AccumulatedToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/** Mutable state updated in-place across streaming rounds. */
export interface StreamState {
  tokensInput: number;
  tokensOutput: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  thinkingTokens: number;
  firstTokenMs: number | null;
}

export interface StreamRoundResult {
  /** Text content accumulated during this round (single tool-round pass). */
  readonly roundContent: string;
  /** Fully assembled tool calls found in this round. */
  readonly toolCalls: readonly AccumulatedToolCall[];
  // ─── DEBT-81-IMMUT: delta fields ─────────────────────────────────────────
  /** Delta content (same as roundContent — provided for symmetry with other delta fields). */
  readonly deltaContent: string;
  /** Input token count delta reported by the provider for this round (0 if not reported). */
  readonly deltaTokensInput: number;
  /** Output token count delta reported by the provider for this round (0 if not reported). */
  readonly deltaTokensOutput: number;
  /** Cache creation token delta (0 if not reported). */
  readonly deltaCacheCreationTokens: number;
  /** Cache read token delta (0 if not reported). */
  readonly deltaCacheReadTokens: number;
  /** Thinking token delta (0 if not reported). */
  readonly deltaThinkingTokens: number;
  /** First-token latency in ms (null if no content token was received). */
  readonly firstTokenMs: number | null;
  /** True if the stream completed normally; false if client disconnected early. */
  readonly isComplete: boolean;
}

export interface ChatStreamRunnerOptions {
  readonly stream: AsyncIterable<StreamChunk>;
  readonly streamStartTime: number;
  readonly clientDisconnected: () => boolean;
  readonly sseWrite: (event: string) => void;
  readonly rawWrite: (event: string) => void;
  readonly log: FastifyBaseLogger;
  readonly userId: number;
  /** Mutable state object — updated by reference so callers see updated token counts. */
  readonly state: StreamState;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Runs a single streaming round for one AI provider call.
 *
 * DEBT-81-IMMUT: Does NOT mutate `options.state`. Instead returns delta fields
 * so the caller can accumulate them immutably (spread/reassign pattern).
 * The `state` parameter is retained in the options signature for backward
 * compatibility but is only READ for `firstTokenMs` initial check — never written.
 *
 * Callers MUST accumulate deltas into their own state:
 * ```ts
 * const result = await runChatStream(opts);
 * myState = applyStreamRoundDelta(myState, result);
 * ```
 */
export async function runChatStream(options: ChatStreamRunnerOptions): Promise<StreamRoundResult> {
  const {
    stream, streamStartTime, clientDisconnected, sseWrite, rawWrite,
    log, userId, state,
  } = options;

  type MutableToolCall = { id: string; name: string; arguments: string };
  let roundContent = '';
  let currentToolCall: MutableToolCall | null = null;
  const accumulatedToolCalls: MutableToolCall[] = [];

  // DEBT-81-IMMUT: collect deltas into local variables — never write to options.state
  let deltaTokensInput = 0;
  let deltaTokensOutput = 0;
  let deltaCacheCreationTokens = 0;
  let deltaCacheReadTokens = 0;
  let deltaThinkingTokens = 0;
  // firstTokenMs: derived from streamStartTime when first content chunk arrives
  // We check state.firstTokenMs to avoid overwriting a value set by a previous round.
  let firstTokenMsLocal: number | null = state.firstTokenMs;
  let isComplete = true;

  for await (const chunk of stream) {
    if (clientDisconnected()) {
      log.info(`[ChatStreamRunner] Client disconnected, aborting stream for user ${userId}`);
      isComplete = false;
      break;
    }

    // Thinking block
    if (chunk.thinking) {
      sseWrite(`data: ${JSON.stringify({ thinking: chunk.thinking, done: false })}\n\n`);
    }
    if (chunk.thinkingDone) {
      sseWrite(`data: ${JSON.stringify({ thinkingDone: true, done: false })}\n\n`);
    }

    // Citations
    if (chunk.citations?.length) {
      sseWrite(`data: ${JSON.stringify({ citations: chunk.citations, done: false })}\n\n`);
    }

    // Usage / token counts — collect into local delta vars (no state mutation)
    if (chunk.usage) {
      if (chunk.usage.inputTokens) deltaTokensInput = chunk.usage.inputTokens;
      if (chunk.usage.outputTokens) deltaTokensOutput = chunk.usage.outputTokens;
      if (chunk.usage.cacheCreationTokens) deltaCacheCreationTokens = chunk.usage.cacheCreationTokens;
      if (chunk.usage.cacheReadTokens) deltaCacheReadTokens = chunk.usage.cacheReadTokens;
      if (chunk.usage.thinkingTokens) deltaThinkingTokens = chunk.usage.thinkingTokens;
    }

    // Tool-call fragment accumulation
    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      for (const tc of chunk.toolCalls) {
        if (tc.function?.name) {
          // New tool call starts — push previous if any
          if (currentToolCall) accumulatedToolCalls.push(currentToolCall);
          currentToolCall = {
            id: tc.id ?? `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: tc.function.name,
            arguments: tc.function.arguments ?? '',
          };
        } else if (tc.function?.arguments && currentToolCall !== null) {
          // Append streaming argument fragment (immutable update via reassign)
          const prev: MutableToolCall = currentToolCall;
          currentToolCall = { id: prev.id, name: prev.name, arguments: prev.arguments + tc.function.arguments };
        }
      }
    }

    // Content chunk — OBS-77: record first-token latency
    if (chunk.content) {
      if (firstTokenMsLocal === null) {
        firstTokenMsLocal = Date.now() - streamStartTime;
      }
      roundContent += chunk.content;
      rawWrite(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
    }
  }

  // Push last in-progress tool call
  if (currentToolCall) accumulatedToolCalls.push(currentToolCall);

  return {
    roundContent,
    toolCalls: accumulatedToolCalls,
    deltaContent: roundContent,
    deltaTokensInput,
    deltaTokensOutput,
    deltaCacheCreationTokens,
    deltaCacheReadTokens,
    deltaThinkingTokens,
    firstTokenMs: firstTokenMsLocal,
    isComplete,
  };
}

/**
 * DEBT-81-IMMUT / CRITICAL-2: Applies a StreamRoundResult delta to a StreamState immutably.
 * Returns a NEW StreamState — never mutates the input.
 *
 * Semantics: ALWAYS SUM delta onto the accumulated state.
 *
 * This is correct for both provider usage patterns:
 *  - Per-round (Anthropic): each round emits a partial delta → summing gives the running total.
 *  - Running-total (OpenAI): intermediate chunks emit delta=0, the final chunk emits the
 *    running total for that round → summing across rounds still gives the correct multi-round total.
 *
 * The previous "replace if delta > 0" logic was wrong for Anthropic multi-round tool loops:
 * it replaced the accumulated total with only the last round's delta.
 */
export function applyStreamRoundDelta(
  state: StreamState,
  delta: Pick<StreamRoundResult, 'deltaTokensInput' | 'deltaTokensOutput' | 'deltaCacheCreationTokens' | 'deltaCacheReadTokens' | 'deltaThinkingTokens' | 'firstTokenMs'>,
): StreamState {
  return {
    tokensInput: state.tokensInput + delta.deltaTokensInput,
    tokensOutput: state.tokensOutput + delta.deltaTokensOutput,
    cacheCreationTokens: state.cacheCreationTokens + delta.deltaCacheCreationTokens,
    cacheReadTokens: state.cacheReadTokens + delta.deltaCacheReadTokens,
    thinkingTokens: state.thinkingTokens + delta.deltaThinkingTokens,
    firstTokenMs: state.firstTokenMs !== null ? state.firstTokenMs : delta.firstTokenMs,
  };
}

/** Create a default mutable StreamState. */
export function createStreamState(): StreamState {
  return {
    tokensInput: 0,
    tokensOutput: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    thinkingTokens: 0,
    firstTokenMs: null,
  };
}
