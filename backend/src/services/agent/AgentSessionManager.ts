/**
 * AgentSessionManager - Session lifecycle management
 * Handles create, get, list, pause, resume, cancel, complete, fail sessions
 */

import { TerminalManager } from '../TerminalManager.js';
import { AgentEventEmitter, SessionLogEvent } from '../AgentEventEmitter.js';
import type { CreateSessionDTO, AgentSession, SessionLog } from '../AgentOrchestrator.js';

/**
 * Map a database row to an AgentSession object (immutable mapping)
 */
export function mapRowToSession(row: any): AgentSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    modelId: row.model_id,
    systemPrompt: row.system_prompt,
    taskSpecification: row.task_specification,
    worktreePath: row.worktree_path,
    worktreeBranch: row.worktree_branch,
    terminalSlot: row.terminal_slot,
    iterationCount: row.iteration_count,
    maxIterations: row.max_iterations,
    timeoutSeconds: row.timeout_seconds,
    parentSessionId: row.parent_session_id,
    config: row.config ? JSON.parse(row.config) : {},
    metrics: row.metrics ? JSON.parse(row.metrics) : {},
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Get a session by ID
 */
export async function getSession(db: any, sessionId: number): Promise<AgentSession | null> {
  const [rows] = await db.execute(
    `SELECT s.*, m.model_id as model_name, m.display_name as model_display_name
     FROM agent_sessions s
     LEFT JOIN ai_models m ON s.model_id = m.id
     WHERE s.id = ?`,
    [sessionId]
  );

  if ((rows as any[]).length === 0) {
    return null;
  }

  const row = (rows as any[])[0];
  return mapRowToSession(row);
}

/**
 * Get sessions for a user with optional filters and pagination
 */
export async function getUserSessions(
  db: any,
  userId: number,
  options: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ sessions: AgentSession[]; total: number }> {
  const { status, limit = 50, offset = 0 } = options;

  let query = `SELECT s.*, m.model_id as model_name FROM agent_sessions s
               LEFT JOIN ai_models m ON s.model_id = m.id
               WHERE s.user_id = ?`;
  const params: any[] = [userId];

  if (status) {
    query += ' AND s.status = ?';
    params.push(status);
  }

  // Get total count
  const [countResult] = await db.execute(
    query.replace('SELECT s.*, m.model_id as model_name', 'SELECT COUNT(*) as total'),
    params
  );
  const total = (countResult as any[])[0].total;

  // Get paginated results
  query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [rows] = await db.execute(query, params);

  return {
    sessions: (rows as any[]).map(row => mapRowToSession(row)),
    total
  };
}

/**
 * Create a new agent session
 */
export async function createSession(
  db: any,
  userId: number,
  data: CreateSessionDTO
): Promise<AgentSession> {
  // Check for available terminal slot
  const availableSlot = TerminalManager.findAvailableSlot();
  if (availableSlot === null) {
    throw new Error('No terminal slots available. Maximum 12 concurrent sessions allowed.');
  }

  // Reserve the slot
  const reservedSlot = TerminalManager.reserveSlot(availableSlot);
  if (reservedSlot === null) {
    throw new Error('Failed to reserve terminal slot');
  }

  try {
    // Get template config if templateId provided
    let templateConfig: any = {};
    if (data.templateId) {
      const [templates] = await db.execute(
        'SELECT * FROM agent_templates WHERE id = ? AND (user_id = ? OR is_public = TRUE)',
        [data.templateId, userId]
      );
      if ((templates as any[]).length > 0) {
        const template = (templates as any[])[0];
        templateConfig = {
          systemPrompt: template.system_prompt,
          modelId: template.model_id,
          maxIterations: template.max_iterations,
          timeoutSeconds: template.timeout_seconds,
          tools: template.tools ? JSON.parse(template.tools) : [],
          ...JSON.parse(template.default_config || '{}')
        };
      }
    }

    // Merge configs
    const config = {
      maxIterations: data.config?.maxIterations || templateConfig.maxIterations || 50,
      timeoutSeconds: data.config?.timeoutSeconds || templateConfig.timeoutSeconds || 3600,
      autoCommit: data.config?.autoCommit ?? true,
      runTests: data.config?.runTests ?? true,
      createWorktree: data.config?.createWorktree ?? true,
      baseBranch: data.config?.baseBranch || 'main',
      tools: templateConfig.tools || []
    };

    // Insert session into database
    const [result] = await db.execute(
      `INSERT INTO agent_sessions
       (user_id, name, status, model_id, system_prompt, task_specification, terminal_slot,
        max_iterations, timeout_seconds, config)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        data.name,
        data.modelId || templateConfig.modelId,
        data.systemPrompt || templateConfig.systemPrompt || null,
        data.taskSpecification,
        reservedSlot,
        config.maxIterations,
        config.timeoutSeconds,
        JSON.stringify(config)
      ]
    );

    const sessionId = (result as any).insertId;

    // Assign terminal slot
    TerminalManager.assignSlot(sessionId, data.name, reservedSlot);

    // Link to Kanban card if provided
    if (data.cardId) {
      await db.execute(
        `INSERT INTO kanban_card_agents (card_id, session_id, status) VALUES (?, ?, 'assigned')`,
        [data.cardId, sessionId]
      );
    }

    // Fetch the created session
    const session = await getSession(db, sessionId);
    if (!session) {
      throw new Error('Failed to create session');
    }

    // Emit event
    AgentEventEmitter.sessionCreated(sessionId, session);

    // Add initial log
    await addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: `Session "${data.name}" created successfully`,
      metadata: { config }
    });

    return session;
  } catch (error) {
    // Release the reserved slot on failure
    TerminalManager.releaseSlot(reservedSlot);
    throw error;
  }
}

/**
 * Add a log entry for a session
 */
export async function addLog(db: any, sessionId: number, log: SessionLogEvent): Promise<void> {
  await db.execute(
    `INSERT INTO agent_session_logs (session_id, log_type, content, metadata)
     VALUES (?, ?, ?, ?)`,
    [sessionId, log.logType, log.content, JSON.stringify(log.metadata || {})]
  );

  AgentEventEmitter.logAdded(sessionId, log);
}

/**
 * Get session logs with optional filtering and pagination
 */
export async function getSessionLogs(
  db: any,
  sessionId: number,
  options: { limit?: number; offset?: number; logType?: string } = {}
): Promise<{ logs: SessionLog[]; total: number }> {
  const { limit = 100, offset = 0, logType } = options;

  let query = `SELECT * FROM agent_session_logs WHERE session_id = ?`;
  const params: any[] = [sessionId];

  if (logType) {
    query += ' AND log_type = ?';
    params.push(logType);
  }

  // Get total
  const [countResult] = await db.execute(
    query.replace('SELECT *', 'SELECT COUNT(*) as total'),
    params
  );
  const total = (countResult as any[])[0].total;

  // Get logs
  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [rows] = await db.execute(query, params);

  return {
    logs: (rows as any[]).map(row => ({
      id: row.id,
      sessionId: row.session_id,
      logType: row.log_type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      timestamp: row.timestamp
    })),
    total
  };
}

/**
 * Complete a session successfully
 */
export async function completeSession(
  db: any,
  sessionId: number,
  message: string,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  // Clear timeout
  const timeout = sessionTimeouts.get(sessionId);
  if (timeout) {
    clearTimeout(timeout);
    sessionTimeouts.delete(sessionId);
  }

  await db.execute(
    `UPDATE agent_sessions SET status = 'completed', completed_at = NOW() WHERE id = ?`,
    [sessionId]
  );

  // Release terminal slot
  TerminalManager.releaseBySessionId(sessionId);

  await addLog(db, sessionId, {
    sessionId,
    logType: 'info',
    content: message
  });

  AgentEventEmitter.sessionCompleted(sessionId, { message });

  // Update linked Kanban card
  await updateLinkedCard(db, sessionId, 'completed');
}

/**
 * Fail a session with an error message
 */
export async function failSession(
  db: any,
  sessionId: number,
  error: string,
  sessionTimeouts: Map<number, NodeJS.Timeout>
): Promise<void> {
  // Clear timeout
  const timeout = sessionTimeouts.get(sessionId);
  if (timeout) {
    clearTimeout(timeout);
    sessionTimeouts.delete(sessionId);
  }

  await db.execute(
    `UPDATE agent_sessions SET status = 'failed', completed_at = NOW() WHERE id = ?`,
    [sessionId]
  );

  // Release terminal slot
  TerminalManager.releaseBySessionId(sessionId);

  await addLog(db, sessionId, {
    sessionId,
    logType: 'error',
    content: `Session failed: ${error}`
  });

  AgentEventEmitter.sessionFailed(sessionId, error);

  // Update linked Kanban card
  await updateLinkedCard(db, sessionId, 'failed');
}

/**
 * Update linked Kanban card based on session status
 */
export async function updateLinkedCard(
  db: any,
  sessionId: number,
  agentStatus: 'in_progress' | 'completed' | 'failed'
): Promise<void> {
  try {
    // Get linked card
    const [links] = await db.execute(
      `SELECT kca.*, kc.column_id FROM kanban_card_agents kca
       JOIN kanban_cards kc ON kca.card_id = kc.id
       WHERE kca.session_id = ? AND kca.auto_update_card = TRUE`,
      [sessionId]
    );

    if ((links as any[]).length === 0) return;

    const link = (links as any[])[0];

    // Update link status
    await db.execute(
      `UPDATE kanban_card_agents SET status = ?, completed_at = IF(? IN ('completed', 'failed'), NOW(), NULL)
       WHERE session_id = ?`,
      [agentStatus, agentStatus, sessionId]
    );

    // Get the board's columns to find the appropriate one
    const [columns] = await db.execute(
      `SELECT kc.* FROM kanban_columns kc
       JOIN kanban_cards card ON kc.id = card.column_id OR kc.board_id = (
         SELECT board_id FROM kanban_columns WHERE id = card.column_id
       )
       WHERE card.id = ?
       ORDER BY kc.sort_order`,
      [link.card_id]
    );

    const cols = columns as any[];
    let targetColumnId = link.column_id;

    // Find appropriate column based on status
    if (agentStatus === 'in_progress') {
      const inProgressCol = cols.find(c =>
        c.name.toLowerCase().includes('progress') ||
        c.name.toLowerCase().includes('doing')
      );
      if (inProgressCol) targetColumnId = inProgressCol.id;
    } else if (agentStatus === 'completed') {
      const doneCol = cols.find(c =>
        c.name.toLowerCase().includes('done') ||
        c.name.toLowerCase().includes('complete')
      );
      if (doneCol) targetColumnId = doneCol.id;
    }

    // Move card if column changed
    if (targetColumnId !== link.column_id) {
      await db.execute(
        `UPDATE kanban_cards SET column_id = ? WHERE id = ?`,
        [targetColumnId, link.card_id]
      );

      // Log activity
      await db.execute(
        `INSERT INTO kanban_card_activity (card_id, user_id, action_type, details)
         VALUES (?, 1, 'moved', ?)`,
        [link.card_id, JSON.stringify({
          from_column: link.column_id,
          to_column: targetColumnId,
          reason: `Agent session ${agentStatus}`
        })]
      );
    }
  } catch (error) {
    console.error('Failed to update linked Kanban card:', error);
  }
}

/**
 * Cleanup interrupted sessions on startup
 */
export async function cleanupInterruptedSessions(db: any): Promise<void> {
  // Mark running/initializing sessions as failed (they were interrupted)
  await db.execute(
    `UPDATE agent_sessions
     SET status = 'failed', completed_at = NOW()
     WHERE status IN ('running', 'initializing')`
  );
}

/**
 * Get dashboard metrics for agent sessions
 */
export async function getDashboardMetrics(db: any): Promise<any> {
  const terminalMetrics = TerminalManager.getMetrics();

  const [stats] = await db.execute(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(iteration_count) as total_iterations,
      AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) as avg_duration_seconds
    FROM agent_sessions
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  `);

  const metrics = (stats as any[])[0];

  return {
    terminals: terminalMetrics,
    sessions: {
      total: metrics.total_sessions || 0,
      running: metrics.running || 0,
      completed: metrics.completed || 0,
      failed: metrics.failed || 0,
      successRate: metrics.total_sessions > 0
        ? Math.round((metrics.completed / metrics.total_sessions) * 100)
        : 0
    },
    performance: {
      totalIterations: metrics.total_iterations || 0,
      avgDurationSeconds: Math.round(metrics.avg_duration_seconds || 0)
    }
  };
}
