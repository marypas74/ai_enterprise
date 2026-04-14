/**
 * DocumentJobWorker — Background worker for async document processing jobs.
 *
 * Responsibilities:
 * - Poll the Redis queue (doc:jobs) for pending document jobs
 * - Process each job by calling the AI provider with the pre-built messages
 * - Update the placeholder message in the DB with the real assistant response (C4)
 * - Recover stale "processing" jobs on startup (at-least-once delivery) (C3)
 */

import type { FastifyInstance } from 'fastify';
import { DocumentJobQueue, type DocumentJob } from './DocumentJobQueue.js';
import { AIProviderFactory } from '../modules/ai/AIProviderFactory.js';
import { updateOne } from '../database/index.js';

const POLL_INTERVAL_MS = 2_000;
const STALE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes

export class DocumentJobWorker {
  private readonly queue: DocumentJobQueue;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly fastify: FastifyInstance) {
    this.queue = new DocumentJobQueue(fastify.redis);
  }

  /** Start the worker: recover stale jobs, then begin polling loop. */
  async start(): Promise<void> {
    this.running = true;
    this.fastify.log.info('[DocumentJobWorker] Starting');

    await this.recoverStaleJobs();

    this.scheduleNext();
  }

  /** Stop the polling loop gracefully. */
  stop(): void {
    this.running = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.fastify.log.info('[DocumentJobWorker] Stopped');
  }

  // ---------------------------------------------------------------------------
  // C3 — Stale job recovery
  // ---------------------------------------------------------------------------

  /**
   * Scan all doc:job:* keys in Redis.
   * Any job with status "processing" and startedAt > 10 min ago is reset to
   * "pending" and re-enqueued (LPUSH = high priority, processed first).
   */
  private async recoverStaleJobs(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    let cursor = '0';
    let recovered = 0;

    do {
      const [nextCursor, keys] = await this.fastify.redis.scan(
        cursor,
        'MATCH',
        'doc:job:*',
        'COUNT',
        '100',
      ) as [string, string[]];
      cursor = nextCursor;

      for (const key of keys) {
        const raw = await this.fastify.redis.hgetall(key) as Record<string, string> | null;
        if (!raw || Object.keys(raw).length === 0) continue;
        if (raw.status !== 'processing') continue;
        if (!raw.startedAt || raw.startedAt >= tenMinutesAgo) continue;

        const jobId = key.replace('doc:job:', '');
        this.fastify.log.warn({ jobId, startedAt: raw.startedAt }, '[DocumentJobWorker] Recovering stale job');

        await this.fastify.redis.hset(key, {
          status: 'pending',
          startedAt: '',
        });
        // LPUSH so stale-recovered jobs are processed before new arrivals
        await this.fastify.redis.lpush('doc:jobs', jobId);
        recovered++;
      }
    } while (cursor !== '0');

    if (recovered > 0) {
      this.fastify.log.info(`[DocumentJobWorker] Recovered ${recovered} stale job(s)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Polling loop
  // ---------------------------------------------------------------------------

  private scheduleNext(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    try {
      const job = await this.queue.dequeue();
      if (job) {
        await this.processJob(job);
      }
    } catch (err: any) {
      this.fastify.log.error({ err }, '[DocumentJobWorker] Poll error');
    } finally {
      this.scheduleNext();
    }
  }

  // ---------------------------------------------------------------------------
  // C4 — Job processing: UPDATE placeholder instead of INSERT
  // ---------------------------------------------------------------------------

  private async processJob(job: DocumentJob): Promise<void> {
    const startedAt = new Date().toISOString();
    await this.queue.updateStatus(job.id, 'processing', { startedAt });
    const startMs = Date.now();

    try {
      const messages = JSON.parse(job.messagesJson);
      const provider = AIProviderFactory.getProvider(
        job.model,
        job.providerName as any,
      );

      const result = await provider.complete({
        model: job.model,
        messages,
      });

      const assistantContent = result.content;
      const elapsedMs = Date.now() - startMs;

      // C4 — Replace the placeholder message instead of inserting a new one
      await updateOne(
        this.fastify.db,
        'UPDATE messages SET content = ?, is_ai_generated = TRUE, ai_model = ?, ai_provider = ?, tokens_input = ?, tokens_output = ?, updated_at = NOW() WHERE id = ?',
        [
          assistantContent,
          job.model,
          job.providerName,
          result.tokensInput,
          result.tokensOutput,
          job.placeholderMessageId,
        ],
      );

      await this.queue.updateStatus(job.id, 'done', {
        completedAt: new Date().toISOString(),
      });

      await this.queue.updateMetrics(result.tokensOutput, elapsedMs);

      this.fastify.log.info(
        { jobId: job.id, placeholderMessageId: job.placeholderMessageId, elapsedMs },
        '[DocumentJobWorker] Job completed',
      );
    } catch (err: any) {
      this.fastify.log.error({ jobId: job.id, err }, '[DocumentJobWorker] Job failed');
      await this.queue.updateStatus(job.id, 'error', {
        errorMessage: err?.message ?? 'unknown error',
      });
    }
  }
}
