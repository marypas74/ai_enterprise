/**
 * AgentOrchestrator - Slim orchestrator that delegates to sub-modules
 * Maintains the same public interface for backward compatibility
 */

import { TerminalManager } from './TerminalManager.js';
import { ChildProcess } from 'child_process';
import {
  getSession as _getSession,
  getUserSessions as _getUserSessions,
  createSession as _createSession,
  addLog as _addLog,
  getSessionLogs as _getSessionLogs,
  completeSession as _completeSession,
  failSession as _failSession,
  cleanupInterruptedSessions,
  getDashboardMetrics as _getDashboardMetrics,
} from './agent/AgentSessionManager.js';
import {
  startSession as _startSession,
  pauseSession as _pauseSession,
  resumeSession as _resumeSession,
  cancelSession as _cancelSession,
} from './agent/AgentExecutor.js';
import type { SessionLogEvent } from './AgentEventEmitter.js';

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
    await TerminalManager.syncFromDatabase(db);
    await cleanupInterruptedSessions(db);
    console.log('Agent Orchestrator initialized');
  }

  // Delegate to AgentSessionManager
  public async createSession(db: any, userId: number, data: CreateSessionDTO): Promise<AgentSession> {
    return _createSession(db, userId, data);
  }

  public async getSession(db: any, sessionId: number): Promise<AgentSession | null> {
    return _getSession(db, sessionId);
  }

  public async getUserSessions(
    db: any,
    userId: number,
    options: { status?: string; limit?: number; offset?: number } = {}
  ): Promise<{ sessions: AgentSession[]; total: number }> {
    return _getUserSessions(db, userId, options);
  }

  public async addLog(db: any, sessionId: number, log: SessionLogEvent): Promise<void> {
    return _addLog(db, sessionId, log);
  }

  public async getSessionLogs(
    db: any,
    sessionId: number,
    options: { limit?: number; offset?: number; logType?: string } = {}
  ): Promise<{ logs: SessionLog[]; total: number }> {
    return _getSessionLogs(db, sessionId, options);
  }

  public async getDashboardMetrics(db: any): Promise<any> {
    return _getDashboardMetrics(db);
  }

  // Delegate to AgentExecutor
  public async startSession(db: any, sessionId: number): Promise<void> {
    return _startSession(db, sessionId, this.runningProcesses, this.sessionTimeouts);
  }

  public async pauseSession(db: any, sessionId: number): Promise<void> {
    return _pauseSession(db, sessionId, this.runningProcesses);
  }

  public async resumeSession(db: any, sessionId: number): Promise<void> {
    return _resumeSession(db, sessionId, this.runningProcesses);
  }

  public async cancelSession(db: any, sessionId: number): Promise<void> {
    return _cancelSession(db, sessionId, this.runningProcesses, this.sessionTimeouts);
  }
}

export const AgentOrchestrator = AgentOrchestratorClass.getInstance();
