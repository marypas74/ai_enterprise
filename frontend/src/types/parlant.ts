export interface ParlantAgent {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface ParlantGuideline {
  id: string;
  agentId: string;
  condition: string;
  action: string;
  priority?: number;
  enabled: boolean;
  createdAt?: string;
}

export interface ParlantSession {
  id: string;
  agentId: string;
  customerId?: string;
  status?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
}

export interface ParlantEvent {
  id: string;
  sessionId?: string;
  kind: string;
  source: string;
  // Parlant API returns message content in data.message
  data?: {
    message?: string;
    status?: string;
    participant?: {
      id: string;
      display_name?: string;
    };
  };
  offset?: number;
  creation_utc?: string;
  correlation_id?: string;
}

export interface ParlantEvaluation {
  id: string;
  sessionId: string;
  guidelineId: string;
  applied: boolean;
  rationale?: string;
}
