import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentJobQueue, type DocumentJob } from './DocumentJobQueue.js';

function makeRedisMock() {
  const store: Record<string, Record<string, string>> = {};
  const lists: Record<string, string[]> = {};
  return {
    hset: vi.fn(async (key: string, fields: Record<string, string>) => {
      store[key] = { ...(store[key] || {}), ...fields };
    }),
    hgetall: vi.fn(async (key: string) => store[key] ?? null),
    rpush: vi.fn(async (key: string, value: string) => {
      lists[key] = [...(lists[key] || []), value];
    }),
    lpop: vi.fn(async (key: string) => {
      if (!lists[key] || lists[key].length === 0) return null;
      const [first, ...rest] = lists[key];
      lists[key] = rest;
      return first;
    }),
    llen: vi.fn(async (key: string) => (lists[key] || []).length),
    expire: vi.fn(async () => 1),
  };
}

describe('DocumentJobQueue', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let queue: DocumentJobQueue;

  beforeEach(() => {
    redis = makeRedisMock();
    queue = new DocumentJobQueue(redis as any);
  });

  it('enqueue stores job in Redis and pushes jobId to list', async () => {
    const { jobId, eta } = await queue.enqueue({
      userId: 1,
      conversationId: 42,
      placeholderMessageId: 99,
      model: 'qwen25vl:32b',
      providerName: 'ollama',
      messagesJson: '[{"role":"user","content":"test"}]',
      estimatedTokens: 9000,
    });
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(eta).toBeGreaterThan(0);
    expect(redis.rpush).toHaveBeenCalledWith('doc:jobs', jobId);
    expect(redis.hset).toHaveBeenCalledWith(
      `doc:job:${jobId}`,
      expect.objectContaining({ userId: '1', status: 'pending' })
    );
  });

  it('dequeue returns null when queue is empty', async () => {
    const result = await queue.dequeue();
    expect(result).toBeNull();
  });

  it('dequeue returns job when queue has items', async () => {
    await queue.enqueue({
      userId: 1, conversationId: 42, placeholderMessageId: 99,
      model: 'qwen25vl:32b', providerName: 'ollama',
      messagesJson: '[]', estimatedTokens: 9000,
    });
    const job = await queue.dequeue();
    expect(job).not.toBeNull();
    expect(job!.userId).toBe(1);
    expect(job!.status).toBe('pending');
  });

  it('updateStatus changes job status', async () => {
    const { jobId } = await queue.enqueue({
      userId: 1, conversationId: 42, placeholderMessageId: 99,
      model: 'qwen25vl:32b', providerName: 'ollama',
      messagesJson: '[]', estimatedTokens: 9000,
    });
    await queue.updateStatus(jobId, 'processing');
    expect(redis.hset).toHaveBeenCalledWith(
      `doc:job:${jobId}`,
      expect.objectContaining({ status: 'processing' })
    );
  });

  it('calcEta returns default when no metrics exist', async () => {
    const eta = await queue.calcEta(10000);
    expect(eta).toBeGreaterThan(0);
    expect(typeof eta).toBe('number');
  });
});
