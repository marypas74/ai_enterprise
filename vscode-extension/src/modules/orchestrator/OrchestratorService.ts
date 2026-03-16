import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { ConfigService } from '../../core/ConfigService';
import type { EventBus } from '../../core/EventBus';
import type { OrchestratorStatus, StreamChunk } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class OrchestratorService {
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private sseController: AbortController | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async getStatus(): Promise<OrchestratorStatus> {
    const status = await this.apiClient.get<OrchestratorStatus>(API_PATHS.ORCHESTRATOR_STATUS);
    this.eventBus.emit('orchestrator:update', {
      activeSlots: status.activeSlots,
      totalSlots: status.totalSlots,
    });
    this.outputChannel.appendLine(
      `[Orchestrator] Status: ${status.activeSlots}/${status.totalSlots} slots`,
    );
    return status;
  }

  startPolling(): void {
    this.stopPolling();
    const interval = this.configService.getOrchestratorPollingInterval();
    this.fetchStatusSafe();
    this.pollingTimer = setInterval(() => {
      this.fetchStatusSafe();
    }, interval);
  }

  stopPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  startEventStream(
    onUpdate: (status: OrchestratorStatus) => void,
    onError: (error: Error) => void,
  ): void {
    this.stopEventStream();
    this.sseController = this.apiClient.stream(
      API_PATHS.ORCHESTRATOR_EVENTS,
      { stream: true },
      (chunk: StreamChunk) => {
        if (chunk.content) {
          try {
            const status = JSON.parse(chunk.content) as OrchestratorStatus;
            this.eventBus.emit('orchestrator:update', {
              activeSlots: status.activeSlots,
              totalSlots: status.totalSlots,
            });
            onUpdate(status);
          } catch {
            this.outputChannel.appendLine('[Orchestrator] Malformed SSE chunk');
          }
        }
      },
      onError,
    );
    this.outputChannel.appendLine('[Orchestrator] SSE stream started');
  }

  stopEventStream(): void {
    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
      this.outputChannel.appendLine('[Orchestrator] SSE stream stopped');
    }
  }

  async releaseSlot(slotId: number): Promise<void> {
    await this.apiClient.post(`${API_PATHS.ORCHESTRATOR_SLOT_RELEASE}/${slotId}/release`);
    this.outputChannel.appendLine(`[Orchestrator] Slot ${slotId} released`);
  }

  async terminateSession(sessionId: string): Promise<void> {
    await this.apiClient.post(`${API_PATHS.AGENT_SESSIONS}/${sessionId}/cancel`);
    this.outputChannel.appendLine(`[Orchestrator] Session ${sessionId} terminated`);
  }

  dispose(): void {
    this.stopPolling();
    this.stopEventStream();
  }

  private fetchStatusSafe(): void {
    this.getStatus().catch((error) => {
      this.outputChannel.appendLine(
        `[Orchestrator] Polling error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
