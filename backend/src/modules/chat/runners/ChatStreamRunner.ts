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
 * Does NOT mutate `options` except via `options.state` (by design — callers own state).
 * Returns immutable round result (content + tool calls).
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

  for await (const chunk of stream) {
    if (clientDisconnected()) {
      log.info(`[ChatStreamRunner] Client disconnected, aborting stream for user ${userId}`);
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

    // Usage / token counts (update mutable state)
    if (chunk.usage) {
      if (chunk.usage.inputTokens) state.tokensInput = chunk.usage.inputTokens;
      if (chunk.usage.outputTokens) state.tokensOutput = chunk.usage.outputTokens;
      if (chunk.usage.cacheCreationTokens) state.cacheCreationTokens = chunk.usage.cacheCreationTokens;
      if (chunk.usage.cacheReadTokens) state.cacheReadTokens = chunk.usage.cacheReadTokens;
      if (chunk.usage.thinkingTokens) state.thinkingTokens = chunk.usage.thinkingTokens;
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
      if (state.firstTokenMs === null) {
        state.firstTokenMs = Date.now() - streamStartTime;
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
