import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentJobWorker } from './DocumentJobWorker.js';

// Hoist mock so AIProviderFactory is intercepted before any imports run
vi.mock('../modules/ai/AIProviderFactory.js', () => ({
  AIProviderFactory: {
    getProvider: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'job-1',
    userId: 1,
    conversationId: 42,
    placeholderMessageId: 99,
    model: 'qwen2.5vl:7b',
    providerName: 'ollama',
    messagesJson: JSON.stringify([{ role: 'user', content: 'Analyze this document.' }]),
    estimatedTokens: 1000,
    etaSeconds: 20,
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a minimal Redis mock that supports the operations used by
 * DocumentJobWorker (scan, hgetall, hset, lpush) and DocumentJobQueue
 * (hset, hgetall, rpush, lpop, llen, expire).
 */
function makeRedisMock() {
  const store: Record<string, Record<string, string>> = {};
  const lists: Record<string, string[]> = {};

  return {
    store,
    lists,
    hset: vi.fn(async (key: string, fields: Record<string, string> | string, value?: string) => {
      if (typeof fields === 'string' && value !== undefined) {
        // hset(key, field, value) form
        store[key] = { ...(store[key] ?? {}), [fields]: value };
      } else if (typeof fields === 'object') {
        store[key] = { ...(store[key] ?? {}), ...fields };
      }
    }),
    hgetall: vi.fn(async (key: string) => store[key] ?? null),
    rpush: vi.fn(async (key: string, value: string) => {
      lists[key] = [...(lists[key] ?? []), value];
    }),
    lpush: vi.fn(async (key: string, value: string) => {
      lists[key] = [value, ...(lists[key] ?? [])];
    }),
    lpop: vi.fn(async (key: string) => {
      if (!lists[key] || lists[key].length === 0) return null;
      const [first, ...rest] = lists[key];
      lists[key] = rest;
      return first;
    }),
    llen: vi.fn(async (key: string) => (lists[key] ?? []).length),
    expire: vi.fn(async () => 1),
    scan: vi.fn(async () => ['0', [] as string[]]),
  };
}

function makeDbMock() {
  return {
    execute: vi.fn(async () => [{ affectedRows: 1 }, []]),
  };
}

function makeProviderMock(content = 'AI response') {
  return {
    complete: vi.fn(async () => ({
      content,
      tokensInput: 100,
      tokensOutput: 50,
      model: 'qwen2.5vl:7b',
      provider: 'ollama',
    })),
  };
}

function makeFastify(redis: any, db: any) {
  return {
    redis,
    db,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentJobWorker', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let db: ReturnType<typeof makeDbMock>;
  let fastify: ReturnType<typeof makeFastify>;
  let providerMock: ReturnType<typeof makeProviderMock>;

  beforeEach(async () => {
    redis = makeRedisMock();
    db = makeDbMock();
    fastify = makeFastify(redis, db);
    providerMock = makeProviderMock();

    // Wire providerMock into the already-hoisted AIProviderFactory mock
    const { AIProviderFactory } = await import('../modules/ai/AIProviderFactory.js');
    (AIProviderFactory.getProvider as ReturnType<typeof vi.fn>).mockReturnValue(providerMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // C3 — stale job recovery
  // -------------------------------------------------------------------------

  describe('recoverStaleJobs (C3)', () => {
    it('resets stale processing jobs to pending and re-enqueues them', async () => {
      const staleStart = new Date(Date.now() - 15 * 60 * 1_000).toISOString(); // 15 min ago
      const staleJobKey = 'doc:job:stale-job-1';

      redis.store[staleJobKey] = {
        status: 'processing',
        startedAt: staleStart,
        userId: '1',
        conversationId: '42',
        placeholderMessageId: '99',
        model: 'qwen2.5vl:7b',
        providerName: 'ollama',
        messagesJson: '[]',
        estimatedTokens: '100',
        etaSeconds: '10',
        createdAt: new Date().toISOString(),
      };

      // SCAN returns the one stale key then stops
      redis.scan
        .mockResolvedValueOnce(['0', [staleJobKey]]);

      const worker = new DocumentJobWorker(fastify as any);
      // Access private method via type cast for testing
      await (worker as any).recoverStaleJobs();

      // Status should be reset to pending
      expect(redis.hset).toHaveBeenCalledWith(
        staleJobKey,
        expect.objectContaining({ status: 'pending', startedAt: '' }),
      );
      // Should be re-queued with LPUSH
      expect(redis.lpush).toHaveBeenCalledWith('doc:jobs', 'stale-job-1');
      expect(fastify.log.warn).toHaveBeenCalled();
    });

    it('does not touch recent processing jobs (started < 10 min ago)', async () => {
      const recentStart = new Date(Date.now() - 3 * 60 * 1_000).toISOString(); // 3 min ago
      const jobKey = 'doc:job:recent-job';

      redis.store[jobKey] = {
        status: 'processing',
        startedAt: recentStart,
      };

      redis.scan.mockResolvedValueOnce(['0', [jobKey]]);

      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).recoverStaleJobs();

      // hset should NOT have been called to reset this job
      const resetCalls = (redis.hset as any).mock.calls.filter(
        (call: any[]) => call[0] === jobKey,
      );
      expect(resetCalls).toHaveLength(0);
      expect(redis.lpush).not.toHaveBeenCalledWith('doc:jobs', 'recent-job');
    });

    it('skips jobs with status other than "processing"', async () => {
      const jobKey = 'doc:job:done-job';
      redis.store[jobKey] = {
        status: 'done',
        startedAt: new Date(Date.now() - 20 * 60 * 1_000).toISOString(),
      };

      redis.scan.mockResolvedValueOnce(['0', [jobKey]]);

      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).recoverStaleJobs();

      expect(redis.lpush).not.toHaveBeenCalled();
    });

    it('handles empty scan results gracefully', async () => {
      redis.scan.mockResolvedValueOnce(['0', []]);

      const worker = new DocumentJobWorker(fastify as any);
      await expect((worker as any).recoverStaleJobs()).resolves.not.toThrow();
    });

    it('iterates across multiple SCAN pages', async () => {
      const staleKey = 'doc:job:stale-paged';
      redis.store[staleKey] = {
        status: 'processing',
        startedAt: new Date(Date.now() - 20 * 60 * 1_000).toISOString(),
      };

      // First call returns non-zero cursor, second call returns '0'
      redis.scan
        .mockResolvedValueOnce(['42', []])
        .mockResolvedValueOnce(['0', [staleKey]]);

      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).recoverStaleJobs();

      expect(redis.lpush).toHaveBeenCalledWith('doc:jobs', 'stale-paged');
    });

    it('calls recoverStaleJobs before starting the poll loop', async () => {
      redis.scan.mockResolvedValueOnce(['0', []]);

      const worker = new DocumentJobWorker(fastify as any);
      const recoverSpy = vi.spyOn(worker as any, 'recoverStaleJobs');

      // Override scheduleNext to avoid actual timers
      vi.spyOn(worker as any, 'scheduleNext').mockImplementation(() => {
        worker.stop();
      });

      await worker.start();

      expect(recoverSpy).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // C4 — placeholder replacement
  // -------------------------------------------------------------------------

  describe('processJob (C4 — replace placeholder)', () => {
    it('UPDATEs the placeholder message instead of INSERTing a new row', async () => {
      // Seed a pending job in Redis
      const job = makeJob({ status: 'pending' });
      redis.store[`doc:job:${job.id}`] = {
        userId: String(job.userId),
        conversationId: String(job.conversationId),
        placeholderMessageId: String(job.placeholderMessageId),
        model: job.model,
        providerName: job.providerName,
        messagesJson: job.messagesJson,
        estimatedTokens: String(job.estimatedTokens),
        etaSeconds: String(job.etaSeconds),
        status: 'pending',
        createdAt: job.createdAt,
      };

      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).processJob(job);

      // db.execute should have been called with UPDATE messages SET content = ...
      const execCalls = (db.execute as any).mock.calls as any[][];
      const updateCall = execCalls.find(
        (call) => typeof call[0] === 'string' && call[0].startsWith('UPDATE messages SET content'),
      );

      expect(updateCall).toBeDefined();
      // The last param should be the placeholderMessageId
      const params = updateCall![1] as any[];
      expect(params[params.length - 1]).toBe(job.placeholderMessageId);
      // Content should be the AI response
      expect(params[0]).toBe('AI response');
    });

    it('marks job as done after successful processing', async () => {
      const job = makeJob();
      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).processJob(job);

      // Status should be updated to 'done'
      const hsetCalls = (redis.hset as any).mock.calls as any[][];
      const doneCall = hsetCalls.find(
        (call) => call[0] === `doc:job:${job.id}` &&
          ((call[1] as any)?.status === 'done' || call[2] === 'done'),
      );
      expect(doneCall).toBeDefined();
    });

    it('marks job as error when AI provider throws', async () => {
      const { AIProviderFactory } = await import('../modules/ai/AIProviderFactory.js');
      (AIProviderFactory.getProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        complete: vi.fn(async () => { throw new Error('provider timeout'); }),
      });

      const job = makeJob();
      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).processJob(job);

      const hsetCalls = (redis.hset as any).mock.calls as any[][];
      const errorCall = hsetCalls.find(
        (call) =>
          call[0] === `doc:job:${job.id}` &&
          ((call[1] as any)?.status === 'error'),
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![1] as any).errorMessage).toContain('provider timeout');
    });

    it('does NOT call INSERT INTO messages', async () => {
      const job = makeJob();
      const worker = new DocumentJobWorker(fastify as any);
      await (worker as any).processJob(job);

      const execCalls = (db.execute as any).mock.calls as any[][];
      const insertCall = execCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO messages'),
      );
      expect(insertCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('start / stop', () => {
    it('starts and stops without errors', async () => {
      redis.scan.mockResolvedValueOnce(['0', []]);

      const worker = new DocumentJobWorker(fastify as any);

      vi.spyOn(worker as any, 'scheduleNext').mockImplementation(() => {
        // do not schedule real timers
      });

      await worker.start();
      worker.stop();

      expect(fastify.log.info).toHaveBeenCalled();
    });
  });
});
