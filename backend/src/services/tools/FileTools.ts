/**
 * FileTools - File I/O tool definitions and executors
 * Handles read_file, write_file, list_files, create_folder
 */

import {
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
  getProjectFolder,
} from '../StorageService.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../ToolService.js';

/**
 * File I/O tool definitions for Anthropic API
 */
export function getFileToolDefinitions(): ToolDefinition[] {
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
  ];
}

/**
 * Execute a file I/O tool
 */
export async function executeFileTool(
  toolName: string,
  toolInput: Record<string, any>,
  context: ToolContext
): Promise<ToolResult | null> {
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

    default:
      return null;
  }
}
