/**
 * DocumentTools - Document generation tool definitions and executors
 * Handles generate_word_document, generate_excel_document, generate_powerpoint_document, get_attachment_text
 */

import { convertTextToDocx, convertDataToXlsx, convertSlidesToPptx, convertOfficeToPdf } from '../DocumentProcessorService.js';
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
      name: 'convert_to_pdf',
      description: `Convert an uploaded file (DOCX, XLSX, PPTX, etc.) to PDF and return a download link. YOU MUST use this tool whenever the user asks to convert a file to PDF or to "create a PDF" from an uploaded document.

WHEN TO USE:
- User uploads a DOCX/XLSX/PPTX and says "creami un pdf", "converti in pdf", "convert to pdf", "genera un pdf"
- User says "trasforma in pdf", "fammi il pdf", "voglio il pdf di questo file"
- User uploads any Office document and asks for a PDF version

WHEN NOT TO USE:
- User asks to generate a NEW PDF from scratch with custom text (use generate_word_document + convert_to_pdf)
- User asks for document analysis or summary (respond in chat instead)

IMPORTANT: This tool converts the ORIGINAL uploaded file to PDF using LibreOffice. It preserves formatting, tables, and images.`,
      input_schema: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'number',
            description: 'The ID of the uploaded attachment to convert to PDF'
          }
        },
        required: ['attachment_id']
      }
    },
    {
      name: 'pdf_manipulate',
      description: 'Manipulate PDF documents: merge multiple PDFs, split/extract pages, compress, rotate pages, reorder pages, or get PDF metadata. Use action parameter to select operation.',
      input_schema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['merge', 'split', 'compress', 'rotate', 'reorder', 'info'],
            description: 'Operation to perform',
          },
          attachment_id: {
            type: 'number',
            description: 'Attachment ID of the PDF (for split/compress/rotate/reorder/info)',
          },
          attachment_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of attachment IDs to merge (for merge action, min 2)',
          },
          pages: {
            type: 'string',
            description: 'Page specification like "1,3-5,7" (1-based). For split, rotate.',
          },
          degrees: {
            type: 'number',
            enum: [90, 180, 270],
            description: 'Rotation degrees (for rotate action)',
          },
          quality: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Compression quality (for compress action). Low=max compression, high=min compression.',
          },
          order: {
            type: 'array',
            items: { type: 'number' },
            description: 'New page order as 1-based page numbers, e.g. [3,1,2] (for reorder action)',
          },
          output_name: {
            type: 'string',
            description: 'Output filename (without extension). Defaults to auto-generated name.',
          },
        },
        required: ['action'],
      },
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
 * Module-level helper — reused by all document tool handlers.
 * context.db is a mysql2 Promise Pool (from ToolContext).
 */
async function loadAttachmentBuffer(
  attachmentId: number,
  userId: number,
  db: any,
): Promise<{ buffer: Buffer; name: string; mime_type: string }> {
  const [rows] = await db.query(
    'SELECT file_path, original_name, mime_type FROM chat_attachments WHERE id = ? AND user_id = ?',
    [attachmentId, userId]
  );
  const att = (rows as any[])?.[0];
  if (!att) throw new Error(`Attachment ${attachmentId} not found or access denied`);
  const fsPromises = await import('fs/promises');
  return { buffer: await fsPromises.readFile(att.file_path), name: att.original_name, mime_type: att.mime_type };
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

    case 'convert_to_pdf': {
      const { attachment_id } = toolInput;
      if (!attachment_id) {
        return { success: false, error: 'Missing required parameter: attachment_id' };
      }

      const attachment = context.db ? await findOne<any>(
        context.db,
        'SELECT file_path, original_name, mime_type FROM chat_attachments WHERE id = ? AND user_id = ?',
        [attachment_id, context.userId]
      ) : null;

      if (!attachment) {
        return { success: false, error: `Attachment not found: ${attachment_id}` };
      }

      const { promises: fsp } = await import('fs');
      const os = await import('os');

      // Path traversal guard: ensure file_path is within expected storage root
      const storageRoot = path.resolve(process.env.STORAGE_ROOT || process.cwd());
      const resolvedPath = path.resolve(attachment.file_path);
      if (!resolvedPath.startsWith(storageRoot + path.sep) && !resolvedPath.startsWith('/app/attachments')) {
        return { success: false, error: 'Invalid attachment path' };
      }

      try { await fsp.access(resolvedPath); } catch {
        return { success: false, error: 'File non trovato' };
      }

      const inputBuffer = await fsp.readFile(resolvedPath);
      const tmpDir = await fsp.mkdtemp(path.join(os.default.tmpdir(), 'pdf-convert-'));

      try {
        const pdfPath = await convertOfficeToPdf(inputBuffer, tmpDir, attachment.original_name);
        const baseName = path.basename(attachment.original_name, path.extname(attachment.original_name));
        const relativePath = `converted/${baseName}.pdf`;

        const download = await copyToDownloadDir(pdfPath, relativePath, '.pdf');

        // Cleanup temp directory
        await fsp.rm(tmpDir, { recursive: true, force: true });

        return {
          success: true,
          output: {
            message: `PDF generato con successo!\n\n[Scarica ${baseName}.pdf](${download.downloadUrl})`,
            path: relativePath,
            downloadUrl: download.downloadUrl,
            downloadFilename: download.downloadFilename
          }
        };
      } catch (convErr: any) {
        await fsp.rm(tmpDir, { recursive: true, force: true });
        return { success: false, error: `PDF conversion failed: ${convErr.message}` };
      }
    }

    case 'pdf_manipulate': {
      const { action, attachment_id, attachment_ids, pages, degrees: degreesVal, quality, order, output_name } = toolInput;
      const { mergePdfs, splitPdf, rotatePdfPages, reorderPdfPages, compressPdf, getPdfInfo } = await import('../DocumentProcessorService.js');

      const userId = context.userId;
      const db = context.db;

      let resultBuffer: Buffer;
      let resultName: string;

      switch (action) {
        case 'merge': {
          if (!attachment_ids || attachment_ids.length < 2) {
            return { success: false, error: 'merge requires at least 2 attachment_ids' };
          }
          const loaded = await Promise.all(attachment_ids.map((id: number) => loadAttachmentBuffer(id, userId, db)));
          resultBuffer = await mergePdfs(loaded.map(l => l.buffer));
          resultName = output_name ? `${output_name}.pdf` : `merged_${Date.now()}.pdf`;
          break;
        }
        case 'split': {
          if (!attachment_id || !pages) return { success: false, error: 'split requires attachment_id and pages' };
          const { buffer, name } = await loadAttachmentBuffer(attachment_id, userId, db);
          resultBuffer = await splitPdf(buffer, pages);
          const baseName = name.replace(/\.pdf$/i, '');
          resultName = output_name ? `${output_name}.pdf` : `${baseName}_pages_${pages.replace(/,/g, '_')}.pdf`;
          break;
        }
        case 'compress': {
          if (!attachment_id) return { success: false, error: 'compress requires attachment_id' };
          const { buffer, name } = await loadAttachmentBuffer(attachment_id, userId, db);
          resultBuffer = await compressPdf(buffer, quality || 'medium');
          const baseName = name.replace(/\.pdf$/i, '');
          resultName = output_name ? `${output_name}.pdf` : `${baseName}_compressed.pdf`;
          break;
        }
        case 'rotate': {
          if (!attachment_id || !pages || !degreesVal) {
            return { success: false, error: 'rotate requires attachment_id, pages, and degrees' };
          }
          const { buffer, name } = await loadAttachmentBuffer(attachment_id, userId, db);
          resultBuffer = await rotatePdfPages(buffer, pages, degreesVal);
          resultName = output_name ? `${output_name}.pdf` : name;
          break;
        }
        case 'reorder': {
          if (!attachment_id || !order) return { success: false, error: 'reorder requires attachment_id and order' };
          const { buffer, name } = await loadAttachmentBuffer(attachment_id, userId, db);
          resultBuffer = await reorderPdfPages(buffer, order);
          resultName = output_name ? `${output_name}.pdf` : name;
          break;
        }
        case 'info': {
          if (!attachment_id) return { success: false, error: 'info requires attachment_id' };
          const { buffer, name } = await loadAttachmentBuffer(attachment_id, userId, db);
          const info = await getPdfInfo(buffer);
          return {
            success: true,
            output: `PDF Info for "${name}":\n` +
              `- Pages: ${info.pageCount}\n` +
              `- File size: ${(info.fileSizeBytes / 1024).toFixed(1)} KB\n` +
              `- Title: ${info.title || 'N/A'}\n` +
              `- Author: ${info.author || 'N/A'}\n` +
              `- Page dimensions:\n` +
              info.pages.map(p => `  Page ${p.pageNumber}: ${p.width}x${p.height} pt (rotation: ${p.rotation}°)`).join('\n'),
          };
        }
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      // Save result and return download link
      const generatedDir = path.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
      const fs = await import('fs/promises');
      await fs.mkdir(generatedDir, { recursive: true });
      const outputPath = path.join(generatedDir, `${Date.now()}_${resultName}`);
      await fs.writeFile(outputPath, resultBuffer);

      const downloadFilename = path.basename(outputPath);
      const downloadUrl = `/api/tools/download/${downloadFilename}`;
      const sizeMb = (resultBuffer.length / (1024 * 1024)).toFixed(2);

      return {
        success: true,
        output: {
          message: `PDF ${action} completed successfully.\n` +
            `Output: ${resultName} (${sizeMb} MB)\n` +
            `Download: ${downloadUrl}`,
          downloadUrl,
          downloadFilename,
          displayName: resultName,
        },
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
