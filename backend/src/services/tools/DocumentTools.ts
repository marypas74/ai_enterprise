/**
 * DocumentTools - Document generation tool definitions and executors
 * Handles generate_word_document, generate_excel_document, generate_powerpoint_document, get_attachment_text
 */

import { convertTextToDocx, convertDataToXlsx, convertSlidesToPptx } from '../DocumentProcessorService.js';
import { getProjectFolder } from '../StorageService.js';
import { findOne } from '../../database/index.js';
import path from 'path';
import type { ToolDefinition, ToolContext, ToolResult } from '../ToolService.js';

/**
 * Document generation tool definitions for Anthropic API
 */
export function getDocumentToolDefinitions(): ToolDefinition[] {
  return [
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
  ];
}

/**
 * Helper: Validate path and return project/full paths or an error result
 */
function validateDocumentPath(
  relativePath: string,
  context: ToolContext
): { projectPath: string; fullPath: string } | ToolResult {
  if (relativePath.includes('..')) {
    return { success: false, error: 'Invalid path: directory traversal not allowed' };
  }

  const projectPath = getProjectFolder(context.userName, context.projectName);
  const fullPath = path.join(projectPath, relativePath);
  const normalizedPath = path.normalize(fullPath);
  if (!normalizedPath.startsWith(projectPath)) {
    return { success: false, error: 'Invalid path: outside project directory' };
  }

  return { projectPath, fullPath };
}

/**
 * Helper: Ensure parent directory exists
 */
async function ensureParentDir(fullPath: string): Promise<void> {
  const fs = await import('fs');
  const parentDir = path.dirname(fullPath);
  if (!fs.default.existsSync(parentDir)) {
    fs.default.mkdirSync(parentDir, { recursive: true });
  }
}

/**
 * Helper: Copy generated document to download directory and return download info
 */
async function copyToDownloadDir(
  fullPath: string,
  relativePath: string,
  extension: string
): Promise<{ downloadUrl: string; downloadFilename: string; displayName: string }> {
  const fs = await import('fs');
  const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
  if (!fs.default.existsSync(generatedDir)) {
    fs.default.mkdirSync(generatedDir, { recursive: true });
  }
  const downloadFilename = `${path.basename(relativePath, extension)}_${Date.now()}${extension}`;
  const downloadPath = path.join(generatedDir, downloadFilename);
  fs.default.copyFileSync(fullPath, downloadPath);
  const downloadUrl = `/api/tools/download/${encodeURIComponent(downloadFilename)}`;
  const displayName = path.basename(relativePath);
  return { downloadUrl, downloadFilename, displayName };
}

/**
 * Execute a document generation tool
 */
export async function executeDocumentTool(
  toolName: string,
  toolInput: Record<string, any>,
  context: ToolContext
): Promise<ToolResult | null> {
  switch (toolName) {
    case 'generate_word_document': {
      const { path: relativePath, content, title } = toolInput;
      if (!relativePath || content === undefined) {
        return { success: false, error: 'Missing required parameters: path and content' };
      }

      const pathResult = validateDocumentPath(relativePath, context);
      if ('success' in pathResult) return pathResult;

      await ensureParentDir(pathResult.fullPath);
      await convertTextToDocx(content, pathResult.fullPath, title || relativePath);

      const download = await copyToDownloadDir(pathResult.fullPath, relativePath, '.docx');

      return {
        success: true,
        output: {
          message: `Documento generato con successo!\n\n[Scarica ${download.displayName}](${download.downloadUrl})`,
          path: relativePath,
          fullPath: pathResult.fullPath,
          downloadUrl: download.downloadUrl,
          downloadFilename: download.downloadFilename
        }
      };
    }

    case 'generate_excel_document': {
      const { path: relativePath, data, sheetName } = toolInput;
      if (!relativePath || !data) {
        return { success: false, error: 'Missing required parameters: path and data' };
      }

      const pathResult = validateDocumentPath(relativePath, context);
      if ('success' in pathResult) return pathResult;

      await ensureParentDir(pathResult.fullPath);
      await convertDataToXlsx(data, pathResult.fullPath, sheetName);

      const download = await copyToDownloadDir(pathResult.fullPath, relativePath, '.xlsx');

      return {
        success: true,
        output: {
          message: `Documento generato con successo!\n\n[Scarica ${download.displayName}](${download.downloadUrl})`,
          path: relativePath,
          fullPath: pathResult.fullPath,
          downloadUrl: download.downloadUrl,
          downloadFilename: download.downloadFilename
        }
      };
    }

    case 'generate_powerpoint_document': {
      const { path: relativePath, slides, title } = toolInput;
      if (!relativePath || !slides) {
        return { success: false, error: 'Missing required parameters: path and slides' };
      }

      const pathResult = validateDocumentPath(relativePath, context);
      if ('success' in pathResult) return pathResult;

      await ensureParentDir(pathResult.fullPath);
      await convertSlidesToPptx(slides, pathResult.fullPath, title);

      const download = await copyToDownloadDir(pathResult.fullPath, relativePath, '.pptx');

      return {
        success: true,
        output: {
          message: `Documento generato con successo!\n\n[Scarica ${download.displayName}](${download.downloadUrl})`,
          path: relativePath,
          fullPath: pathResult.fullPath,
          downloadUrl: download.downloadUrl,
          downloadFilename: download.downloadFilename
        }
      };
    }

    case 'get_attachment_text': {
      const { attachment_id } = toolInput;
      if (!attachment_id) {
        return { success: false, error: 'Missing required parameter: attachment_id' };
      }

      const attachment = context.db ? await findOne<any>(
        context.db,
        'SELECT processed_content, original_name FROM chat_attachments WHERE id = ? AND user_id = ?',
        [attachment_id, context.userId]
      ) : null;

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

    default:
      return null;
  }
}
