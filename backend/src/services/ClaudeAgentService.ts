/**
 * Claude Agent SDK Service
 *
 * Provides agentic capabilities using the Claude Agent SDK.
 * Supports autonomous agents that can understand codebases, edit files,
 * run commands, and execute complex workflows.
 *
 * @see https://github.com/anthropics/claude-agent-sdk-typescript
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

// Agent SDK message type (not exported by SDK, so we define our own)
type AgentMessage = unknown;

// Types for agent configuration
export interface AgentConfig {
  apiKey?: string;
  model?: string;
  maxTurns?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  workingDirectory?: string;
  mcpServers?: MCPServerConfig[];
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentResponse {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  error?: string;
}

export interface AgentSession {
  id: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  messages: AgentResponse[];
  startedAt: Date;
  completedAt?: Date;
  tokensUsed?: number;
}

// Active sessions tracking
const activeSessions = new Map<string, {
  abortController: AbortController;
  session: AgentSession
}>();

/**
 * Claude Agent Service
 * Manages agentic interactions with Claude
 */
export class ClaudeAgentService {
  private apiKey: string;
  private defaultModel: string;

  constructor(config?: { apiKey?: string; defaultModel?: string }) {
    this.apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.defaultModel = config?.defaultModel || 'claude-sonnet-4-20250514';
  }

  /**
   * Run an agent with the given prompt
   * Returns an async generator that yields agent responses
   */
  async *runAgent(
    prompt: string,
    config: AgentConfig = {}
  ): AsyncGenerator<AgentResponse> {
    const sessionId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const abortController = new AbortController();

    const session: AgentSession = {
      id: sessionId,
      status: 'running',
      messages: [],
      startedAt: new Date()
    };

    activeSessions.set(sessionId, { abortController, session });

    try {
      // Configure environment for Agent SDK
      if (this.apiKey) {
        process.env.ANTHROPIC_API_KEY = this.apiKey;
      }

      const agentOptions: Record<string, unknown> = {
        prompt,
        model: config.model || this.defaultModel,
        maxTurns: config.maxTurns || 10,
        systemPrompt: config.systemPrompt,
        cwd: config.workingDirectory || process.cwd()
      };

      // Configure allowed tools
      if (config.allowedTools && config.allowedTools.length > 0) {
        agentOptions.allowedTools = config.allowedTools;
      }

      // Configure permission mode
      if (config.permissionMode) {
        agentOptions.permissionMode = config.permissionMode;
      }

      // Configure MCP servers
      if (config.mcpServers && config.mcpServers.length > 0) {
        agentOptions.mcpServers = config.mcpServers;
      }

      console.log(`[ClaudeAgent] Starting agent session ${sessionId}`, {
        model: agentOptions.model,
        maxTurns: agentOptions.maxTurns,
        allowedTools: agentOptions.allowedTools
      });

      // Run the agentic loop
      for await (const message of query(agentOptions as Parameters<typeof query>[0])) {
        // Check for abort
        if (abortController.signal.aborted) {
          yield { type: 'error', error: 'Agent cancelled by user' };
          break;
        }

        // Parse and yield the message
        const response = this.parseAgentMessage(message);
        session.messages.push(response);
        yield response;

        if (response.type === 'done') {
          break;
        }
      }

      session.status = 'completed';
      session.completedAt = new Date();
      yield { type: 'done', content: 'Agent completed successfully' };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[ClaudeAgent] Error in session ${sessionId}:`, errorMessage);

      session.status = 'error';
      session.completedAt = new Date();

      yield { type: 'error', error: errorMessage };
    } finally {
      // Clean up after a delay to allow session info retrieval
      setTimeout(() => {
        activeSessions.delete(sessionId);
      }, 60000); // Keep session info for 1 minute
    }
  }

  /**
   * Parse a message from the Agent SDK
   */
  private parseAgentMessage(message: AgentMessage | unknown): AgentResponse {
    if (typeof message === 'string') {
      return { type: 'text', content: message };
    }

    if (message && typeof message === 'object') {
      const msg = message as Record<string, unknown>;

      // Handle different message types from the SDK
      if (msg.type === 'text' || msg.content) {
        return {
          type: 'text',
          content: String(msg.content || msg.text || '')
        };
      }

      if (msg.type === 'tool_use') {
        return {
          type: 'tool_use',
          toolName: String(msg.name || ''),
          toolInput: msg.input as Record<string, unknown>
        };
      }

      if (msg.type === 'tool_result') {
        return {
          type: 'tool_result',
          toolName: String(msg.tool_use_id || ''),
          toolResult: String(msg.content || '')
        };
      }

      if (msg.type === 'error') {
        return {
          type: 'error',
          error: String(msg.error || msg.message || 'Unknown error')
        };
      }
    }

    return { type: 'text', content: JSON.stringify(message) };
  }

  /**
   * Cancel an active agent session
   */
  cancelSession(sessionId: string): boolean {
    const sessionData = activeSessions.get(sessionId);
    if (sessionData) {
      sessionData.abortController.abort();
      sessionData.session.status = 'cancelled';
      sessionData.session.completedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): AgentSession | null {
    const sessionData = activeSessions.get(sessionId);
    return sessionData?.session || null;
  }

  /**
   * List active sessions
   */
  getActiveSessions(): AgentSession[] {
    return Array.from(activeSessions.values())
      .filter(s => s.session.status === 'running')
      .map(s => s.session);
  }

  /**
   * Run a simple code review agent
   */
  async *codeReviewAgent(
    filePath: string,
    config: Partial<AgentConfig> = {}
  ): AsyncGenerator<AgentResponse> {
    const prompt = `Review the code in ${filePath}. Check for:
1. Bugs and potential issues
2. Code style and best practices
3. Security vulnerabilities
4. Performance improvements

Provide specific, actionable feedback.`;

    yield* this.runAgent(prompt, {
      ...config,
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'default'
    });
  }

  /**
   * Run a bug fix agent
   */
  async *bugFixAgent(
    description: string,
    workingDirectory: string,
    config: Partial<AgentConfig> = {}
  ): AsyncGenerator<AgentResponse> {
    const prompt = `Fix this bug: ${description}

Analyze the codebase, find the root cause, and implement a fix.
Test your changes if possible.`;

    yield* this.runAgent(prompt, {
      ...config,
      workingDirectory,
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
      permissionMode: config.permissionMode || 'acceptEdits'
    });
  }

  /**
   * Run a feature implementation agent
   */
  async *featureAgent(
    featureDescription: string,
    workingDirectory: string,
    config: Partial<AgentConfig> = {}
  ): AsyncGenerator<AgentResponse> {
    const prompt = `Implement this feature: ${featureDescription}

1. Analyze the existing codebase structure
2. Plan the implementation
3. Write the code
4. Add tests if appropriate
5. Update documentation if needed`;

    yield* this.runAgent(prompt, {
      ...config,
      workingDirectory,
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
      permissionMode: config.permissionMode || 'acceptEdits'
    });
  }
}

// Singleton instance
let agentService: ClaudeAgentService | null = null;

export function getClaudeAgentService(config?: { apiKey?: string; defaultModel?: string }): ClaudeAgentService {
  if (!agentService || config) {
    agentService = new ClaudeAgentService(config);
  }
  return agentService;
}

export default ClaudeAgentService;
