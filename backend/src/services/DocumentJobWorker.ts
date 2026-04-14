import { FastifyInstance } from 'fastify';
import { AIProviderFactory, type Message } from '../modules/ai/providers.js';
import { DocumentJobQueue, type DocumentJob } from './DocumentJobQueue.js';
import { JobEventEmitter } from './JobEventEmitter.js';

const POLL_INTERVAL_MS = 1000;

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
    this.scheduleNext();
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

      const [insertResult] = await (this.fastify as any).db.execute(
        'INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?)',
        [job.conversationId, 'assistant', responseContent, true, job.model, job.providerName]
      );
      const newMessageId = (insertResult as any).insertId;

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
        messageId: newMessageId,
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
