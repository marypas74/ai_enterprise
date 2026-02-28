/**
 * ToolSelectionService — Deferred Tool Loading
 *
 * Instead of sending ALL tool definitions to every LLM call (wasting tokens),
 * this service selects only the relevant tools based on the user's message.
 *
 * Strategy:
 *   - "core" tools (execute_python, vector_memory_search) are ALWAYS included
 *   - Other tools are loaded only when keywords in the message match
 *
 * IMPORTANT: Do NOT add /g or /y flags to keyword regexes — they are shared
 * across requests and would cause lastIndex drift bugs with .test().
 */

import { getToolDefinitions, getMCPToolDefinitions, type ToolDefinition } from './ToolService.js';

// ============================================================
// Keyword → Tool mapping
// ============================================================

interface ToolGroup {
  tools: string[];
  keywords: RegExp;
}

// WARNING: Do NOT add /g or /y flags — these regexes are reused across requests
const TOOL_GROUPS: ToolGroup[] = [
  {
    tools: ['write_file', 'read_file', 'list_files', 'create_folder'],
    keywords: /\b(file|scrivi|leggi|crea|cartella|folder|directory|read|write|list|save|salva|progetto|project|script|code|codice|genera|generate|create|build|output|export|make)\b/i,
  },
  {
    tools: ['generate_word_document'],
    keywords: /\b(word|docx|documento|document|report|relazione)\b/i,
  },
  {
    tools: ['generate_excel_document'],
    keywords: /\b(excel|xlsx|spreadsheet|foglio|tabella|csv)\b/i,
  },
  {
    tools: ['generate_powerpoint_document'],
    keywords: /\b(powerpoint|pptx|presentazione|presentation|slide)\b/i,
  },
  {
    tools: ['get_attachment_text'],
    keywords: /\b(allegat[oi]|attachment|pdf|caricato|uploaded|documento.*caricato|file.*inviato|sent.*file)\b/i,
  },
  {
    tools: ['web_search'],
    keywords: /\b(cerca|search|web|internet|google|news|notizie|meteo|weather|oggi|today|attual[ei]|current|latest|recent[ei]?|what|chi|come|quando|quanto|prezzo|price)\b/i,
  },
  {
    tools: ['browse_url', 'extract_page_data'],
    keywords: /\b(url|http|https|sito|site|pagina|page|link|browse|naviga|apri)\b/i,
  },
  {
    tools: ['take_screenshot', 'analyze_screenshot'],
    keywords: /\b(screenshot|cattura|capture|visual|immagine|image|schermata)\b/i,
  },
];

// Tools that are ALWAYS included (low overhead, high utility)
const CORE_TOOLS: readonly string[] = ['execute_python', 'vector_memory_search'];

// ============================================================
// Public API
// ============================================================

/**
 * Select relevant tools based on the user message.
 * Core tools are always included; others only when keywords match.
 */
export function selectTools(userMessage: string, enableAllTools = false): ToolDefinition[] {
  const allBuiltIn = getToolDefinitions();
  const mcpTools = getMCPToolDefinitions();

  // If explicitly requested, return everything
  if (enableAllTools) {
    return [...allBuiltIn, ...mcpTools];
  }

  // Defensive: ensure message is a string
  const message = typeof userMessage === 'string' ? userMessage : '';

  // Start with core tools (always loaded)
  const selectedNames = new Set<string>(CORE_TOOLS);

  // Match keyword groups
  for (const group of TOOL_GROUPS) {
    if (group.keywords.test(message)) {
      for (const name of group.tools) {
        selectedNames.add(name);
      }
    }
  }

  // Filter built-in tools by selected names
  const selected = allBuiltIn.filter(t => selectedNames.has(t.name));

  // Verify all core tools resolved — fail fast if a name drifted
  for (const coreName of CORE_TOOLS) {
    if (!selected.some(t => t.name === coreName)) {
      console.error(`[ToolSelectionService] CORE_TOOL not found in definitions: ${coreName}`);
    }
  }

  // Always include MCP tools (they're dynamic and user-configured)
  return [...selected, ...mcpTools];
}
