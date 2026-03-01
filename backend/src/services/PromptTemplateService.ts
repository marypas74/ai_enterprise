/**
 * Prompt Template Service — Hookable, editable prompt templates
 *
 * Templates define the system prompt structure for the agent chain:
 *   - prefix: personality/role definition
 *   - suffix: context sections (episodic, declarative, tools output)
 *   - instructions: tool/form selection instructions
 *   - tool_prompt: structured tool selection template
 *
 * Templates are stored in DB and cached in memory.
 * Each template can be overridden via hooks (agent_prompt_prefix, etc.)
 */

import { findOne, findMany, insertOne, updateOne } from '../database/index.js';
import type mysql from 'mysql2/promise';

export interface PromptTemplate {
  id: number;
  name: string;
  display_name: string;
  template_type: 'prefix' | 'suffix' | 'instructions' | 'tool_prompt' | 'custom';
  content: string;
  is_default: boolean;
  is_active: boolean;
  description: string | null;
  variables: string[] | null;
  created_at?: Date;
  updated_at?: Date;
}

/** Variables that can be injected into templates */
export interface TemplateContext {
  userName?: string;
  conversationTitle?: string;
  episodicContext?: string;
  declarativeContext?: string;
  proceduralContext?: string;
  toolOutput?: string;
  formContext?: string;
  customContext?: string;
  availableTools?: string;
  chatHistory?: string;
  currentDate?: string;
  [key: string]: string | undefined;
}

// In-memory cache
let templateCache: PromptTemplate[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export class PromptTemplateService {
  constructor(private db: mysql.Pool) {}

  /** Get all active templates, with caching */
  async getActiveTemplates(): Promise<PromptTemplate[]> {
    if (templateCache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      return templateCache;
    }
    const templates = await findMany<PromptTemplate>(
      this.db,
      'SELECT * FROM prompt_templates WHERE is_active = TRUE ORDER BY template_type, is_default DESC',
    );
    // Parse variables JSON if needed
    for (const t of templates) {
      if (typeof t.variables === 'string') {
        t.variables = JSON.parse(t.variables as any);
      }
    }
    templateCache = templates;
    cacheTimestamp = Date.now();
    return templates;
  }

  /** Get all templates (admin) */
  async getAllTemplates(): Promise<PromptTemplate[]> {
    const templates = await findMany<PromptTemplate>(
      this.db,
      'SELECT * FROM prompt_templates ORDER BY template_type, is_default DESC, display_name',
    );
    for (const t of templates) {
      if (typeof t.variables === 'string') {
        t.variables = JSON.parse(t.variables as any);
      }
    }
    return templates;
  }

  /** Get template by type (returns active default or first active) */
  async getByType(type: PromptTemplate['template_type']): Promise<PromptTemplate | null> {
    const templates = await this.getActiveTemplates();
    return templates.find(t => t.template_type === type && t.is_default)
      || templates.find(t => t.template_type === type)
      || null;
  }

  /** Render a template by replacing {{variable}} placeholders */
  renderTemplate(template: string, context: TemplateContext): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = context[varName];
      return value !== undefined && value !== null ? value : '';
    });
  }

  /** Build complete system prompt using the template chain + hooks */
  async buildSystemPrompt(context: TemplateContext): Promise<{
    prefix: string;
    suffix: string;
    instructions: string;
    full: string;
  }> {
    const prefixTemplate = await this.getByType('prefix');
    const suffixTemplate = await this.getByType('suffix');
    const instructionsTemplate = await this.getByType('instructions');

    // Inject current date
    context.currentDate = context.currentDate || new Date().toLocaleDateString('it-IT', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const prefix = prefixTemplate
      ? this.renderTemplate(prefixTemplate.content, context)
      : '';
    const suffix = suffixTemplate
      ? this.renderTemplate(suffixTemplate.content, context)
      : '';
    const instructions = instructionsTemplate
      ? this.renderTemplate(instructionsTemplate.content, context)
      : '';

    const parts = [prefix, suffix, instructions].filter(Boolean);
    return { prefix, suffix, instructions, full: parts.join('\n\n') };
  }

  /** Build tool selection prompt */
  async buildToolPrompt(availableTools: string, examples?: string): Promise<string> {
    const template = await this.getByType('tool_prompt');
    if (!template) {
      // Fallback hardcoded tool prompt
      return `Crea un JSON con la "action" e "action_input" corretti per aiutare l'utente.

Azioni disponibili:
${availableTools}
- "no_action": Usa questa se nessuna azione rilevante è disponibile. Imposta action_input con la risposta.

${examples ? `Esempi:\n${examples}\n\n` : ''}Restituisci un oggetto JSON: {"action": "action_name", "action_input": "input per l'azione"}
Restituisci SOLO il JSON, nient'altro.`;
    }
    return this.renderTemplate(template.content, {
      availableTools,
      customContext: examples || '',
    });
  }

  /** CRUD Operations */

  async create(data: Omit<PromptTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    this.invalidateCache();
    return insertOne(
      this.db,
      `INSERT INTO prompt_templates (name, display_name, template_type, content, is_default, is_active, description, variables)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name, data.display_name, data.template_type, data.content,
        data.is_default, data.is_active, data.description,
        data.variables ? JSON.stringify(data.variables) : null,
      ],
    );
  }

  async updateTemplate(id: number, data: Partial<PromptTemplate>): Promise<number> {
    this.invalidateCache();
    const sets: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.display_name !== undefined) { sets.push('display_name = ?'); params.push(data.display_name); }
    if (data.content !== undefined) { sets.push('content = ?'); params.push(data.content); }
    if (data.is_default !== undefined) { sets.push('is_default = ?'); params.push(data.is_default); }
    if (data.is_active !== undefined) { sets.push('is_active = ?'); params.push(data.is_active); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.variables !== undefined) { sets.push('variables = ?'); params.push(JSON.stringify(data.variables)); }

    if (sets.length === 0) return 0;
    params.push(id);

    return updateOne(this.db, `UPDATE prompt_templates SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteTemplate(id: number): Promise<number> {
    this.invalidateCache();
    return updateOne(this.db, 'DELETE FROM prompt_templates WHERE id = ? AND is_default = FALSE', [id]);
  }

  /** Invalidate in-memory cache */
  invalidateCache(): void {
    templateCache = null;
    cacheTimestamp = 0;
  }
}

// Default templates (seeded on first run)
export const DEFAULT_TEMPLATES: Omit<PromptTemplate, 'id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'default_prefix',
    display_name: 'Default Prefix (Personality)',
    template_type: 'prefix',
    content: `Sei un assistente AI utile e competente. Oggi è {{currentDate}}.
Rispondi SEMPRE in italiano. Sei preciso, amichevole e proattivo.
Quando non sai qualcosa, dillo onestamente.`,
    is_default: true,
    is_active: true,
    description: 'Default personality and role definition for the AI assistant',
    variables: ['currentDate', 'userName'],
  },
  {
    name: 'default_suffix',
    display_name: 'Default Suffix (Context)',
    template_type: 'suffix',
    content: `{{episodicContext}}
{{declarativeContext}}
{{proceduralContext}}
{{toolOutput}}
{{formContext}}`,
    is_default: true,
    is_active: true,
    description: 'Context sections injected after the prefix: memories, tools output, forms',
    variables: ['episodicContext', 'declarativeContext', 'proceduralContext', 'toolOutput', 'formContext'],
  },
  {
    name: 'default_instructions',
    display_name: 'Default Instructions',
    template_type: 'instructions',
    content: `Usa il contesto sopra per informare le tue risposte. Se vengono forniti ricordi o documenti rilevanti, fai riferimento ad essi in modo naturale.
Se sono disponibili strumenti o procedure, usali quando appropriato.
Se un modulo è attivo, aiuta l'utente a completarlo chiedendo i campi mancanti in modo conversazionale.`,
    is_default: true,
    is_active: true,
    description: 'General instructions for how the AI should use context and tools',
    variables: [],
  },
  {
    name: 'default_tool_prompt',
    display_name: 'Default Tool Selection Prompt',
    template_type: 'tool_prompt',
    content: `Crea un JSON con la "action" e "action_input" corretti per aiutare l'utente.

Azioni disponibili:
{{availableTools}}
- "no_action": Usa questa se nessuna azione rilevante è disponibile. Imposta action_input con il testo della risposta.

{{customContext}}
Restituisci un oggetto JSON: {"action": "action_name", "action_input": "input per l'azione"}
Restituisci SOLO il JSON, nient'altro.`,
    is_default: true,
    is_active: true,
    description: 'Tool/form selection prompt template',
    variables: ['availableTools', 'customContext'],
  },
];
