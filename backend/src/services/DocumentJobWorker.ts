import { FastifyInstance } from 'fastify';
import { AIProviderFactory, type Message } from '../modules/ai/providers.js';
import { DocumentJobQueue, type DocumentJob } from './DocumentJobQueue.js';
import { JobEventEmitter } from './JobEventEmitter.js';

const POLL_INTERVAL_MS = 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export class DocumentJobWorker {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly queue: DocumentJobQueue,
  ) {}

  start(): void {
    this.running = true;
    this.fastify.log.info('[JobWorker] Started');
    // C3: Recover stale jobs from previous crash before starting the poll loop
    this.recoverStaleJobs().then(() => this.scheduleNext()).catch((err: any) => {
      this.fastify.log.error(`[JobWorker] recoverStaleJobs failed: ${err.message}`);
      this.scheduleNext();
    });
  }

  /** C3: Reset jobs stuck in "processing" for more than STALE_THRESHOLD_MS. */
  private async recoverStaleJobs(): Promise<void> {
    const redis = (this.fastify as any).redis;
    const tenMinutesAgo = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    let cursor = '0';
    let recovered = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'doc:job:*', 'COUNT', '100') as [string, string[]];
      cursor = nextCursor;
      for (const key of keys) {
        const raw = await redis.hgetall(key) as Record<string, string>;
        if (!raw || Object.keys(raw).length === 0) continue;
        if (raw.status === 'processing' && raw.startedAt && raw.startedAt < tenMinutesAgo) {
          const jobId = key.replace('doc:job:', '');
          await redis.hset(key, { status: 'pending', startedAt: '' });
          await redis.lpush('doc:jobs', jobId);
          recovered++;
          this.fastify.log.warn({ jobId, startedAt: raw.startedAt }, '[JobWorker] Recovered stale job');
        }
      }
    } while (cursor !== '0');
    if (recovered > 0) this.fastify.log.info(`[JobWorker] Recovered ${recovered} stale job(s)`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.fastify.log.info('[JobWorker] Stopped');
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      const job = await this.queue.dequeue();
      if (job) {
        await this.processJob(job);
      }
    } catch (err: any) {
      this.fastify.log.error(`[JobWorker] Tick error: ${err.message}`);
    }
    this.scheduleNext();
  }

  async processJob(job: DocumentJob): Promise<void> {
    const startTime = Date.now();
    this.fastify.log.info(`[JobWorker] Processing job ${job.id} for user ${job.userId}`);

    await this.queue.updateStatus(job.id, 'processing', { startedAt: new Date().toISOString() });

    try {
      const messages: Message[] = JSON.parse(job.messagesJson);
      const provider = AIProviderFactory.getProvider(job.model);

      const result = await provider.complete(messages, {
        model: job.model,
        maxTokens: 4096,
      });

      const responseContent = result.content ?? 'Nessuna risposta generata.';

      // C4: Replace the placeholder message in-place instead of inserting a new one
      await (this.fastify as any).db.execute(
        'UPDATE messages SET content = ?, is_ai_generated = ?, ai_model = ?, ai_provider = ?, updated_at = NOW() WHERE id = ?',
        [responseContent, true, job.model, job.providerName, job.placeholderMessageId]
      );

      await (this.fastify as any).db.execute(
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [job.conversationId]
      );

      await this.queue.updateStatus(job.id, 'done', { completedAt: new Date().toISOString() });
      await this.queue.updateMetrics(job.estimatedTokens, Date.now() - startTime);

      JobEventEmitter.emitJobComplete({
        jobId: job.id,
        userId: job.userId,
        conversationId: job.conversationId,
        messageId: job.placeholderMessageId,
      });

      this.fastify.log.info(`[JobWorker] Job ${job.id} completed in ${Date.now() - startTime}ms`);
    } catch (err: any) {
      this.fastify.log.error(`[JobWorker] Job ${job.id} failed: ${err.message}`);
      await this.queue.updateStatus(job.id, 'error', {
        completedAt: new Date().toISOString(),
        errorMessage: err.message,
      });
      JobEventEmitter.emitJobError({
        jobId: job.id,
        userId: job.userId,
        conversationId: job.conversationId,
        errorMessage: err.message,
      });
    }
  }
}
