/**
 * AgenticStreamRunner.ts — DEBT-87-J
 *
 * Extracted from agentic.ts (loop + tool calls, formerly lines 250-398).
 * Handles the while-loop: call AI → process tool calls → iterate.
 *
 * agentic.ts retains: keepalive lifecycle, SSE headers, message persistence,
 * watchdog setup, and calls runAgenticLoop to get the final result.
 */

import path from 'path';
import type { FastifyBaseLogger } from 'fastify';
import { writeSseDone } from '../streaming.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type RawReply = {
  raw: {
    write: (data: string) => void;
    end: () => void;
    destroyed: boolean;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool context shape varies per tool
type ToolContext = any;

interface ToolCallDef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider SDK shapes differ
  function?: { name?: string; arguments?: string | any };
  name?: string;
  input?: unknown;
  id?: string;
}

interface ProviderResponse {
  content: string | null;
  toolCalls?: ToolCallDef[];
  tokensInput: number;
  tokensOutput: number;
}

interface Provider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider SDK shapes differ
  complete(opts: any): Promise<ProviderResponse>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- message shape varies
type AMessage = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string };

export interface AgenticStreamRunnerOptions {
  readonly provider: Provider;
  readonly model: string;
  readonly tools: unknown[];
  readonly maxIterations: number;
  readonly reqId: string;
  readonly reply: RawReply;
  readonly log: FastifyBaseLogger;
  readonly sendDebug: (msg: string) => void;
  readonly resetWatchdog: (ctx: string) => void;
  readonly clearWatchdog: () => void;
  readonly clearKeepalive: () => void;
  readonly toolContext: ToolContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- executeTool shape
  readonly executeTool: (name: string, input: any, ctx: ToolContext) => Promise<{ success: boolean; output?: any; error?: string }>;
  readonly timeoutMs: number;
}

export interface AgenticStreamRunnerResult {
  /** Whether the runner wrote SSE done + ended the raw reply (error path) */
  readonly handled: boolean;
  readonly fullResponse: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly iteration: number;
  /** Mutable messages array after loop completion */
  readonly messages: AMessage[];
}

/**
 * Run the agentic AI loop: call provider, process tool calls, iterate until
 * no more tool calls or maxIterations reached.
 *
 * On error: writes SSE done, ends reply.raw, returns handled=true.
 * On success: returns handled=false with accumulated response data.
 */
export async function runAgenticLoop(
  initialMessages: AMessage[],
  opts: AgenticStreamRunnerOptions
): Promise<AgenticStreamRunnerResult> {
  const {
    provider, model, tools, maxIterations, reqId,
    reply, log, sendDebug, resetWatchdog, clearWatchdog,
    clearKeepalive, toolContext, executeTool,
  } = opts;

   
  const messages: AMessage[] = [...initialMessages];
  const generatedDownloads: { downloadUrl: string; downloadFilename: string; displayName: string }[] = [];

  let fullResponse = '';
  let tokensInput = 0;
  let tokensOutput = 0;
  let iteration = 0;
  let requestAborted = false;

  while (iteration < maxIterations && !requestAborted) {
    iteration++;
    resetWatchdog(`iteration_${iteration}_start`);
    sendDebug(`Iteration ${iteration}/${maxIterations} - Calling AI...`);
    log.info(`[${reqId}] STEP 3: Starting iteration ${iteration}, messages count: ${messages.length}`);

    try {
      const apiStartTime = Date.now();

      const response = await provider.complete({
        model,
        messages,
        maxTokens: 4096,
        temperature: 0.7,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider.complete tool types vary per provider SDK
        tools: tools as any,
      });

      resetWatchdog(`iteration_${iteration}_processing`);
      const apiDuration = Date.now() - apiStartTime;
      sendDebug(`AI responded in ${apiDuration}ms`);
      log.info(`[${reqId}] STEP 3b: Provider responded in ${apiDuration}ms`);

      tokensInput += response.tokensInput;
      tokensOutput += response.tokensOutput;

      if (response.content) {
        let content = response.content;
        // Fix AI-hallucinated download links
        if (generatedDownloads.length > 0) {
          content = content.replace(
            /\[([^\]]*)\]\(\/api\/tools\/download\/[^)]+\)/g,
            () => {
              const dl = generatedDownloads[generatedDownloads.length - 1];
              return `[Scarica ${dl.displayName}](${dl.downloadUrl})`;
            }
          );
        }
        fullResponse += content;
        reply.raw.write(`data: ${JSON.stringify({ content, done: false, iteration })}\n\n`);
      }

      // Process tool calls
      const toolCalls = response.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        sendDebug(`Processing ${toolCalls.length} tool calls...`);
        log.info(`[${reqId}] STEP 4: Tool calls detected: ${toolCalls.length}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results shape varies per provider
        const toolResults: any[] = [];

        messages.push({
          role: 'assistant',
          content: response.content || '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool_calls field not in base Message type; required for agentic tool-call turns
          tool_calls: toolCalls as any[],
        });

        for (const toolCall of toolCalls) {
          const name = (toolCall.function?.name || toolCall.name) ?? 'unknown_tool';
          const toolInput = typeof toolCall.function?.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : (toolCall.function?.arguments || toolCall.input);
          const id = toolCall.id;

          sendDebug(`Tool: ${name}`);

          reply.raw.write(`data: ${JSON.stringify({
            toolUse: { name, input: toolInput },
            done: false,
            iteration,
          })}\n\n`);

          let result: { success: boolean; output?: unknown; error?: string };
          try {
            resetWatchdog(`tool_${name}`);
            result = await executeTool(name, toolInput, toolContext);
            resetWatchdog(`tool_${name}_done`);
            sendDebug(`${name} result: ${result.success ? 'Success' : 'Error'}`);
          } catch (toolError: unknown) {
            const msg = toolError instanceof Error ? toolError.message : String(toolError);
            sendDebug(`${name} crashed: ${msg}`);
            result = { success: false, error: msg };
          }

          // Track download URLs from document generation tools
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- output shape unknown
          const out = result.output as any;
          if (result.success && out?.downloadUrl && out?.downloadFilename) {
            generatedDownloads.push({
              downloadUrl: out.downloadUrl,
              downloadFilename: out.downloadFilename,
              displayName: out.path ? path.basename(out.path) : out.downloadFilename,
            });
          }

          reply.raw.write(`data: ${JSON.stringify({
            toolResult: { name, success: result.success, output: result.output, error: result.error },
            done: false,
            iteration,
          })}\n\n`);

          toolResults.push({
            role: 'tool',
            tool_call_id: id,
            name,
            content: result.success ? JSON.stringify(result.output) : `Error: ${result.error}`,
          });
        }

        messages.push(...toolResults);
      } else {
        // No tool calls — loop complete
        break;
      }
    } catch (error: unknown) {
      clearWatchdog();
      requestAborted = true;

      const isAbort = error instanceof Error && (
        error.name === 'AbortError' || error.message?.includes('abort')
      );

      if (isAbort) {
        const timeoutMsg = `TIMEOUT: Request aborted after ${opts.timeoutMs / 1000}s - AI model did not respond`;
        sendDebug(timeoutMsg);
        log.error({
          msg: timeoutMsg,
          reqId,
          iteration,
          source: 'backend',
          type: 'HARD_TIMEOUT',
        });
        writeSseDone(reply as Parameters<typeof writeSseDone>[0], { error: 'REQUEST_TIMEOUT_30S', finishReason: null });
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        sendDebug(`ERROR in iteration ${iteration}: ${msg}`);
        log.error({
          msg: `Agentic error in iteration ${iteration}: ${msg}`,
          reqId,
          source: 'backend',
          error: stack,
        });
        writeSseDone(reply as Parameters<typeof writeSseDone>[0], { error: msg, finishReason: null });
      }

      clearKeepalive();
      reply.raw.end();
      return { handled: true, fullResponse, tokensInput, tokensOutput, iteration, messages };
    }
  }

  return { handled: false, fullResponse, tokensInput, tokensOutput, iteration, messages };
}
