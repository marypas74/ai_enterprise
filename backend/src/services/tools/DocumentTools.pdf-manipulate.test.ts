import { describe, it, expect } from 'vitest';
import { getDocumentToolDefinitions } from './DocumentTools.js';

describe('pdf_manipulate tool definition', () => {
  it('includes pdf_manipulate in tool definitions', () => {
    const tools = getDocumentToolDefinitions();
    const pdfTool = tools.find(t => t.name === 'pdf_manipulate');
    expect(pdfTool).toBeDefined();
    expect(pdfTool!.input_schema.properties.action.enum).toEqual(
      ['merge', 'split', 'compress', 'rotate', 'reorder', 'info']
    );
  });

  it('has required action parameter', () => {
    const tools = getDocumentToolDefinitions();
    const pdfTool = tools.find(t => t.name === 'pdf_manipulate');
    expect(pdfTool!.input_schema.required).toContain('action');
  });
});
