/**
 * StorageService - Handles project folder creation and management
 * Integrates with network shares for code generation
 */

import * as fs from 'fs';
import * as path from 'path';

const STORAGE_ROOT = process.env.STORAGE_ROOT || '/mnt/projects/repositories';

export interface ProjectFolder {
  basePath: string;
  srcPath: string;
  docsPath: string;
  testsPath: string;
}

/**
 * Sanitize string for use in file paths
 */
function sanitizePath(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Get the storage root path
 */
export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

/**
 * Create project folder structure
 * @param userName - The username (sanitized)
 * @param projectName - The project name (sanitized)
 * @returns The created folder paths
 */
export async function createProjectFolder(userName: string, projectName: string): Promise<ProjectFolder> {
  const sanitizedUser = sanitizePath(userName);
  const sanitizedProject = sanitizePath(projectName);

  const basePath = path.join(STORAGE_ROOT, sanitizedUser, sanitizedProject);
  const srcPath = path.join(basePath, 'src');
  const docsPath = path.join(basePath, 'docs');
  const testsPath = path.join(basePath, 'tests');

  // Create directories if they don't exist
  const dirs = [basePath, srcPath, docsPath, testsPath];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Storage] Created directory: ${dir}`);
    }
  }

  // Create a README.md if it doesn't exist
  const readmePath = path.join(basePath, 'README.md');
  if (!fs.existsSync(readmePath)) {
    const readmeContent = `# ${projectName}

Created by ${userName} via Enterprise AI Chat.

## Structure
- \`src/\` - Source code
- \`docs/\` - Documentation
- \`tests/\` - Test files

## Getting Started
This project was scaffolded by the AI assistant.
`;
    fs.writeFileSync(readmePath, readmeContent, 'utf-8');
    console.log(`[Storage] Created README: ${readmePath}`);
  }

  return { basePath, srcPath, docsPath, testsPath };
}

/**
 * Get project folder path (without creating)
 */
export function getProjectFolder(userName: string, projectName: string): string {
  const sanitizedUser = sanitizePath(userName);
  const sanitizedProject = sanitizePath(projectName);
  return path.join(STORAGE_ROOT, sanitizedUser, sanitizedProject);
}

/**
 * Check if project folder exists
 */
export function projectFolderExists(userName: string, projectName: string): boolean {
  const folderPath = getProjectFolder(userName, projectName);
  return fs.existsSync(folderPath);
}

/**
 * Write a file to the project folder
 * @param userName - The username
 * @param projectName - The project name
 * @param relativePath - Path relative to project root (e.g., 'src/main.py')
 * @param content - File content
 */
export async function writeProjectFile(
  userName: string,
  projectName: string,
  relativePath: string,
  content: string
): Promise<string> {
  const projectPath = getProjectFolder(userName, projectName);
  const fullPath = path.join(projectPath, relativePath);
  const dirPath = path.dirname(fullPath);

  // Ensure directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Write file
  fs.writeFileSync(fullPath, content, 'utf-8');
  console.log(`[Storage] Wrote file: ${fullPath}`);

  return fullPath;
}

/**
 * Read a file from the project folder
 */
export async function readProjectFile(
  userName: string,
  projectName: string,
  relativePath: string
): Promise<string | null> {
  const projectPath = getProjectFolder(userName, projectName);
  const fullPath = path.join(projectPath, relativePath);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * List files in project folder
 */
export async function listProjectFiles(
  userName: string,
  projectName: string,
  subPath?: string
): Promise<string[]> {
  const projectPath = getProjectFolder(userName, projectName);
  const searchPath = subPath ? path.join(projectPath, subPath) : projectPath;

  if (!fs.existsSync(searchPath)) {
    return [];
  }

  const files: string[] = [];

  function scanDir(dir: string, prefix: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  scanDir(searchPath);
  return files;
}

export default {
  getStorageRoot,
  createProjectFolder,
  getProjectFolder,
  projectFolderExists,
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
};
