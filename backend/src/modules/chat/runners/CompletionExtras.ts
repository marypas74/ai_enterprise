/**
 * CompletionExtras — DEBT-84-A / T5
 *
 * Extracted from completions.ts.
 * Handles:
 * 1. Conversational form context injection (injectFormContext)
 * 2. Attachment processing (processAttachments + nativeDocBlocks)
 * 3. User message hook pipeline (before/after_message_read)
 * 4. Message persistence (INSERT INTO messages)
 *
 * Returns userMessage, activeFormSession, nativeDocBlocks after all pre-processing.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Message } from '../../ai/providers.js';
import { insertOne } from '../../../database/index.js';
import { injectFormContext, processAttachments } from '../context-builder.js';
import { eventBus } from '../../../services/EventBusService.js';

export interface CompletionExtrasOptions {
  readonly userId: number;
  readonly conversationId: number;
  readonly model: string;
  readonly message: string;
  readonly attachmentIds?: number[];
  readonly hookCtx: Readonly<{ userId: number; conversationId: number }>;
  readonly reply: FastifyReply;
}

export interface CompletionExtrasResult {
  readonly userMessage: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly activeFormSession: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly nativeDocBlocks: any[];
  readonly messages: Message[];
}

/**
 * Run message hooks, form context injection, and attachment processing.
 * Appends the user message to the messages array and persists it.
 */
export async function runCompletionExtras(
  fastify: FastifyInstance,
  opts: CompletionExtrasOptions,
  messagesIn: Message[],
): Promise<CompletionExtrasResult> {
  const { userId, conversationId, model, message, attachmentIds, hookCtx } = opts;

  // Process user message through hooks
  let userMessage = message;
  const msgHook = await eventBus.pipe('before_message_read', userMessage, hookCtx);
  userMessage = msgHook.data || userMessage;
  await eventBus.emit('after_message_read', { message: userMessage, userId, conversationId }, hookCtx);

  // Conversational Form injection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  let activeFormSession: any = null;
  try {
    if (conversationId) {
      activeFormSession = await injectFormContext(fastify, userId, conversationId, userMessage, messagesIn);
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (formErr: any) {
    fastify.log.warn(`[Form] Form check failed: ${formErr.message}`);
  }

  // Handle attachments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  let nativeDocBlocks: any[] = [];
  if (attachmentIds && attachmentIds.length > 0) {
    const attachResult = await processAttachments(fastify, {
      attachmentIds, userId,
      model, originalMessage: message, userMessage,
    });
    nativeDocBlocks = attachResult.nativeDocBlocks;
    userMessage = attachResult.userMessage;
  }

  const messages = [...messagesIn, { role: 'user' as const, content: userMessage }];
  await insertOne(fastify.db,
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
    [conversationId, 'user', userMessage]);

  return { userMessage, activeFormSession, nativeDocBlocks, messages };
}
