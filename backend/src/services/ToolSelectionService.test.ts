/**
 * Unit tests for ToolSelectionService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ToolService before importing ToolSelectionService
vi.mock('./ToolService.js', () => ({
  getToolDefinitions: vi.fn(() => [
    { name: 'execute_python', type: 'function', function: { name: 'execute_python', description: 'Run Python', parameters: {} } },
    { name: 'vector_memory_search', type: 'function', function: { name: 'vector_memory_search', description: 'Search', parameters: {} } },
    { name: 'write_file', type: 'function', function: { name: 'write_file', description: 'Write file', parameters: {} } },
    { name: 'read_file', type: 'function', function: { name: 'read_file', description: 'Read file', parameters: {} } },
    { name: 'list_files', type: 'function', function: { name: 'list_files', description: 'List files', parameters: {} } },
    { name: 'create_folder', type: 'function', function: { name: 'create_folder', description: 'Create folder', parameters: {} } },
    { name: 'generate_word_document', type: 'function', function: { name: 'generate_word_document', description: 'Generate Word', parameters: {} } },
    { name: 'generate_excel_document', type: 'function', function: { name: 'generate_excel_document', description: 'Generate Excel', parameters: {} } },
    { name: 'generate_powerpoint_document', type: 'function', function: { name: 'generate_powerpoint_document', description: 'Generate PPT', parameters: {} } },
    { name: 'get_attachment_text', type: 'function', function: { name: 'get_attachment_text', description: 'Get attachment', parameters: {} } },
    { name: 'web_search', type: 'function', function: { name: 'web_search', description: 'Search web', parameters: {} } },
    { name: 'browse_url', type: 'function', function: { name: 'browse_url', description: 'Browse URL', parameters: {} } },
    { name: 'extract_page_data', type: 'function', function: { name: 'extract_page_data', description: 'Extract page', parameters: {} } },
    { name: 'take_screenshot', type: 'function', function: { name: 'take_screenshot', description: 'Screenshot', parameters: {} } },
    { name: 'analyze_screenshot', type: 'function', function: { name: 'analyze_screenshot', description: 'Analyze screenshot', parameters: {} } },
  ]),
  getMCPToolDefinitions: vi.fn(() => [
    { name: 'mcp_custom_tool', type: 'function', function: { name: 'mcp_custom_tool', description: 'MCP tool', parameters: {} } },
  ]),
}));

import { selectTools } from './ToolSelectionService.js';

describe('ToolSelectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('selectTools — core tools always included', () => {
    it('should always include execute_python and vector_memory_search', () => {
      const tools = selectTools('hello');
      const names = tools.map(t => t.name);
      expect(names).toContain('execute_python');
      expect(names).toContain('vector_memory_search');
    });

    it('should include MCP tools even with no keyword match', () => {
      const tools = selectTools('hello');
      const names = tools.map(t => t.name);
      expect(names).toContain('mcp_custom_tool');
    });

    it('should return only core + MCP tools for unrelated message', () => {
      // "ciao come stai" matches "come" in web_search keywords, use a truly unrelated phrase
      const tools = selectTools('buongiorno a tutti');
      const names = tools.map(t => t.name);
      // Only core (2) + MCP (1) = 3
      expect(names).toEqual(['execute_python', 'vector_memory_search', 'mcp_custom_tool']);
    });
  });

  describe('selectTools — keyword matching', () => {
    it('should include file tools when "file" keyword present', () => {
      const tools = selectTools('Please write a file for me');
      const names = tools.map(t => t.name);
      expect(names).toContain('write_file');
      expect(names).toContain('read_file');
      expect(names).toContain('list_files');
      expect(names).toContain('create_folder');
    });

    it('should include file tools for Italian "crea cartella"', () => {
      const tools = selectTools('Puoi creare una cartella?');
      const names = tools.map(t => t.name);
      expect(names).toContain('create_folder');
    });

    it('should include word tools when "document" keyword present', () => {
      const tools = selectTools('Generate a Word document');
      const names = tools.map(t => t.name);
      expect(names).toContain('generate_word_document');
    });

    it('should include excel tools when "xlsx" keyword present', () => {
      const tools = selectTools('Create an xlsx spreadsheet');
      const names = tools.map(t => t.name);
      expect(names).toContain('generate_excel_document');
    });

    it('should include powerpoint tools for "presentazione"', () => {
      const tools = selectTools('Fammi una presentazione');
      const names = tools.map(t => t.name);
      expect(names).toContain('generate_powerpoint_document');
    });

    it('should include attachment tools for "allegato"', () => {
      const tools = selectTools('Leggi il contenuto dell\'allegato');
      const names = tools.map(t => t.name);
      expect(names).toContain('get_attachment_text');
    });

    it('should include web_search for "cerca"', () => {
      const tools = selectTools('Cerca informazioni su questo argomento');
      const names = tools.map(t => t.name);
      expect(names).toContain('web_search');
    });

    it('should include web_search for English "search"', () => {
      const tools = selectTools('Search for the latest news');
      const names = tools.map(t => t.name);
      expect(names).toContain('web_search');
    });

    it('should include browse_url for "url" keyword', () => {
      const tools = selectTools('Open this url for me');
      const names = tools.map(t => t.name);
      expect(names).toContain('browse_url');
      expect(names).toContain('extract_page_data');
    });

    it('should include screenshot tools for "screenshot" keyword', () => {
      const tools = selectTools('Take a screenshot of the page');
      const names = tools.map(t => t.name);
      expect(names).toContain('take_screenshot');
      expect(names).toContain('analyze_screenshot');
    });

    it('should match multiple groups in one message', () => {
      const tools = selectTools('Search the web and write a file with results');
      const names = tools.map(t => t.name);
      expect(names).toContain('web_search');
      expect(names).toContain('write_file');
    });

    it('should match "generate" keyword for file tools', () => {
      const tools = selectTools('Generate a Python script');
      const names = tools.map(t => t.name);
      expect(names).toContain('write_file');
    });

    it('should match "csv" keyword for excel tools', () => {
      const tools = selectTools('Importa il csv');
      const names = tools.map(t => t.name);
      expect(names).toContain('generate_excel_document');
    });

    it('should match "prezzo" keyword for web search', () => {
      const tools = selectTools('Qual è il prezzo del bitcoin?');
      const names = tools.map(t => t.name);
      expect(names).toContain('web_search');
    });
  });

  describe('selectTools — enableAllTools', () => {
    it('should return ALL tools when enableAllTools is true', () => {
      const tools = selectTools('hello', true);
      // 15 built-in + 1 MCP = 16
      expect(tools.length).toBe(16);
    });
  });

  describe('selectTools — edge cases', () => {
    it('should handle empty string safely', () => {
      const tools = selectTools('');
      expect(tools.length).toBeGreaterThanOrEqual(3); // core + MCP
    });

    it('should handle null-ish input defensively', () => {
      // TypeScript wouldn't allow this, but runtime safety matters
      const tools = selectTools(null as any);
      const names = tools.map(t => t.name);
      expect(names).toContain('execute_python');
      expect(names).toContain('vector_memory_search');
    });

    it('should handle undefined input defensively', () => {
      const tools = selectTools(undefined as any);
      const names = tools.map(t => t.name);
      expect(names).toContain('execute_python');
    });

    it('should not have regex /g flag issues across multiple calls', () => {
      // Regression: /g flag on shared regex causes lastIndex drift
      const msg = 'Scrivi un file per favore';
      const result1 = selectTools(msg);
      const result2 = selectTools(msg);
      const result3 = selectTools(msg);
      expect(result1.map(t => t.name)).toEqual(result2.map(t => t.name));
      expect(result2.map(t => t.name)).toEqual(result3.map(t => t.name));
    });

    it('should be case insensitive in keyword matching', () => {
      const tools1 = selectTools('FILE');
      const tools2 = selectTools('file');
      const tools3 = selectTools('File');
      const names1 = tools1.map(t => t.name);
      const names2 = tools2.map(t => t.name);
      const names3 = tools3.map(t => t.name);
      expect(names1).toEqual(names2);
      expect(names2).toEqual(names3);
    });
  });
});
