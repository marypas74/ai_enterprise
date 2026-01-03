import { TerminalManager } from './TerminalManager.js';
import { WorktreeManager } from './WorktreeManager.js';
import { AgentEventEmitter, SessionLogEvent } from './AgentEventEmitter.js';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CreateSessionDTO {
  name: string;
  taskSpecification: string;
  modelId: number;
  systemPrompt?: string;
  config?: {
    maxIterations?: number;
    timeoutSeconds?: number;
    autoCommit?: boolean;
    runTests?: boolean;
    createWorktree?: boolean;
    baseBranch?: string;
  };
  templateId?: number;
  cardId?: number; // Link to Kanban card
}

export interface AgentSession {
  id: number;
  agentId: number | null;
  userId: number;
  name: string;
  status: 'pending' | 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  modelId: number;
  systemPrompt: string | null;
  taskSpecification: string;
  worktreePath: string | null;
  worktreeBranch: string | null;
  terminalSlot: number;
  iterationCount: number;
  maxIterations: number;
  timeoutSeconds: number;
  parentSessionId: number | null;
  config: any;
  metrics: any;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionLog {
  id: number;
  sessionId: number;
  logType: string;
  content: string;
  metadata: any;
  timestamp: Date;
}

class AgentOrchestratorClass {
  private static instance: AgentOrchestratorClass;
  private runningProcesses: Map<number, ChildProcess> = new Map();
  private sessionTimeouts: Map<number, NodeJS.Timeout> = new Map();

  private constructor() { }

  public static getInstance(): AgentOrchestratorClass {
    if (!AgentOrchestratorClass.instance) {
      AgentOrchestratorClass.instance = new AgentOrchestratorClass();
    }
    return AgentOrchestratorClass.instance;
  }

  // Initialize orchestrator (call on server startup)
  public async initialize(db: any): Promise<void> {
    // Sync terminal slots from database
    await TerminalManager.syncFromDatabase(db);

    // Resume any paused sessions or mark interrupted sessions as failed
    await this.cleanupInterruptedSessions(db);

    console.log('Agent Orchestrator initialized');
  }

  // Create a new agent session
  public async createSession(
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
      const session = await this.getSession(db, sessionId);
      if (!session) {
        throw new Error('Failed to create session');
      }

      // Emit event
      AgentEventEmitter.sessionCreated(sessionId, session);

      // Add initial log
      await this.addLog(db, sessionId, {
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

  // Get a session by ID
  public async getSession(db: any, sessionId: number): Promise<AgentSession | null> {
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
    return this.mapRowToSession(row);
  }

  // Get sessions for a user
  public async getUserSessions(
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
      sessions: (rows as any[]).map(row => this.mapRowToSession(row)),
      total
    };
  }

  // Start a session
  public async startSession(db: any, sessionId: number): Promise<void> {
    const session = await this.getSession(db, sessionId);
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

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: 'Session starting...'
    });

    AgentEventEmitter.sessionUpdated(sessionId, { status: 'initializing' });

    try {
      const config = session.config || {};

      // Create worktree if configured
      if (config.createWorktree) {
        await this.addLog(db, sessionId, {
          sessionId,
          logType: 'info',
          content: `Creating git worktree on branch '${config.baseBranch}'...`
        });

        const worktree = await WorktreeManager.createWorktree(db, sessionId, config.baseBranch);

        await this.addLog(db, sessionId, {
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
      await this.updateLinkedCard(db, sessionId, 'in_progress');

      // Set timeout
      const timeout = setTimeout(async () => {
        await this.handleSessionTimeout(db, sessionId);
      }, session.timeoutSeconds * 1000);
      this.sessionTimeouts.set(sessionId, timeout);

      // Start the agent execution (this would integrate with Claude Code CLI or API)
      await this.executeAgent(db, sessionId);

    } catch (error: any) {
      await this.failSession(db, sessionId, error.message);
    }
  }

  // Execute the agent (main execution loop)
  private async executeAgent(db: any, sessionId: number): Promise<void> {
    const session = await this.getSession(db, sessionId);
    if (!session) return;

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: 'Starting agent execution...'
    });

    // For hybrid execution: Use Claude Code CLI if available, otherwise use API
    const useClaudeCLI = await this.isClaudeCodeAvailable();

    if (useClaudeCLI) {
      await this.executeWithClaudeCode(db, session);
    } else {
      await this.executeWithAPI(db, session);
    }
  }

  // Check if Claude Code CLI is available
  private async isClaudeCodeAvailable(): Promise<boolean> {
    try {
      await execAsync('which claude');
      return true;
    } catch {
      return false;
    }
  }

  // Execute with Claude Code CLI
  private async executeWithClaudeCode(db: any, session: AgentSession): Promise<void> {
    const workingDir = session.worktreePath || process.env.REPOSITORY_PATH || '/home/mpasqui/enterprise-ai-chat';

    await this.addLog(db, session.id, {
      sessionId: session.id,
      logType: 'info',
      content: `Executing with Claude Code CLI in ${workingDir}`
    });

    const claudeProcess = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
      session.taskSpecification
    ], {
      cwd: workingDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.runningProcesses.set(session.id, claudeProcess);

    claudeProcess.stdout?.on('data', async (data) => {
      const content = data.toString();
      await this.addLog(db, session.id, {
        sessionId: session.id,
        logType: 'stdout',
        content
      });
    });

    claudeProcess.stderr?.on('data', async (data) => {
      const content = data.toString();
      await this.addLog(db, session.id, {
        sessionId: session.id,
        logType: 'stderr',
        content
      });
    });

    claudeProcess.on('close', async (code) => {
      this.runningProcesses.delete(session.id);

      if (code === 0) {
        await this.completeSession(db, session.id, 'Agent completed successfully');
      } else {
        await this.failSession(db, session.id, `Agent exited with code ${code}`);
      }
    });

    claudeProcess.on('error', async (error) => {
      this.runningProcesses.delete(session.id);
      await this.failSession(db, session.id, `Agent process error: ${error.message}`);
    });
  }

  // Execute with API (fallback)
  private async executeWithAPI(db: any, session: AgentSession): Promise<void> {
    await this.addLog(db, session.id, {
      sessionId: session.id,
      logType: 'info',
      content: 'Executing with API (Claude Code CLI not available)'
    });

    // This would integrate with the AI provider factory
    // For now, mark as a placeholder that needs implementation
    await this.addLog(db, session.id, {
      sessionId: session.id,
      logType: 'warning',
      content: 'API execution mode requires additional configuration. Please install Claude Code CLI for full functionality.'
    });

    // Mark as completed with warning
    await this.completeSession(db, session.id, 'API execution mode - limited functionality');
  }

  // Pause a session
  public async pauseSession(db: any, sessionId: number): Promise<void> {
    const session = await this.getSession(db, sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'running') {
      throw new Error('Can only pause running sessions');
    }

    // Kill the running process if any
    const process = this.runningProcesses.get(sessionId);
    if (process) {
      process.kill('SIGSTOP');
    }

    await db.execute(
      `UPDATE agent_sessions SET status = 'paused' WHERE id = ?`,
      [sessionId]
    );

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: 'Session paused'
    });

    AgentEventEmitter.sessionUpdated(sessionId, { status: 'paused' });
  }

  // Resume a paused session
  public async resumeSession(db: any, sessionId: number): Promise<void> {
    const session = await this.getSession(db, sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'paused') {
      throw new Error('Can only resume paused sessions');
    }

    const process = this.runningProcesses.get(sessionId);
    if (process) {
      process.kill('SIGCONT');
    }

    await db.execute(
      `UPDATE agent_sessions SET status = 'running' WHERE id = ?`,
      [sessionId]
    );

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: 'Session resumed'
    });

    AgentEventEmitter.sessionUpdated(sessionId, { status: 'running' });
  }

  // Cancel a session
  public async cancelSession(db: any, sessionId: number): Promise<void> {
    const session = await this.getSession(db, sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Kill the running process
    const process = this.runningProcesses.get(sessionId);
    if (process) {
      process.kill('SIGKILL');
      this.runningProcesses.delete(sessionId);
    }

    // Clear timeout
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    await db.execute(
      `UPDATE agent_sessions SET status = 'cancelled', completed_at = NOW() WHERE id = ?`,
      [sessionId]
    );

    // Release terminal slot
    TerminalManager.releaseBySessionId(sessionId);

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: 'Session cancelled by user'
    });

    AgentEventEmitter.sessionUpdated(sessionId, { status: 'cancelled' });

    // Update linked Kanban card
    await this.updateLinkedCard(db, sessionId, 'failed');
  }

  // Complete a session successfully
  private async completeSession(db: any, sessionId: number, message: string): Promise<void> {
    // Clear timeout
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    await db.execute(
      `UPDATE agent_sessions SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [sessionId]
    );

    // Release terminal slot
    TerminalManager.releaseBySessionId(sessionId);

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'info',
      content: message
    });

    AgentEventEmitter.sessionCompleted(sessionId, { message });

    // Update linked Kanban card
    await this.updateLinkedCard(db, sessionId, 'completed');
  }

  // Fail a session
  private async failSession(db: any, sessionId: number, error: string): Promise<void> {
    // Clear timeout
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    await db.execute(
      `UPDATE agent_sessions SET status = 'failed', completed_at = NOW() WHERE id = ?`,
      [sessionId]
    );

    // Release terminal slot
    TerminalManager.releaseBySessionId(sessionId);

    await this.addLog(db, sessionId, {
      sessionId,
      logType: 'error',
      content: `Session failed: ${error}`
    });

    AgentEventEmitter.sessionFailed(sessionId, error);

    // Update linked Kanban card
    await this.updateLinkedCard(db, sessionId, 'failed');
  }

  // Handle session timeout
  private async handleSessionTimeout(db: any, sessionId: number): Promise<void> {
    const process = this.runningProcesses.get(sessionId);
    if (process) {
      process.kill('SIGKILL');
      this.runningProcesses.delete(sessionId);
    }

    await this.failSession(db, sessionId, 'Session timed out');
  }

  // Add a log entry
  public async addLog(db: any, sessionId: number, log: SessionLogEvent): Promise<void> {
    await db.execute(
      `INSERT INTO agent_session_logs (session_id, log_type, content, metadata)
       VALUES (?, ?, ?, ?)`,
      [sessionId, log.logType, log.content, JSON.stringify(log.metadata || {})]
    );

    AgentEventEmitter.logAdded(sessionId, log);
  }

  // Get session logs
  public async getSessionLogs(
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

  // Update linked Kanban card
  private async updateLinkedCard(
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

  // Cleanup interrupted sessions on startup
  private async cleanupInterruptedSessions(db: any): Promise<void> {
    // Mark running/initializing sessions as failed (they were interrupted)
    await db.execute(
      `UPDATE agent_sessions
       SET status = 'failed', completed_at = NOW()
       WHERE status IN ('running', 'initializing')`
    );
  }

  // Get dashboard metrics
  public async getDashboardMetrics(db: any): Promise<any> {
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

  // Map database row to AgentSession
  private mapRowToSession(row: any): AgentSession {
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
}

export const AgentOrchestrator = AgentOrchestratorClass.getInstance();
