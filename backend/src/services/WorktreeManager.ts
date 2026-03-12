import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentEventEmitter } from './AgentEventEmitter.js';

const execFileAsync = promisify(execFile);

// Use absolute path for git to ensure it's found regardless of PATH
const GIT_PATH = '/usr/bin/git';

// SECURITY: Validate branch names to prevent argument injection
// Only allow alphanumeric, hyphens, underscores, dots, and slashes
const SAFE_BRANCH_RE = /^[a-zA-Z0-9._\-/]+$/;
function validateBranchName(name: string): string {
  if (!SAFE_BRANCH_RE.test(name)) {
    throw new Error(`Invalid branch name: ${name}`);
  }
  return name;
}

// SECURITY: Validate file paths to prevent git object ref injection
// Rejects paths with .., null bytes, leading /, or non-printable characters
function validateFilePath(filePath: string): string {
  if (!filePath || filePath.includes('\0') || filePath.includes('..') || filePath.startsWith('/') || /[\x00-\x1f\x7f]/.test(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  return filePath;
}

export interface Worktree {
  id: number;
  sessionId: number;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  status: 'creating' | 'active' | 'merging' | 'merged' | 'conflict' | 'deleted';
  lastCommitSha: string | null;
  conflictFiles: string[];
}

export interface ConflictFile {
  path: string;
  content: string;
  oursContent: string;
  theirsContent: string;
}

export interface MergeResult {
  success: boolean;
  conflicts: string[];
  message: string;
}

// Helper: run git command with execFile (no shell, prevents injection)
async function git(args: string[], options?: { timeout?: number; maxBuffer?: number; cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(GIT_PATH, args, {
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer,
    cwd: options?.cwd,
  });
}

// Helper: run git command in a specific repo via -C flag
async function gitC(repoPath: string, args: string[], options?: { timeout?: number; maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
  return git(['-C', repoPath, ...args], options);
}

class WorktreeManagerClass {
  private static instance: WorktreeManagerClass;
  private baseWorktreePath: string;
  private repositoryPath: string;

  private constructor() {
    // Default paths - can be configured via environment
    this.baseWorktreePath = process.env.WORKTREE_BASE_PATH || '/tmp/enterprise-ai-worktrees';
    this.repositoryPath = process.env.REPOSITORY_PATH || '/home/mpasqui/enterprise-ai-chat';
  }

  public static getInstance(): WorktreeManagerClass {
    if (!WorktreeManagerClass.instance) {
      WorktreeManagerClass.instance = new WorktreeManagerClass();
    }
    return WorktreeManagerClass.instance;
  }

  // Set repository path
  public setRepositoryPath(repoPath: string): void {
    this.repositoryPath = repoPath;
  }

  // Set base worktree path
  public setBaseWorktreePath(basePath: string): void {
    this.baseWorktreePath = basePath;
  }

  // Create a new git worktree for an agent session
  public async createWorktree(
    db: any,
    sessionId: number,
    baseBranch: string = 'main'
  ): Promise<Worktree> {
    // SECURITY: Validate baseBranch to prevent argument injection
    validateBranchName(baseBranch);

    const branchName = `agent-session-${sessionId}-${Date.now()}`;
    const worktreePath = path.join(this.baseWorktreePath, branchName);

    try {
      // Ensure base directory exists
      await fs.mkdir(this.baseWorktreePath, { recursive: true });

      // Fetch latest changes from remote
      await gitC(this.repositoryPath, ['fetch', 'origin', baseBranch], { timeout: 60000 });

      // Create the worktree with a new branch based on the base branch
      await gitC(this.repositoryPath, [
        'worktree', 'add', '-b', branchName, worktreePath, `origin/${baseBranch}`
      ], { timeout: 120000 });

      // Get the current commit SHA
      const { stdout: sha } = await gitC(worktreePath, ['rev-parse', 'HEAD']);
      const lastCommitSha = sha.trim();

      // Insert into database
      const [result] = await db.execute(
        `INSERT INTO git_worktrees
         (session_id, repository_path, worktree_path, branch_name, base_branch, status, last_commit_sha)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [sessionId, this.repositoryPath, worktreePath, branchName, baseBranch, lastCommitSha]
      );

      // Update session with worktree info
      await db.execute(
        `UPDATE agent_sessions SET worktree_path = ?, worktree_branch = ? WHERE id = ?`,
        [worktreePath, branchName, sessionId]
      );

      const worktree: Worktree = {
        id: (result as any).insertId,
        sessionId,
        repositoryPath: this.repositoryPath,
        worktreePath,
        branchName,
        baseBranch,
        status: 'active',
        lastCommitSha,
        conflictFiles: []
      };

      AgentEventEmitter.emitSessionEvent({
        type: 'worktree_created',
        sessionId,
        data: worktree,
        timestamp: new Date()
      });

      return worktree;
    } catch (error: any) {
      console.error(`Failed to create worktree for session ${sessionId}:`, error);
      throw new Error(`Failed to create worktree: ${error.message}`);
    }
  }

  // Get worktree status
  public async getWorktreeStatus(db: any, sessionId: number): Promise<Worktree | null> {
    const [rows] = await db.execute(
      `SELECT * FROM git_worktrees WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
      [sessionId]
    );

    if ((rows as any[]).length === 0) {
      return null;
    }

    const row = (rows as any[])[0];
    return {
      id: row.id,
      sessionId: row.session_id,
      repositoryPath: row.repository_path,
      worktreePath: row.worktree_path,
      branchName: row.branch_name,
      baseBranch: row.base_branch,
      status: row.status,
      lastCommitSha: row.last_commit_sha,
      conflictFiles: row.conflict_files ? JSON.parse(row.conflict_files) : []
    };
  }

  // Commit changes in worktree
  public async commitChanges(
    db: any,
    worktreeId: number,
    message: string,
    authorName: string = 'Agent',
    authorEmail: string = 'agent@enterprise-ai.local'
  ): Promise<string> {
    const [rows] = await db.execute(
      `SELECT * FROM git_worktrees WHERE id = ?`,
      [worktreeId]
    );

    if ((rows as any[]).length === 0) {
      throw new Error('Worktree not found');
    }

    const worktree = (rows as any[])[0];

    try {
      // Stage all changes
      await gitC(worktree.worktree_path, ['add', '-A']);

      // Check if there are changes to commit
      const { stdout: status } = await gitC(worktree.worktree_path, ['status', '--porcelain']);

      if (!status.trim()) {
        return worktree.last_commit_sha; // No changes to commit
      }

      // SECURITY: Use execFile with args array — message is passed safely as a single argument
      await gitC(worktree.worktree_path, [
        'commit', '-m', message, `--author=${authorName} <${authorEmail}>`
      ], { timeout: 30000 });

      // Get new commit SHA
      const { stdout: sha } = await gitC(worktree.worktree_path, ['rev-parse', 'HEAD']);
      const newSha = sha.trim();

      // Update database
      await db.execute(
        `UPDATE git_worktrees SET last_commit_sha = ? WHERE id = ?`,
        [newSha, worktreeId]
      );

      return newSha;
    } catch (error: any) {
      console.error(`Failed to commit changes in worktree ${worktreeId}:`, error);
      throw new Error(`Failed to commit: ${error.message}`);
    }
  }

  // Merge worktree back to base branch
  public async mergeWorktree(db: any, worktreeId: number): Promise<MergeResult> {
    const [rows] = await db.execute(
      `SELECT w.*, s.id as session_id FROM git_worktrees w
       JOIN agent_sessions s ON w.session_id = s.id
       WHERE w.id = ?`,
      [worktreeId]
    );

    if ((rows as any[]).length === 0) {
      throw new Error('Worktree not found');
    }

    const worktree = (rows as any[])[0];

    try {
      // Update status to merging
      await db.execute(
        `UPDATE git_worktrees SET status = 'merging' WHERE id = ?`,
        [worktreeId]
      );

      // First, checkout base branch in main repository
      await gitC(worktree.repository_path, ['checkout', worktree.base_branch], { timeout: 30000 });

      // Pull latest changes
      await gitC(worktree.repository_path, ['pull', 'origin', worktree.base_branch], { timeout: 60000 });

      // Try to merge the worktree branch
      try {
        await gitC(worktree.repository_path, [
          'merge', worktree.branch_name, '-m', `Merge agent session ${worktree.session_id}`
        ], { timeout: 60000 });

        // Update status to merged
        await db.execute(
          `UPDATE git_worktrees SET status = 'merged' WHERE id = ?`,
          [worktreeId]
        );

        AgentEventEmitter.emitSessionEvent({
          type: 'worktree_merged',
          sessionId: worktree.session_id,
          data: { worktreeId, success: true },
          timestamp: new Date()
        });

        return {
          success: true,
          conflicts: [],
          message: 'Merge completed successfully'
        };
      } catch (mergeError: any) {
        // Check for merge conflicts
        const { stdout: conflictStatus } = await gitC(worktree.repository_path, [
          'diff', '--name-only', '--diff-filter=U'
        ]);

        const conflictFiles = conflictStatus.trim().split('\n').filter((f: string) => f);

        if (conflictFiles.length > 0) {
          // Update status to conflict
          await db.execute(
            `UPDATE git_worktrees SET status = 'conflict', conflict_files = ? WHERE id = ?`,
            [JSON.stringify(conflictFiles), worktreeId]
          );

          AgentEventEmitter.conflictDetected(worktree.session_id, conflictFiles);

          return {
            success: false,
            conflicts: conflictFiles,
            message: `Merge conflicts detected in ${conflictFiles.length} file(s)`
          };
        }

        throw mergeError;
      }
    } catch (error: any) {
      console.error(`Failed to merge worktree ${worktreeId}:`, error);

      // Abort merge if in progress
      try {
        await gitC(worktree.repository_path, ['merge', '--abort']);
      } catch { /* ignore */ }

      throw new Error(`Failed to merge: ${error.message}`);
    }
  }

  // Get conflict content
  public async getConflictContent(
    db: any,
    worktreeId: number,
    filePath: string
  ): Promise<ConflictFile> {
    const [rows] = await db.execute(
      `SELECT * FROM git_worktrees WHERE id = ?`,
      [worktreeId]
    );

    if ((rows as any[]).length === 0) {
      throw new Error('Worktree not found');
    }

    const worktree = (rows as any[])[0];
    // SECURITY: Validate filePath to prevent git object ref injection
    validateFilePath(filePath);
    const fullPath = path.join(worktree.repository_path, filePath);

    try {
      // Get the conflicted file content
      const content = await fs.readFile(fullPath, 'utf-8');

      // Get "ours" version — SECURITY: filePath validated above and passed as arg
      const { stdout: oursContent } = await gitC(worktree.repository_path, [
        'show', `:2:${filePath}`
      ], { maxBuffer: 10 * 1024 * 1024 }).catch(() => ({ stdout: '', stderr: '' }));

      // Get "theirs" version
      const { stdout: theirsContent } = await gitC(worktree.repository_path, [
        'show', `:3:${filePath}`
      ], { maxBuffer: 10 * 1024 * 1024 }).catch(() => ({ stdout: '', stderr: '' }));

      return {
        path: filePath,
        content,
        oursContent,
        theirsContent
      };
    } catch (error: any) {
      throw new Error(`Failed to get conflict content: ${error.message}`);
    }
  }

  // Resolve a conflict
  public async resolveConflict(
    db: any,
    worktreeId: number,
    filePath: string,
    resolvedContent: string,
    tier: 'automated' | 'ai_assisted' | 'manual',
    rationale?: string,
    modelId?: number,
    approvedBy?: number
  ): Promise<void> {
    const [rows] = await db.execute(
      `SELECT w.*, s.id as session_id FROM git_worktrees w
       JOIN agent_sessions s ON w.session_id = s.id
       WHERE w.id = ?`,
      [worktreeId]
    );

    if ((rows as any[]).length === 0) {
      throw new Error('Worktree not found');
    }

    const worktree = (rows as any[])[0];
    // SECURITY: Validate filePath to prevent path traversal
    validateFilePath(filePath);
    const fullPath = path.join(worktree.repository_path, filePath);

    try {
      // Write resolved content
      await fs.writeFile(fullPath, resolvedContent, 'utf-8');

      // Stage the resolved file — SECURITY: filePath validated and passed as arg
      await gitC(worktree.repository_path, ['add', filePath]);

      // Record resolution in database
      await db.execute(
        `INSERT INTO merge_conflict_resolutions
         (worktree_id, file_path, resolution_tier, resolution_model_id, resolved_content, resolution_rationale, approved_by, status, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved', NOW())`,
        [worktreeId, filePath, tier, modelId || null, resolvedContent, rationale || null, approvedBy || null]
      );

      // Update conflict files list
      const conflictFiles: string[] = worktree.conflict_files ? JSON.parse(worktree.conflict_files) : [];
      const remainingConflicts = conflictFiles.filter((f: string) => f !== filePath);

      await db.execute(
        `UPDATE git_worktrees SET conflict_files = ? WHERE id = ?`,
        [JSON.stringify(remainingConflicts), worktreeId]
      );

      // If all conflicts resolved, update status
      if (remainingConflicts.length === 0) {
        await db.execute(
          `UPDATE git_worktrees SET status = 'active' WHERE id = ?`,
          [worktreeId]
        );
      }

      AgentEventEmitter.conflictResolved(worktree.session_id, filePath, tier);
    } catch (error: any) {
      throw new Error(`Failed to resolve conflict: ${error.message}`);
    }
  }

  // Delete worktree
  public async deleteWorktree(db: any, worktreeId: number): Promise<void> {
    const [rows] = await db.execute(
      `SELECT * FROM git_worktrees WHERE id = ?`,
      [worktreeId]
    );

    if ((rows as any[]).length === 0) {
      return; // Already deleted
    }

    const worktree = (rows as any[])[0];

    try {
      // Remove worktree from git
      await gitC(worktree.repository_path, [
        'worktree', 'remove', worktree.worktree_path, '--force'
      ], { timeout: 60000 }).catch(() => {
        // If worktree remove fails, try deleting directory manually
        return fs.rm(worktree.worktree_path, { recursive: true, force: true });
      });

      // Delete the branch
      await gitC(worktree.repository_path, [
        'branch', '-D', worktree.branch_name
      ], { timeout: 30000 }).catch(() => { /* ignore if branch already deleted */ });

      // Update database
      await db.execute(
        `UPDATE git_worktrees SET status = 'deleted' WHERE id = ?`,
        [worktreeId]
      );
    } catch (error: any) {
      console.error(`Failed to delete worktree ${worktreeId}:`, error);
      throw new Error(`Failed to delete worktree: ${error.message}`);
    }
  }

  // Prune old/orphaned worktrees
  public async pruneWorktrees(db: any): Promise<number> {
    try {
      // Find worktrees that are completed/failed/cancelled and older than 24 hours
      const [rows] = await db.execute(`
        SELECT w.* FROM git_worktrees w
        JOIN agent_sessions s ON w.session_id = s.id
        WHERE s.status IN ('completed', 'failed', 'cancelled')
        AND w.status NOT IN ('deleted', 'merged')
        AND w.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      let pruned = 0;
      for (const row of rows as any[]) {
        try {
          await this.deleteWorktree(db, row.id);
          pruned++;
        } catch { /* ignore individual failures */ }
      }

      // Also run git worktree prune
      await gitC(this.repositoryPath, ['worktree', 'prune']).catch(() => { });

      return pruned;
    } catch (error: any) {
      console.error('Failed to prune worktrees:', error);
      return 0;
    }
  }
}

export const WorktreeManager = WorktreeManagerClass.getInstance();
