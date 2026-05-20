/**
 * ToolLoopRunner — Tool execution loop and tool result aggregation.
 *
 * Encapsulates the multi-round tool-calling loop extracted from completions.ts
 * as part of DEBT-80-D.  Manages the inner loop that:
 *   1. Calls runChatStream for each provider round.
 *   2. Detects tool calls in the round result.
 *   3. Executes each tool via ToolService.
 *   4. Appends tool results to the message array.
 *   5. Loops up to MAX_TOOL_ROUNDS times.
 *
 * Does NOT own the SSE connection — it receives write callbacks.
 * Does NOT own the message array — callers pass it in; it is returned (immutable updates).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Message } from '../../ai/providers.js';
import type { ToolContext } from '../../../types/index.js';
import { executeTool } from '../../../services/ToolService.js';
import { eventBus } from '../../../services/EventBusService.js';
import { runChatStream, applyStreamRoundDelta, type StreamState, type ChatStreamRunnerOptions } from './ChatStreamRunner.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolLoopRunnerOptions {
  readonly maxRounds?: number;
  readonly toolContext: ToolContext | null;
  readonly hookCtx: Readonly<{ userId: number; conversationId: number }>;
  readonly rawWrite: (event: string) => void;
  readonly sseWrite: (event: string) => void;
  readonly log: FastifyBaseLogger;
  readonly clientDisconnected: () => boolean;
  readonly streamStartTime: number;
  readonly state: StreamState;
  /**
   * Factory that builds the provider stream for one round.
   * Receives the current messages array (potentially mutated by previous tool results).
   */
  readonly buildStream: (messages: readonly Message[]) => AsyncIterable<import('./ChatStreamRunner.js').StreamChunk>;
}

export interface ToolLoopResult {
  /** Final full response text (all rounds concatenated). */
  readonly fullResponse: string;
  /** Final messages array after all tool rounds. */
  readonly messages: readonly Message[];
  /** Number of tool rounds executed. */
  readonly toolRounds: number;
  /**
   * CRITICAL-3: Accumulated StreamState after all rounds.
   * Returned as a new object — ToolLoopRunner never mutates options.state.
   */
  readonly state: StreamState;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 5;

// SECURITY: Only allow document generation tools in text-fallback path (B2)
// Tool allowlist is enforced by completions.ts; ToolLoopRunner trusts toolContext.
// The runtime guard in executeTool() is the second line of defence.

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Executes the multi-round tool loop.
 *
 * Each round:
 *  - Streams a response from the provider (via buildStream factory).
 *  - If tool calls were returned, executes them and appends results to messages.
 *  - Continues until no tool calls are returned or MAX_ROUNDS is reached.
 *
 * Returns immutable ToolLoopResult; messages array inside is a new reference.
 */
export async function runToolLoop(
  initialMessages: readonly Message[],
  options: ToolLoopRunnerOptions,
): Promise<ToolLoopResult> {
  const {
    maxRounds = DEFAULT_MAX_ROUNDS,
    toolContext, hookCtx, rawWrite, sseWrite, log,
    clientDisconnected, streamStartTime, state, buildStream,
  } = options;

  let messages: readonly Message[] = initialMessages;
  let fullResponse = '';
  let toolRound = 0;
  let continueLoop = true;
  // CRITICAL-3: accumulate state immutably — never mutate options.state
  let currentState: StreamState = { ...state };

  while (continueLoop && toolRound < maxRounds && !clientDisconnected()) {
    toolRound++;
    continueLoop = false;

    const streamRunnerOpts: ChatStreamRunnerOptions = {
      stream: buildStream(messages),
      streamStartTime,
      clientDisconnected,
      sseWrite,
      rawWrite,
      log,
      userId: hookCtx.userId,
      state: currentState,
    };

    const roundResult = await runChatStream(streamRunnerOpts);
    const { roundContent, toolCalls } = roundResult;
    // CRITICAL-3: produce new state object — options.state is never touched
    currentState = applyStreamRoundDelta(currentState, roundResult);
    fullResponse += roundContent;

    if (toolCalls.length > 0 && toolContext) {
      log.info(`[ToolLoopRunner] Round ${toolRound}: executing ${toolCalls.length} tool(s)`);

      // Append assistant message with tool_calls to message history (immutable)
      // DEBT-81-TOOLTYPE: use typed ChatCompletionMessageToolCall instead of as any
      const assistantMsg: Message = {
        role: 'assistant',
        content: roundContent,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      messages = [...messages, assistantMsg];

      // Execute each tool and collect results
      const toolResultMsgs: Message[] = [];
      for (const tc of toolCalls) {
        try {
          const args = JSON.parse(tc.arguments);
          log.info(`[ToolLoopRunner] Executing tool: ${tc.name} (round ${toolRound})`);
          await eventBus.emit('before_tool_execute', { tool: tc.name, args, toolContext }, hookCtx);
          const result = await executeTool(tc.name, args, toolContext);
          await eventBus.emit('after_tool_execute', { tool: tc.name, args, result, toolContext }, hookCtx);

          const resultContent = result.success
            ? JSON.stringify(result.output)
            : `Error: ${result.error}`;

          // DEBT-81-TOOLTYPE: use typed Message for tool result (role='tool', tool_call_id, name typed)
          toolResultMsgs.push({
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.name,
            content: resultContent,
          });

          // Emit document download notification if tool generated a file
          if (result.success && result.output?.downloadUrl) {
            const notification = `\n\n📄 **Documento generato**: [Scarica ${result.output.downloadFilename ?? result.output.path}](${result.output.downloadUrl})`;
            rawWrite(`data: ${JSON.stringify({ content: notification, done: false })}\n\n`);
            fullResponse += notification;
          } else {
            rawWrite(`data: ${JSON.stringify({ toolResult: { name: tc.name, success: result.success }, done: false })}\n\n`);
          }
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          log.error(`[ToolLoopRunner] Tool execution error: ${errMsg}`);
          toolResultMsgs.push({
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.name,
            content: `Error: ${errMsg}`,
          });
        }
      }

      // Append all tool results and continue the loop
      messages = [...messages, ...toolResultMsgs];
      continueLoop = true;
    }
  }

  if (toolRound >= maxRounds) {
    log.warn(`[ToolLoopRunner] Tool call loop hit max rounds (${maxRounds})`);
  }

  return { fullResponse, messages, toolRounds: toolRound, state: currentState };
}
