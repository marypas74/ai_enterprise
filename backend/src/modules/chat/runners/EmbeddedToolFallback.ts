/**
 * EmbeddedToolFallback — B2 fallback: detect and execute tool calls embedded
 * as plain text in the LLM response.
 *
 * HIGH-1: Extracted from completions.ts to keep that file under 800 lines.
 *
 * Some providers (notably Anthropic via Claude SDK) occasionally emit tool
 * calls as JSON or XML strings inside the text response rather than as
 * structured tool_call objects. This runner detects those patterns and
 * executes the tool, returning a download-link notification.
 *
 * SECURITY: Only document-generation tools are allowed in this path.
 */

import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { ToolContext } from '../../../types/index.js';
import { executeTool } from '../../../services/ToolService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Allowlist of tools permitted to execute via the B2 plain-text fallback. */
const B2_ALLOWED_TOOLS = new Set([
  'generate_word_document',
  'generate_excel_document',
  'generate_powerpoint_document',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddedToolFallbackOptions {
  readonly fullResponse: string;
  readonly toolContext: ToolContext;
  readonly reply: FastifyReply;
  readonly log: FastifyBaseLogger;
}

export interface EmbeddedToolFallbackResult {
  /** Updated fullResponse — replaced with download notification if tool ran, original otherwise. */
  readonly fullResponse: string;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Attempts to detect an embedded (plain-text) tool call in the response and
 * execute it. Returns the updated fullResponse (notification link) on success,
 * or the original fullResponse if no tool call is detected or execution fails.
 */
export async function runEmbeddedToolFallback(
  opts: EmbeddedToolFallbackOptions,
): Promise<EmbeddedToolFallbackResult> {
  const { fullResponse, toolContext, reply, log } = opts;

  const toolCallMatch = fullResponse.match(
    /\{"(?:name|tool_name)":\s*"(generate_word_document|generate_excel_document|generate_powerpoint_document)"[\s\S]*?\}/,
  ) || fullResponse.match(
    /<tool_use>\s*<name>(generate_word_document|generate_excel_document|generate_powerpoint_document)<\/name>\s*<input>([\s\S]*?)<\/input>\s*<\/tool_use>/,
  );

  if (!toolCallMatch) {
    return { fullResponse };
  }

  log.warn('[EmbeddedToolFallback] Detected embedded tool call in text response — executing fallback');

  try {
    let toolName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic JSON parse from LLM response
    let toolArgs: Record<string, any>;

    if (toolCallMatch[0].startsWith('<tool_use>')) {
      // XML format (Claude SDK issue #381)
      toolName = toolCallMatch[1];
      toolArgs = JSON.parse(toolCallMatch[2]);
    } else {
      // JSON format
      const parsed = JSON.parse(toolCallMatch[0]);
      toolName = parsed.name || parsed.tool_name;
      toolArgs = parsed.input || parsed.arguments || parsed;
      delete toolArgs.name;
      delete toolArgs.tool_name;
    }

    // SECURITY: Validate tool name against allowlist before execution
    if (!B2_ALLOWED_TOOLS.has(toolName)) {
      log.warn(`[EmbeddedToolFallback] B2 fallback blocked: tool "${toolName}" not in allowlist`);
      throw new Error(`Tool "${toolName}" not allowed in B2 fallback`);
    }

    const result = await executeTool(toolName, toolArgs, toolContext);
    if (result.success && result.output?.downloadUrl) {
      const notification = `\n\n📄 **Documento generato**: [Scarica ${result.output.downloadFilename || result.output.path}](${result.output.downloadUrl})`;
      reply.raw.write(`data: ${JSON.stringify({ content: notification, done: false })}\n\n`);
      log.info(`[EmbeddedToolFallback] Fallback tool execution succeeded for ${toolName}`);
      return { fullResponse: notification };
    }
  } catch (fallbackErr: unknown) {
    const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    log.warn(`[EmbeddedToolFallback] Fallback tool parsing/execution failed: ${msg}`);
  }

  return { fullResponse };
}
