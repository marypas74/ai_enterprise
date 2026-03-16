/**
 * ToolService - Main tool registry and dispatcher
 * Delegates to sub-modules: FileTools, DocumentTools, WebTools, SystemTools
 */

import { MCPClientManager } from './MCPClientManager.js';
import { getFileToolDefinitions, executeFileTool } from './tools/FileTools.js';
import { getDocumentToolDefinitions, executeDocumentTool } from './tools/DocumentTools.js';
import { getWebToolDefinitions, executeWebTool } from './tools/WebTools.js';
import { getSystemToolDefinitions, executeSystemTool } from './tools/SystemTools.js';

// Tool definitions for Anthropic API
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

// Context passed to tool execution
import type { ToolContext } from '../types/index.js';
export type { ToolContext };

// Tool execution result
export interface ToolResult {
  success: boolean;
  output?: any;
  error?: string;
}

/**
 * Get all available tool definitions for Anthropic API
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    ...getFileToolDefinitions(),
    ...getDocumentToolDefinitions(),
    ...getWebToolDefinitions(),
    ...getSystemToolDefinitions(),
  ];
}

/**
 * Get MCP tool definitions from connected MCP servers.
 * These are dynamically discovered from running MCP servers.
 */
export function getMCPToolDefinitions(): ToolDefinition[] {
  const mcpManager = MCPClientManager.getInstance();
  const mcpTools = mcpManager.getAllTools();

  return mcpTools.map(tool => ({
    name: `mcp_${tool.serverName}_${tool.name}`,
    description: `[MCP:${tool.serverName}] ${tool.description}`,
    input_schema: {
      type: 'object' as const,
      properties: tool.inputSchema?.properties || {},
      required: tool.inputSchema?.required || [],
    },
  }));
}

/**
 * Get all tool definitions -- built-in + MCP
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return [...getToolDefinitions(), ...getMCPToolDefinitions()];
}

/**
 * Execute a tool with the given input.
 * Delegates to the appropriate sub-module based on tool name.
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  // Sanitize log -- don't dump large code payloads or file contents
  const safeInput = toolName === 'execute_python'
    ? { ...toolInput, code: `[${toolInput.code?.length ?? 0} chars]` }
    : toolName === 'write_file'
    ? { ...toolInput, content: `[${toolInput.content?.length ?? 0} chars]` }
    : toolInput;
  (context.log || console).debug(`[ToolService] Executing tool: ${toolName}`, safeInput);

  try {
    // Try each sub-module in order; first non-null result wins
    const result =
      await executeFileTool(toolName, toolInput, context) ??
      await executeDocumentTool(toolName, toolInput, context) ??
      await executeWebTool(toolName, toolInput, context) ??
      await executeSystemTool(toolName, toolInput, context);

    if (result !== null) {
      return result;
    }

    // Check if it's an MCP tool (prefixed with mcp_)
    if (toolName.startsWith('mcp_')) {
      return executeMCPTool(toolName, toolInput);
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  } catch (error: any) {
    (context.log || console).error(`[ToolService] Tool execution error:`, error);
    return { success: false, error: error.message || 'Tool execution failed' };
  }
}

/**
 * Execute an MCP tool by parsing the prefixed name and routing to the right server
 */
async function executeMCPTool(
  toolName: string,
  toolInput: Record<string, any>,
): Promise<ToolResult> {
  const mcpManager = MCPClientManager.getInstance();
  const allTools = mcpManager.getAllTools();

  // toolName format: mcp_{serverName}_{toolName}
  // Find matching tool by checking all connected tools
  const matchingTool = allTools.find(t => `mcp_${t.serverName}_${t.name}` === toolName);
  if (!matchingTool) {
    return { success: false, error: `MCP tool not found: ${toolName}` };
  }

  // MCP tool execution logged at debug level only
  const result = await mcpManager.callTool(matchingTool.serverId, matchingTool.name, toolInput);

  if (!result.success) {
    return { success: false, error: result.error || 'MCP tool execution failed' };
  }

  return {
    success: true,
    output: {
      server: matchingTool.serverName,
      tool: matchingTool.name,
      result: result.result,
    }
  };
}

export default {
  getToolDefinitions,
  getAllToolDefinitions,
  getMCPToolDefinitions,
  executeTool,
};
