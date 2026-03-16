export interface TerminalSlot {
  slot: number;
  status: 'available' | 'occupied' | 'reserved';
  sessionId: number | null;
  sessionName: string | null;
  assignedAt: string | null;
}

export interface OrchestratorMetrics {
  terminals: {
    total: number;
    available: number;
    occupied: number;
    reserved: number;
  };
  sessions: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  performance: {
    totalIterations: number;
    avgDurationSeconds: number;
  };
}

export interface WorktreeStatus {
  id: number;
  sessionId: number;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  status: 'active' | 'merged' | 'conflict' | 'deleted';
  conflictFiles: string[];
  createdAt: string;
  mergedAt: string | null;
}

export interface ConflictContent {
  path: string;
  ourContent: string;
  theirContent: string;
  baseContent: string;
}
