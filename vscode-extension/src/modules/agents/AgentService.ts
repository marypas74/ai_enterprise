import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { AgentTemplate, AgentSession, AgentLogEntry, StreamChunk } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class AgentService {
  private logController: AbortController | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async getTemplates(): Promise<AgentTemplate[]> {
    const templates = await this.apiClient.get<AgentTemplate[]>(API_PATHS.AGENT_TEMPLATES);
    this.outputChannel.appendLine(`[Agents] Loaded ${templates.length} templates`);
    return templates;
  }

  async getSessions(): Promise<AgentSession[]> {
    return this.apiClient.get<AgentSession[]>(API_PATHS.AGENT_SESSIONS);
  }

  async createSession(templateId: string, prompt: string): Promise<AgentSession> {
    const session = await this.apiClient.post<AgentSession>(API_PATHS.AGENT_SESSIONS, { templateId, prompt });
    this.eventBus.emit('agent:started', { sessionId: session.id });
    this.outputChannel.appendLine(`[Agents] Session created: ${session.id}`);
    return session;
  }

  async pauseSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/pause`);
    this.outputChannel.appendLine(`[Agents] Session paused: ${sessionId}`);
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/resume`);
    this.outputChannel.appendLine(`[Agents] Session resumed: ${sessionId}`);
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/cancel`);
    this.eventBus.emit('agent:completed', { sessionId, status: 'cancelled' });
    this.outputChannel.appendLine(`[Agents] Session cancelled: ${sessionId}`);
  }

  streamSessionLogs(
    sessionId: string,
    onEntry: (entry: AgentLogEntry) => void,
    onError: (error: Error) => void,
  ): void {
    this.stopLogStream();
    this.logController = this.apiClient.stream(
      `${API_PATHS.AGENT_SESSIONS}/${sessionId}/logs`,
      { stream: true },
      (chunk: StreamChunk) => {
        if (chunk.content) {
          try {
            const entry = JSON.parse(chunk.content) as AgentLogEntry;
            onEntry(entry);
          } catch {
            onEntry({ timestamp: new Date().toISOString(), level: 'info', message: chunk.content, sessionId });
          }
        }
        if (chunk.done) {
          this.outputChannel.appendLine(`[Agents] Log stream ended for: ${sessionId}`);
        }
      },
      onError,
    );
  }

  stopLogStream(): void {
    if (this.logController) {
      this.logController.abort();
      this.logController = null;
    }
  }

  dispose(): void {
    this.stopLogStream();
  }
}
