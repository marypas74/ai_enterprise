/**
 * CodeAutoSaveService - Automatically saves code blocks from AI responses
 * Extracts code from markdown code blocks and saves to shared storage
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Extension mapping for programming languages
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  'python': '.py',
  'py': '.py',
  'javascript': '.js',
  'js': '.js',
  'typescript': '.ts',
  'ts': '.ts',
  'java': '.java',
  'csharp': '.cs',
  'c#': '.cs',
  'cpp': '.cpp',
  'c++': '.cpp',
  'c': '.c',
  'go': '.go',
  'rust': '.rs',
  'ruby': '.rb',
  'php': '.php',
  'swift': '.swift',
  'kotlin': '.kt',
  'scala': '.scala',
  'html': '.html',
  'css': '.css',
  'sql': '.sql',
  'bash': '.sh',
  'shell': '.sh',
  'sh': '.sh',
  'powershell': '.ps1',
  'ps1': '.ps1',
  'bat': '.bat',
  'batch': '.bat',
  'yaml': '.yaml',
  'yml': '.yml',
  'json': '.json',
  'xml': '.xml',
  'markdown': '.md',
  'md': '.md',
  'dockerfile': 'Dockerfile',
  'docker': 'Dockerfile',
  'makefile': 'Makefile'
};

// Default save path for auto-generated code
const DEFAULT_SAVE_PATH = '/data/shared-projects/administrator/ai-generated';

export interface CodeBlock {
  language: string;
  code: string;
  filename?: string;
}

export interface SavedFile {
  path: string;
  filename: string;
  language: string;
  size: number;
}

export interface AutoSaveResult {
  savedFiles: SavedFile[];
  codeBlocksFound: number;
  errors: string[];
}

/**
 * Extract code blocks from markdown-formatted AI response
 */
export function extractCodeBlocks(response: string): CodeBlock[] {
  const codeBlocks: CodeBlock[] = [];

  // Match ```language\ncode\n``` blocks
  const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;

  let match;
  while ((match = codeBlockPattern.exec(response)) !== null) {
    const language = (match[1] || 'text').toLowerCase();
    const code = match[2].trim();

    // Skip empty blocks or very short snippets
    if (code.length < 10) continue;

    // Try to extract filename from comments or first line
    const filename = extractFilenameFromCode(code, language);

    codeBlocks.push({
      language,
      code,
      filename
    });
  }

  return codeBlocks;
}

/**
 * Try to extract filename from code comments or patterns
 */
function extractFilenameFromCode(code: string, language: string): string | undefined {
  const lines = code.split('\n');
  const firstLine = lines[0]?.trim() || '';

  // Check for filename in comments
  const filenamePatterns = [
    /^#\s*(?:File:|Filename:)?\s*(\S+\.\w+)/i,
    /^\/\/\s*(?:File:|Filename:)?\s*(\S+\.\w+)/i,
    /^\/\*\s*(?:File:|Filename:)?\s*(\S+\.\w+)/i,
    /^<!--\s*(\S+\.\w+)\s*-->/i,
    /^"""\s*(\S+\.\w+)/i
  ];

  for (const pattern of filenamePatterns) {
    const match = firstLine.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Check for class/function names to generate meaningful filename
  const classMatch = code.match(/^(?:public\s+)?class\s+(\w+)/m);
  if (classMatch) {
    const ext = LANGUAGE_EXTENSIONS[language] || '.txt';
    return `${classMatch[1]}${ext}`;
  }

  // Check for main function patterns
  if (code.includes('def main(') || code.includes('if __name__')) {
    return 'main.py';
  }

  if (code.includes('function main(') || code.includes('const main =')) {
    return 'main.js';
  }

  return undefined;
}

/**
 * Generate a unique filename for a code block
 */
function generateFilename(block: CodeBlock, index: number): string {
  if (block.filename) {
    return block.filename;
  }

  const ext = LANGUAGE_EXTENSIONS[block.language] || '.txt';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Special cases for known extensions
  if (ext === 'Dockerfile' || ext === 'Makefile') {
    return ext;
  }

  return `code_${timestamp}_${index}${ext}`;
}

/**
 * Ensure the save directory exists
 */
async function ensureSaveDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    await fs.chmod(dirPath, 0o775);
  }
}

/**
 * Save code blocks to the filesystem
 */
export async function saveCodeBlocks(
  response: string,
  options: {
    savePath?: string;
    projectName?: string;
    userName?: string;
  } = {}
): Promise<AutoSaveResult> {
  const result: AutoSaveResult = {
    savedFiles: [],
    codeBlocksFound: 0,
    errors: []
  };

  // Extract code blocks from response
  const codeBlocks = extractCodeBlocks(response);
  result.codeBlocksFound = codeBlocks.length;

  if (codeBlocks.length === 0) {
    return result;
  }

  // Determine save path
  let savePath = options.savePath || DEFAULT_SAVE_PATH;

  if (options.projectName) {
    savePath = path.join(savePath, options.projectName);
  }

  // Ensure directory exists
  try {
    await ensureSaveDirectory(savePath);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Failed to create directory: ${errMsg}`);
    return result;
  }

  // Save each code block
  for (let i = 0; i < codeBlocks.length; i++) {
    const block = codeBlocks[i];
    const filename = generateFilename(block, i + 1);
    const filePath = path.join(savePath, filename);

    try {
      await fs.writeFile(filePath, block.code, 'utf-8');
      await fs.chmod(filePath, 0o664);

      const stats = await fs.stat(filePath);

      result.savedFiles.push({
        path: filePath,
        filename,
        language: block.language,
        size: stats.size
      });

      console.log(`[CodeAutoSave] Saved: ${filePath} (${block.language}, ${stats.size} bytes)`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to save ${filename}: ${errMsg}`);
      console.error(`[CodeAutoSave] Error saving ${filename}: ${errMsg}`);
    }
  }

  return result;
}

/**
 * Format saved files info for user notification
 */
export function formatSavedFilesNotification(result: AutoSaveResult): string {
  if (result.savedFiles.length === 0) {
    return '';
  }

  let notification = '\n\n---\n📁 **File salvati automaticamente:**\n';

  for (const file of result.savedFiles) {
    const sizeKb = (file.size / 1024).toFixed(1);
    notification += `- \`${file.filename}\` (${file.language}, ${sizeKb} KB)\n`;
  }

  // Add Windows share path
  const sharePath = result.savedFiles[0].path
    .replace('/data/shared-projects', '\\\\192.168.1.123\\projects')
    .replace(/\//g, '\\');

  const dirPath = path.dirname(sharePath);
  notification += `\n📂 **Percorso:** \`${dirPath}\`\n`;

  if (result.errors.length > 0) {
    notification += `\n⚠️ Errori: ${result.errors.join(', ')}\n`;
  }

  return notification;
}

/**
 * Check if a model has auto-save enabled
 */
export function isAutoSaveModel(modelId: string): boolean {
  const autoSaveModels = [
    'qwen2.5-coder',
    'codellama',
    'deepseek-coder'
  ];

  return autoSaveModels.some(m => modelId.toLowerCase().includes(m));
}

export default {
  extractCodeBlocks,
  saveCodeBlocks,
  formatSavedFilesNotification,
  isAutoSaveModel
};
