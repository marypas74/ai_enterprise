/**
 * EditPdfShortCircuit — DEBT-84-A / T5
 *
 * Extracted from completions.ts.
 * Handles edit-PDF intent detection: if the user asks to edit a PDF attachment,
 * returns an open_pdf_editor event instead of streaming an LLM response.
 *
 * Returns { handled: true } if the short-circuit fired (response already sent),
 * or { handled: false } to continue normal flow.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SafetyResult } from '../types.js';
import { findOne, insertOne, updateOne } from '../../../database/index.js';
import { sendFastReply } from '../streaming.js';

export interface EditPdfShortCircuitOptions {
  readonly message: string;
  readonly attachmentIds: number[] | undefined;
  readonly userId: number;
  readonly conversationId: number;
  readonly model: string;
  readonly providerName: string;
  readonly safetyResult: SafetyResult;
  readonly reply: FastifyReply;
}

export interface EditPdfShortCircuitResult {
  readonly handled: boolean;
}

/**
 * Check for edit-PDF intent and dispatch open_pdf_editor event if detected.
 * Returns { handled: true } when the response was already sent.
 */
export async function runEditPdfShortCircuit(
  fastify: FastifyInstance,
  opts: EditPdfShortCircuitOptions,
): Promise<EditPdfShortCircuitResult> {
  const { message, attachmentIds, userId, conversationId, model, providerName, safetyResult, reply } = opts;

  if (!attachmentIds || attachmentIds.length === 0) {
    return { handled: false };
  }

  const { detectEditPdfIntent } = await import('../../tools/onlyofficeService.js');
  if (!detectEditPdfIntent(message)) {
    return { handled: false };
  }

  const pdfAttachmentRow = await findOne<{ id: number; original_name: string; mime_type: string }>(
    fastify.db,
    `SELECT id, original_name, mime_type FROM chat_attachments
     WHERE id IN (${attachmentIds.map(() => '?').join(',')}) AND user_id = ? AND mime_type = 'application/pdf'
     LIMIT 1`,
    [...attachmentIds, userId],
  );

  if (!pdfAttachmentRow) {
    return { handled: false };
  }

  fastify.log.info(`[Chat] Edit-PDF intent detected, opening editor for attachment ${pdfAttachmentRow.id}`);
  await insertOne(fastify.db,
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
    [conversationId, 'user', message]);
  const replyText = `Apertura editor PDF per "${pdfAttachmentRow.original_name}". Modifica il documento e clicca "Salva" per persistere come bozza.`;
  await insertOne(fastify.db,
    'INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?)',
    [conversationId, 'assistant', replyText, false, 'pdf-editor-intent', 'system']);
  await updateOne(fastify.db, 'UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);
  sendFastReply(reply, {
    conversationId,
    model,
    providerName,
    safetyResult,
    content: replyText,
    extra: { open_pdf_editor: { attachmentId: pdfAttachmentRow.id, filename: pdfAttachmentRow.original_name } },
  });
  return { handled: true };
}
