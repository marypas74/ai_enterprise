/**
 * Conversational Form Service — State machine for structured data collection via chat
 * LLM-driven structured data collection via conversation
 *
 * States: incomplete → complete → wait_confirm → closed
 */

import { findOne, findMany, insertOne, updateOne } from '../database/index.js';
import type mysql from 'mysql2/promise';

export type FormState = 'incomplete' | 'complete' | 'wait_confirm' | 'closed';

export interface FormDefinition {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  json_schema: Record<string, any>;
  start_examples: string[] | null;
  stop_examples: string[] | null;
  ask_confirm: boolean;
  on_complete_action: string;
  on_complete_config: Record<string, any> | null;
  plugin_id: number | null;
  is_enabled: boolean;
}

export interface FormSession {
  id: number;
  user_id: number;
  conversation_id: number;
  form_id: number;
  state: FormState;
  collected_data: Record<string, any>;
  missing_fields: string[] | null;
  last_question: string | null;
}

export interface FormProcessResult {
  state: FormState;
  response: string;
  collected_data: Record<string, any>;
  missing_fields: string[];
  completed: boolean;
}

export class ConversationalFormService {
  constructor(private db: mysql.Pool) {}

  // Get active session for a user+conversation
  async getActiveSession(userId: number, conversationId: number): Promise<FormSession | null> {
    return findOne<FormSession>(
      this.db,
      `SELECT * FROM form_sessions WHERE user_id = ? AND conversation_id = ? AND state != 'closed' ORDER BY id DESC LIMIT 1`,
      [userId, conversationId],
    );
  }

  // Start a new form session
  async startSession(userId: number, conversationId: number, formId: number): Promise<FormSession> {
    const form = await findOne<FormDefinition>(this.db, 'SELECT * FROM conversational_forms WHERE id = ? AND is_enabled = TRUE', [formId]);
    if (!form) throw new Error('Form not found or disabled');

    const schema = typeof form.json_schema === 'string' ? JSON.parse(form.json_schema) : form.json_schema;
    const requiredFields = schema.required || Object.keys(schema.properties || {});

    const id = await insertOne(this.db,
      `INSERT INTO form_sessions (user_id, conversation_id, form_id, state, collected_data, missing_fields) VALUES (?, ?, ?, 'incomplete', '{}', ?)`,
      [userId, conversationId, formId, JSON.stringify(requiredFields)],
    );

    return {
      id,
      user_id: userId,
      conversation_id: conversationId,
      form_id: formId,
      state: 'incomplete',
      collected_data: {},
      missing_fields: requiredFields,
      last_question: null,
    };
  }

  // Process a user message within an active form session
  // Returns extraction prompt context for the LLM to use
  buildExtractionPrompt(form: FormDefinition, session: FormSession, userMessage: string): string {
    const schema = typeof form.json_schema === 'string' ? JSON.parse(form.json_schema) : form.json_schema;
    const properties = schema.properties || {};
    const missing = session.missing_fields || [];
    const collected = typeof session.collected_data === 'string' ? JSON.parse(session.collected_data as any) : session.collected_data;

    let prompt = `You are helping collect structured data for form "${form.display_name}".\n`;
    prompt += `Description: ${form.description || 'N/A'}\n\n`;
    prompt += `Fields in this form:\n`;

    for (const [key, prop] of Object.entries(properties) as [string, any][]) {
      const status = collected[key] !== undefined ? `FILLED: ${JSON.stringify(collected[key])}` : 'MISSING';
      prompt += `- ${key} (${prop.type || 'string'}): ${prop.description || 'no description'} [${status}]\n`;
    }

    prompt += `\nUser message: "${userMessage}"\n\n`;
    prompt += `Extract any field values from the user message. Return a JSON object with ONLY the fields you can extract. `;
    prompt += `If the user seems to want to cancel/stop the form, return {"__cancel": true}.\n`;
    prompt += `Return ONLY valid JSON, nothing else.`;

    return prompt;
  }

  // Update session with extracted data from LLM
  async updateWithExtraction(sessionId: number, extractedData: Record<string, any>): Promise<FormProcessResult> {
    const session = await findOne<FormSession>(this.db, 'SELECT * FROM form_sessions WHERE id = ?', [sessionId]);
    if (!session) throw new Error('Session not found');

    const form = await findOne<FormDefinition>(this.db, 'SELECT * FROM conversational_forms WHERE id = ?', [session.form_id]);
    if (!form) throw new Error('Form not found');

    // Check for cancel intent
    if (extractedData.__cancel) {
      await updateOne(this.db, `UPDATE form_sessions SET state = 'closed' WHERE id = ?`, [sessionId]);
      return {
        state: 'closed',
        response: 'Form cancelled.',
        collected_data: typeof session.collected_data === 'string' ? JSON.parse(session.collected_data as any) : session.collected_data,
        missing_fields: [],
        completed: false,
      };
    }

    // Merge new data
    const collected = typeof session.collected_data === 'string' ? JSON.parse(session.collected_data as any) : { ...session.collected_data };
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const [key, value] of Object.entries(extractedData)) {
      if (value !== null && value !== undefined && key !== '__cancel' && !dangerousKeys.includes(key)) {
        collected[key] = value;
      }
    }

    // Compute missing fields
    const schema = typeof form.json_schema === 'string' ? JSON.parse(form.json_schema) : form.json_schema;
    const required = schema.required || Object.keys(schema.properties || {});
    const missing = required.filter((f: string) => collected[f] === undefined || collected[f] === null || collected[f] === '');

    // Determine state
    let state: FormState = 'incomplete';
    let response = '';

    if (missing.length === 0) {
      if (form.ask_confirm) {
        state = 'wait_confirm';
        response = this.buildConfirmationMessage(form, collected);
      } else {
        state = 'closed';
        response = 'All data collected. Form completed.';
      }
    } else {
      state = 'incomplete';
      response = this.buildNextQuestionMessage(form, schema, missing, collected);
    }

    await updateOne(this.db,
      `UPDATE form_sessions SET state = ?, collected_data = ?, missing_fields = ?, last_question = ? WHERE id = ?`,
      [state, JSON.stringify(collected), JSON.stringify(missing), response, sessionId],
    );

    return { state, response, collected_data: collected, missing_fields: missing, completed: state === 'closed' };
  }

  // Handle confirmation response
  async handleConfirmation(sessionId: number, confirmed: boolean): Promise<FormProcessResult> {
    const session = await findOne<FormSession>(this.db, 'SELECT * FROM form_sessions WHERE id = ?', [sessionId]);
    if (!session || session.state !== 'wait_confirm') throw new Error('No session awaiting confirmation');

    const collected = typeof session.collected_data === 'string' ? JSON.parse(session.collected_data as any) : session.collected_data;

    if (confirmed) {
      await updateOne(this.db, `UPDATE form_sessions SET state = 'closed' WHERE id = ?`, [sessionId]);
      return { state: 'closed', response: 'Form completed successfully!', collected_data: collected, missing_fields: [], completed: true };
    }

    // Reset to incomplete — user wants to change something
    const form = await findOne<FormDefinition>(this.db, 'SELECT * FROM conversational_forms WHERE id = ?', [session.form_id]);
    await updateOne(this.db, `UPDATE form_sessions SET state = 'incomplete' WHERE id = ?`, [sessionId]);
    return {
      state: 'incomplete',
      response: 'OK, which field would you like to change?',
      collected_data: collected,
      missing_fields: [],
      completed: false,
    };
  }

  // Cancel a session
  async cancelSession(sessionId: number): Promise<void> {
    await updateOne(this.db, `UPDATE form_sessions SET state = 'closed' WHERE id = ?`, [sessionId]);
  }

  // List form definitions
  async listForms(enabledOnly = true): Promise<FormDefinition[]> {
    const where = enabledOnly ? 'WHERE is_enabled = TRUE' : '';
    return findMany<FormDefinition>(this.db, `SELECT * FROM conversational_forms ${where} ORDER BY display_name`);
  }

  private buildNextQuestionMessage(form: FormDefinition, schema: any, missing: string[], collected: Record<string, any>): string {
    const nextField = missing[0];
    const prop = schema.properties?.[nextField];
    const fieldDesc = prop?.description || nextField;
    const fieldType = prop?.type || 'text';
    const filledCount = Object.keys(collected).filter(k => collected[k] !== undefined && collected[k] !== null).length;
    const totalFields = Object.keys(schema.properties || {}).length;

    return `[${form.display_name} - ${filledCount}/${totalFields}] Please provide: **${fieldDesc}** (${fieldType})`;
  }

  private buildConfirmationMessage(form: FormDefinition, collected: Record<string, any>): string {
    let msg = `All fields collected for **${form.display_name}**. Please confirm:\n\n`;
    for (const [key, value] of Object.entries(collected)) {
      msg += `- **${key}**: ${JSON.stringify(value)}\n`;
    }
    msg += '\nDo you confirm? (yes/no)';
    return msg;
  }
}
