import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { AIModel, Conversation, StreamChunk } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

export class ChatService {
  private currentController: AbortController | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async loadModels(): Promise<AIModel[]> {
    const models = await this.apiClient.get<AIModel[]>(API_PATHS.MODELS);
    this.eventBus.emit('models:loaded', { models });
    this.outputChannel.appendLine(`[Chat] Loaded ${models.length} models`);
    return models;
  }

  async loadConversations(): Promise<Conversation[]> {
    return this.apiClient.get<Conversation[]>(API_PATHS.CONVERSATIONS);
  }

  async deleteConversation(id: number): Promise<void> {
    await this.apiClient.delete(`${API_PATHS.CONVERSATIONS}/${id}`);
  }

  sendMessage(
    message: string,
    modelId: string,
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    conversationId?: number,
  ): void {
    this.abortCurrentRequest();

    this.currentController = this.apiClient.stream(
      API_PATHS.COMPLETIONS,
      {
        message,
        model: modelId,
        ...(conversationId ? { conversationId } : {}),
        stream: true,
      },
      onChunk,
      onError,
    );
  }

  abortCurrentRequest(): void {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
  }
}
