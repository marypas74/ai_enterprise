/**
 * ToolService - Defines and executes AI tools for agentic chat
 * Enables Claude to write/read files during task execution
 */

import {
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
  createProjectFolder,
  getProjectFolder,
} from './StorageService.js';
import { convertTextToDocx, convertDataToXlsx, convertSlidesToPptx } from './DocumentProcessorService.js';
import { findOne } from '../database/index.js';
import path from 'path';

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
export interface ToolContext {
  userName: string;
  projectName: string;
  projectId: number;
  userId: number;
}

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
    {
      name: 'write_file',
      description: 'Write content to a file in the project. Creates the file if it does not exist, or overwrites if it does. Use this to create source code, documentation, configuration files, etc.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative path within the project (e.g., "src/main.py", "docs/README.md")'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'read_file',
      description: 'Read the content of a file from the project. Use this to understand existing code or check file contents.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative path within the project (e.g., "src/main.py")'
          }
        },
        required: ['path']
      }
    },
    {
      name: 'list_files',
      description: 'List all files in the project or a subdirectory. Use this to understand the project structure.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional subdirectory path to list (e.g., "src"). Leave empty to list all files.'
          }
        },
        required: []
      }
    },
    {
      name: 'create_folder',
      description: 'Ensure a folder structure exists in the project. Useful for organizing code into directories.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The folder path to create (e.g., "src/components", "tests/unit")'
          }
        },
        required: ['path']
      }
    },
    {
      name: 'generate_word_document',
      description: 'Generate a Word (.docx) document from the provided text content. The file will be saved in the project directory.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative path where the Word document should be saved (e.g., "outputs/report.docx")'
          },
          content: {
            type: 'string',
            description: 'The text content to be included in the Word document'
          },
          title: {
            type: 'string',
            description: 'Optional title of the document'
          }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'generate_excel_document',
      description: 'Generate an Excel (.xlsx) spreadsheet from a JSON array of objects. Each object represents a row, and its keys represent columns. The file will be saved in the project directory.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative path where the Excel file should be saved (e.g., "data/report.xlsx")'
          },
          data: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of objects representing the rows of the spreadsheet'
          },
          sheetName: {
            type: 'string',
            description: 'Optional name of the worksheet'
          }
        },
        required: ['path', 'data']
      }
    },
    {
      name: 'generate_powerpoint_document',
      description: 'Generate a PowerPoint (.pptx) presentation from an array of slide objects. The file will be saved in the project directory.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative path where the PowerPoint file should be saved (e.g., "presentations/deck.pptx")'
          },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['title', 'content']
            },
            description: 'Array of objects representing the slides ({title: string, content: string})'
          },
          title: {
            type: 'string',
            description: 'Optional overall title of the presentation'
          }
        },
        required: ['path', 'slides']
      }
    },
    {
      name: 'get_attachment_text',
      description: 'Get the full processed text content of an attachment (PDF, Word, etc.). Use this if the initial context was truncated or if you need to read the full content of a file.',
      input_schema: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'number',
            description: 'The ID of the attachment to read'
          }
        },
        required: ['attachment_id']
      }
    },
    {
      name: 'web_search',
      description: 'Search the internet for real-time information (news, weather, latest data). Use this when your internal knowledge is insufficient or you need the most up-to-date information.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., " Firenze weather today", "latest AI news February 2026")'
          }
        },
        required: ['query']
      }
    }
  ];
}

/**
 * Execute a tool with the given input
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  console.log(`[ToolService] Executing tool: ${toolName}`, toolInput);

  try {
    switch (toolName) {
      case 'write_file': {
        const { path, content } = toolInput;
        if (!path || content === undefined) {
          return { success: false, error: 'Missing required parameters: path and content' };
        }
        const fullPath = await writeProjectFile(context.userName, context.projectName, path, content);
        return {
          success: true,
          output: {
            message: `File written successfully`,
            path,
            fullPath,
            size: content.length
          }
        };
      }

      case 'read_file': {
        const { path } = toolInput;
        if (!path) {
          return { success: false, error: 'Missing required parameter: path' };
        }
        const content = await readProjectFile(context.userName, context.projectName, path);
        if (content === null) {
          return { success: false, error: `File not found: ${path}` };
        }
        return {
          success: true,
          output: {
            path,
            content,
            size: content.length
          }
        };
      }

      case 'list_files': {
        const { path } = toolInput;
        const files = await listProjectFiles(context.userName, context.projectName, path);
        return {
          success: true,
          output: {
            path: path || '/',
            files,
            count: files.length,
            basePath: getProjectFolder(context.userName, context.projectName)
          }
        };
      }

      case 'create_folder': {
        const { path } = toolInput;
        if (!path) {
          return { success: false, error: 'Missing required parameter: path' };
        }
        // Create folder by ensuring it exists (createProjectFolder creates standard structure)
        const fs = await import('fs');
        const nodePath = await import('path');
        const folderPath = nodePath.default.join(
          getProjectFolder(context.userName, context.projectName),
          path
        );
        if (!fs.default.existsSync(folderPath)) {
          fs.default.mkdirSync(folderPath, { recursive: true });
        }
        return {
          success: true,
          output: {
            message: `Folder created successfully`,
            path,
            fullPath: folderPath
          }
        };
      }

      case 'generate_word_document': {
        const { path: relativePath, content, title } = toolInput;
        if (!relativePath || content === undefined) {
          return { success: false, error: 'Missing required parameters: path and content' };
        }

        // Path traversal protection
        if (relativePath.includes('..')) {
          return { success: false, error: 'Invalid path: directory traversal not allowed' };
        }

        const projectPath = getProjectFolder(context.userName, context.projectName);
        const fullPath = path.join(projectPath, relativePath);
        const normalizedPath = path.normalize(fullPath);
        if (!normalizedPath.startsWith(projectPath)) {
          return { success: false, error: 'Invalid path: outside project directory' };
        }

        // Ensure parent directory exists
        const fs = await import('fs');
        const parentDir = path.dirname(fullPath);
        if (!fs.default.existsSync(parentDir)) {
          fs.default.mkdirSync(parentDir, { recursive: true });
        }

        await convertTextToDocx(content, fullPath, title || relativePath);

        // Also copy to public/generated for download via /api/tools/download/
        const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
        if (!fs.default.existsSync(generatedDir)) {
          fs.default.mkdirSync(generatedDir, { recursive: true });
        }
        const downloadFilename = `${path.basename(relativePath, '.docx')}_${Date.now()}.docx`;
        const downloadPath = path.join(generatedDir, downloadFilename);
        fs.default.copyFileSync(fullPath, downloadPath);
        const downloadUrl = `/api/tools/download/${downloadFilename}`;

        return {
          success: true,
          output: {
            message: `Word document generated successfully`,
            path: relativePath,
            fullPath,
            downloadUrl,
            downloadFilename
          }
        };
      }

      case 'generate_excel_document': {
        const { path: relativePath, data, sheetName } = toolInput;
        if (!relativePath || !data) {
          return { success: false, error: 'Missing required parameters: path and data' };
        }

        // Path traversal protection
        if (relativePath.includes('..')) {
          return { success: false, error: 'Invalid path: directory traversal not allowed' };
        }

        const projectPath = getProjectFolder(context.userName, context.projectName);
        const fullPath = path.join(projectPath, relativePath);
        const normalizedPath = path.normalize(fullPath);
        if (!normalizedPath.startsWith(projectPath)) {
          return { success: false, error: 'Invalid path: outside project directory' };
        }

        // Ensure parent directory exists
        const fs = await import('fs');
        const parentDir = path.dirname(fullPath);
        if (!fs.default.existsSync(parentDir)) {
          fs.default.mkdirSync(parentDir, { recursive: true });
        }

        await convertDataToXlsx(data, fullPath, sheetName);

        // Copy to public/generated for download
        const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
        if (!fs.default.existsSync(generatedDir)) {
          fs.default.mkdirSync(generatedDir, { recursive: true });
        }
        const downloadFilename = `${path.basename(relativePath, '.xlsx')}_${Date.now()}.xlsx`;
        const downloadPath = path.join(generatedDir, downloadFilename);
        fs.default.copyFileSync(fullPath, downloadPath);
        const downloadUrl = `/api/tools/download/${downloadFilename}`;

        return {
          success: true,
          output: {
            message: `Excel spreadsheet generated successfully`,
            path: relativePath,
            fullPath,
            downloadUrl,
            downloadFilename
          }
        };
      }

      case 'generate_powerpoint_document': {
        const { path: relativePath, slides, title } = toolInput;
        if (!relativePath || !slides) {
          return { success: false, error: 'Missing required parameters: path and slides' };
        }

        // Path traversal protection
        if (relativePath.includes('..')) {
          return { success: false, error: 'Invalid path: directory traversal not allowed' };
        }

        const projectPath = getProjectFolder(context.userName, context.projectName);
        const fullPath = path.join(projectPath, relativePath);
        const normalizedPath = path.normalize(fullPath);
        if (!normalizedPath.startsWith(projectPath)) {
          return { success: false, error: 'Invalid path: outside project directory' };
        }

        // Ensure parent directory exists
        const fs = await import('fs');
        const parentDir = path.dirname(fullPath);
        if (!fs.default.existsSync(parentDir)) {
          fs.default.mkdirSync(parentDir, { recursive: true });
        }

        await convertSlidesToPptx(slides, fullPath, title);

        // Copy to public/generated for download
        const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
        if (!fs.default.existsSync(generatedDir)) {
          fs.default.mkdirSync(generatedDir, { recursive: true });
        }
        const downloadFilename = `${path.basename(relativePath, '.pptx')}_${Date.now()}.pptx`;
        const downloadPath = path.join(generatedDir, downloadFilename);
        fs.default.copyFileSync(fullPath, downloadPath);
        const downloadUrl = `/api/tools/download/${downloadFilename}`;

        return {
          success: true,
          output: {
            message: `PowerPoint presentation generated successfully`,
            path: relativePath,
            fullPath,
            downloadUrl,
            downloadFilename
          }
        };
      }

      case 'get_attachment_text': {
        const { attachment_id } = toolInput;
        if (!attachment_id) {
          return { success: false, error: 'Missing required parameter: attachment_id' };
        }

        const attachment = await findOne<any>(
          (global as any).fastifyDb,
          'SELECT processed_content, original_name FROM chat_attachments WHERE id = ?',
          [attachment_id]
        );

        if (!attachment) {
          return { success: false, error: `Attachment not found: ${attachment_id}` };
        }

        return {
          success: true,
          output: {
            attachment_id,
            original_name: attachment.original_name,
            content: attachment.processed_content || 'No content found or processing not complete',
            size: attachment.processed_content?.length || 0
          }
        };
      }

      case 'web_search': {
        const { query } = toolInput;
        if (!query) {
          return { success: false, error: 'Missing required parameter: query' };
        }

        console.log(`[ToolService] Performing real web search for: ${query}`);

        try {
          const { performWebSearch } = await import('./WebSearchService.js');
          const searchResponse = await performWebSearch(query);

          if (!searchResponse.searchPerformed || searchResponse.results.length === 0) {
            return {
              success: true,
              output: {
                query,
                results: [],
                message: "No relevant search results found."
              }
            };
          }

          return {
            success: true,
            output: {
              query,
              results: searchResponse.results,
              message: `Found ${searchResponse.results.length} search results.`
            }
          };
        } catch (error: any) {
          return { success: false, error: `Web search tool failed: ${error.message}` };
        }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error(`[ToolService] Tool execution error:`, error);
    return { success: false, error: error.message || 'Tool execution failed' };
  }
}

export default {
  getToolDefinitions,
  executeTool,
};
