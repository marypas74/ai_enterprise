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
      description: `Generate a Word (.docx) document and return a download link. YOU MUST use this tool whenever the user asks to create, generate, or convert content into a .docx or Word file. Do NOT write the document content in the chat — always use this tool instead.

WHEN TO USE:
- User says "crea un docx", "genera un documento Word", "create a Word file", "convert to docx"
- User uploads a PDF/image and asks for a docx version
- User asks for a report, letter, essay, or any written document in Word format

WHEN NOT TO USE:
- User asks you to explain, summarize, or analyze text (respond in chat instead)
- User asks for a PDF (use auto-generate, not this tool)
- User just wants information displayed in the chat

IMPORTANT: Put the FULL document content in the "content" parameter. Do NOT truncate or summarize.`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path for the file, e.g. "outputs/report.docx". Must end in .docx.'
          },
          content: {
            type: 'string',
            description: 'The FULL text content for the Word document. Include all text — do not truncate or summarize.'
          },
          title: {
            type: 'string',
            description: 'Document title shown in the header'
          }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'generate_excel_document',
      description: `Generate an Excel (.xlsx) spreadsheet and return a download link. YOU MUST use this tool whenever the user asks to create, generate, or export data as an Excel or .xlsx file. Do NOT dump tabular data in the chat — use this tool instead.

WHEN TO USE:
- User says "crea un Excel", "genera un foglio di calcolo", "create a spreadsheet", "export to xlsx"
- User has data that needs to be in tabular format
- User asks for a CSV/spreadsheet with structured data

WHEN NOT TO USE:
- User wants to see a small data summary in chat
- User asks for a chart or visualization (not supported)`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path for the file, e.g. "data/report.xlsx". Must end in .xlsx.'
          },
          data: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of objects where each object is a row. Keys become column headers. Example: [{"Name":"Alice","Age":30},{"Name":"Bob","Age":25}]'
          },
          sheetName: {
            type: 'string',
            description: 'Worksheet tab name'
          }
        },
        required: ['path', 'data']
      }
    },
    {
      name: 'generate_powerpoint_document',
      description: `Generate a PowerPoint (.pptx) presentation and return a download link. YOU MUST use this tool whenever the user asks to create a presentation or .pptx file. Do NOT write slide content in the chat — use this tool instead.

WHEN TO USE:
- User says "crea una presentazione", "genera un PowerPoint", "create a pptx", "make slides"
- User wants content organized into slides

WHEN NOT TO USE:
- User asks for a document or report (use generate_word_document instead)
- User just wants a text outline in chat`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path for the file, e.g. "presentations/deck.pptx". Must end in .pptx.'
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
            description: 'Array of slide objects. Each has a "title" and "content" string.'
          },
          title: {
            type: 'string',
            description: 'Presentation title for the first slide'
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
