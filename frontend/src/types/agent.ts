export interface AgentSession {
  id: number;
  agentId: number | null;
  userId: number;
  name: string;
  status: 'pending' | 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  modelId: number;
  modelName?: string;
  modelDisplayName?: string;
  systemPrompt: string | null;
  taskSpecification: string;
  worktreePath: string | null;
  worktreeBranch: string | null;
  terminalSlot: number;
  iterationCount: number;
  maxIterations: number;
  timeoutSeconds: number;
  parentSessionId: number | null;
  config: SessionConfig;
  metrics: any;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConfig {
  maxIterations?: number;
  timeoutSeconds?: number;
  autoCommit?: boolean;
  runTests?: boolean;
  createWorktree?: boolean;
  baseBranch?: string;
}

export interface SessionLog {
  id: number;
  sessionId: number;
  logType: 'info' | 'warning' | 'error' | 'stdout' | 'stderr';
  content: string;
  metadata: any;
  timestamp: string;
}

export interface AgentTemplate {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  modelId: number;
  modelName: string;
  modelDisplayName: string;
  systemPrompt: string;
  defaultConfig: Record<string, any>;
  tools: string[];
  maxIterations: number;
  timeoutSeconds: number;
  category: string;
  isPublic: boolean;
  createdAt: string;
}

export interface CreateSessionData {
  name: string;
  taskSpecification: string;
  modelId: number;
  systemPrompt?: string;
  templateId?: number;
  cardId?: number;
  config?: SessionConfig;
}
