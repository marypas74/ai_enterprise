/**
 * AgentExecutor - Agent execution logic and tool loop
 * Handles the actual execution of agent sessions via Claude Code CLI or API
 */

import { WorktreeManager } from '../WorktreeManager.js';
import { AgentEventEmitter } from '../AgentEventEmitter.js';
import { TerminalManager } from '../TerminalManager.js';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  getSession,
  addLog,
  completeSession,
  failSession,
  updateLinkedCard,
} from './AgentSessionManager.js';
import type { AgentSession } from '../AgentOrchestrator.js';

const execAsync = promisify(exec);

/**
 * Start a session and begin execution
 */
export async function startSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  sessionId: number,
  runningProcesses: Map<number, ChildProcess>,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (session.status !== 'pending' && session.status !== 'paused') {
    throw new Error(`Cannot start session in ${session.status} status`);
  }

  // Update status to initializing
  await db.execute(
    `UPDATE agent_sessions SET status = 'initializing', started_at = NOW() WHERE id = ?`,
    [sessionId]
  );

  await addLog(db, sessionId, {
    sessionId,
    logType: 'info',
    content: 'Session starting...'
  });

  AgentEventEmitter.sessionUpdated(sessionId, { status: 'initializing' });

  try {
    const config = session.config || {};

    // Create worktree if configured
    if (config.createWorktree) {
      await addLog(db, sessionId, {
        sessionId,
        logType: 'info',
        content: `Creating git worktree on branch '${config.baseBranch}'...`
      });

      const worktree = await WorktreeManager.createWorktree(db, sessionId, config.baseBranch);

      await addLog(db, sessionId, {
        sessionId,
        logType: 'info',
        content: `Worktree created at ${worktree.worktreePath}`
      });
    }

    // Update status to running
    await db.execute(
      `UPDATE agent_sessions SET status = 'running' WHERE id = ?`,
      [sessionId]
    );

    AgentEventEmitter.sessionUpdated(sessionId, { status: 'running' });

    // Update linked Kanban card status
    await updateLinkedCard(db, sessionId, 'in_progress');

    // Set timeout
    const timeout = setTimeout(async () => {
      await handleSessionTimeout(db, sessionId, runningProcesses, sessionTimeouts);
    }, session.timeoutSeconds * 1000);
    sessionTimeouts.set(sessionId, timeout);

    // Start the agent execution
    await executeAgent(db, sessionId, runningProcesses, sessionTimeouts);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (error: any) {
    await failSession(db, sessionId, error.message, sessionTimeouts);
  }
}

/**
 * Execute the agent (main execution loop)
 */
async function executeAgent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  sessionId: number,
  runningProcesses: Map<number, ChildProcess>,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session) return;

  await addLog(db, sessionId, {
    sessionId,
    logType: 'info',
    content: 'Starting agent execution...'
  });

  // For hybrid execution: Use Claude Code CLI if available, otherwise use API
  const useClaudeCLI = await isClaudeCodeAvailable();

  if (useClaudeCLI) {
    await executeWithClaudeCode(db, session, runningProcesses, sessionTimeouts);
  } else {
    await executeWithAPI(db, session, sessionTimeouts);
  }
}

/**
 * Check if Claude Code CLI is available
 */
async function isClaudeCodeAvailable(): Promise<boolean> {
  try {
    await execAsync('which claude');
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute with Claude Code CLI
 */
async function executeWithClaudeCode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  session: AgentSession,
  runningProcesses: Map<number, ChildProcess>,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  const workingDir = session.worktreePath || process.env.REPOSITORY_PATH || '/home/mpasqui/enterprise-ai-chat';

  await addLog(db, session.id, {
    sessionId: session.id,
    logType: 'info',
    content: `Executing with Claude Code CLI in ${workingDir}`
  });

  // SECURITY: Use '--' to prevent taskSpecification from being parsed as CLI flags
  const claudeProcess = spawn('claude', [
    '--print',
    '--',
    session.taskSpecification
  ], {
    cwd: workingDir,
    env: {
      ...process.env,
      CLAUDE_AGENT_MODE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  runningProcesses.set(session.id, claudeProcess);

  claudeProcess.stdout?.on('data', async (data) => {
    const content = data.toString();
    await addLog(db, session.id, {
      sessionId: session.id,
      logType: 'stdout',
      content
    });
  });

  claudeProcess.stderr?.on('data', async (data) => {
    const content = data.toString();
    await addLog(db, session.id, {
      sessionId: session.id,
      logType: 'stderr',
      content
    });
  });

  claudeProcess.on('close', async (code) => {
    runningProcesses.delete(session.id);

    if (code === 0) {
      await completeSession(db, session.id, 'Agent completed successfully', sessionTimeouts);
    } else {
      await failSession(db, session.id, `Agent exited with code ${code}`, sessionTimeouts);
    }
  });

  claudeProcess.on('error', async (error) => {
    runningProcesses.delete(session.id);
    await failSession(db, session.id, `Agent process error: ${error.message}`, sessionTimeouts);
  });
}

/**
 * Execute with API (fallback when Claude Code CLI is not available)
 */
async function executeWithAPI(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  session: AgentSession,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  await addLog(db, session.id, {
    sessionId: session.id,
    logType: 'info',
    content: 'Executing with API (Claude Code CLI not available)'
  });

  // This would integrate with the AI provider factory
  // For now, mark as a placeholder that needs implementation
  await addLog(db, session.id, {
    sessionId: session.id,
    logType: 'warning',
    content: 'API execution mode requires additional configuration. Please install Claude Code CLI for full functionality.'
  });

  // Mark as completed with warning
  await completeSession(db, session.id, 'API execution mode - limited functionality', sessionTimeouts);
}

/**
 * Pause a running session
 */
export async function pauseSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  sessionId: number,
  runningProcesses: Map<number, ChildProcess>
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (session.status !== 'running') {
    throw new Error('Can only pause running sessions');
  }

  // Kill the running process if any
  const proc = runningProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGSTOP');
  }

  await db.execute(
    `UPDATE agent_sessions SET status = 'paused' WHERE id = ?`,
    [sessionId]
  );

  await addLog(db, sessionId, {
    sessionId,
    logType: 'info',
    content: 'Session paused'
  });

  AgentEventEmitter.sessionUpdated(sessionId, { status: 'paused' });
}

/**
 * Resume a paused session
 */
export async function resumeSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  sessionId: number,
  runningProcesses: Map<number, ChildProcess>
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (session.status !== 'paused') {
    throw new Error('Can only resume paused sessions');
  }

  const proc = runningProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGCONT');
  }

  await db.execute(
    `UPDATE agent_sessions SET status = 'running' WHERE id = ?`,
    [sessionId]
  );

  await addLog(db, sessionId, {
    sessionId,
    logType: 'info',
    content: 'Session resumed'
  });

  AgentEventEmitter.sessionUpdated(sessionId, { status: 'running' });
}

/**
 * Cancel a session
 */
export async function cancelSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  sessionId: number,
  runningProcesses: Map<number, ChildProcess>,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // Kill the running process
  const proc = runningProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGKILL');
    runningProcesses.delete(sessionId);
  }

  // Clear timeout
  const timeout = sessionTimeouts.get(sessionId);
  if (timeout) {
    clearTimeout(timeout);
    sessionTimeouts.delete(sessionId);
  }

  await db.execute(
    `UPDATE agent_sessions SET status = 'cancelled', completed_at = NOW() WHERE id = ?`,
    [sessionId]
  );

  // Release terminal slot
  TerminalManager.releaseBySessionId(sessionId);

  await addLog(db, sessionId, {
    sessionId,
    logType: 'info',
    content: 'Session cancelled by user'
  });

  AgentEventEmitter.sessionUpdated(sessionId, { status: 'cancelled' });

  // Update linked Kanban card
  await updateLinkedCard(db, sessionId, 'failed');
}

/**
 * Handle session timeout
 */
async function handleSessionTimeout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  sessionId: number,
  runningProcesses: Map<number, ChildProcess>,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  const proc = runningProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGKILL');
    runningProcesses.delete(sessionId);
  }

  await failSession(db, sessionId, 'Session timed out', sessionTimeouts);
}
