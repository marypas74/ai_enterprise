import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../../src/modules/chat/ChatService';
import { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

describe('ChatService', () => {
  let chatService: ChatService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn().mockReturnValue({ abort: vi.fn() }),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    chatService = new ChatService(apiClient, eventBus, outputChannel);
  });

  it('should fetch models from backend', async () => {
    const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(models);

    const result = await chatService.loadModels();
    expect(result).toEqual(models);
  });

  it('should emit models:loaded after fetching', async () => {
    const listener = vi.fn();
    eventBus.on('models:loaded', listener);
    const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(models);

    await chatService.loadModels();
    expect(listener).toHaveBeenCalledWith({ models });
  });

  it('should fetch conversations', async () => {
    const convos = [{ id: 1, title: 'Test', modelId: 'gpt-4o', createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(convos);

    const result = await chatService.loadConversations();
    expect(result).toEqual(convos);
  });

  it('should start streaming message', () => {
    const onChunk = vi.fn();
    const onError = vi.fn();
    chatService.sendMessage('Hello', 'gpt-4o', onChunk, onError);
    expect(apiClient.stream).toHaveBeenCalled();
  });

  it('should abort active stream', () => {
    const abortFn = vi.fn();
    (apiClient.stream as ReturnType<typeof vi.fn>).mockReturnValue({ abort: abortFn });
    chatService.sendMessage('Hello', 'gpt-4o', vi.fn(), vi.fn());
    chatService.abortCurrentRequest();
    expect(abortFn).toHaveBeenCalled();
  });
});
