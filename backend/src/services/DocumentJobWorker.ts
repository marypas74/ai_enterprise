import { FastifyInstance } from 'fastify';
import { AIProviderFactory, type Message } from '../modules/ai/providers.js';
import { DocumentJobQueue, type DocumentJob } from './DocumentJobQueue.js';
import { JobEventEmitter } from './JobEventEmitter.js';

const POLL_INTERVAL_MS = 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VLLM_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3000;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    this.recoverStaleJobs().then(() => this.scheduleNext()).catch((err: any) => {
      this.fastify.log.error(`[JobWorker] recoverStaleJobs failed: ${err.message}`);
      this.scheduleNext();
    });
  }

  /** C3: Reset jobs stuck in "processing" for more than STALE_THRESHOLD_MS. */
  private async recoverStaleJobs(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

      // Try primary provider up to MAX_VLLM_ATTEMPTS times
      let result: { content: string | null } | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_VLLM_ATTEMPTS; attempt++) {
        try {
          result = await provider.complete({ messages, model: job.model, maxTokens: 4096 });
          lastError = null;
          break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (err: any) {
          lastError = err;
          this.fastify.log.warn(
            `[JobWorker] Job ${job.id} attempt ${attempt}/${MAX_VLLM_ATTEMPTS} failed: ${err.message}`
          );
          if (attempt < MAX_VLLM_ATTEMPTS) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }

      // If primary provider failed both attempts, try external API fallback
      if (lastError) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const [extRows]: any[] = await (this.fastify as any).db.execute(
          `SELECT m.model_id, p.provider_type
           FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
           WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE
             AND m.model_type IN ('chat','completion')
             AND p.provider_type IN ('openai','anthropic','google')
           ORDER BY m.sort_order ASC LIMIT 1`
        );
        const externalModel = extRows?.[0];

        if (!externalModel) {
          // No external fallback available — propagate original error
          throw lastError;
        }

        // Warn the user BEFORE starting the external API call
        JobEventEmitter.emitJobProviderWarning({
          jobId: job.id,
          userId: job.userId,
          conversationId: job.conversationId,
          messageId: job.placeholderMessageId,
          warningMessage: `⚠️ Il modello locale non è disponibile al momento. L'elaborazione continua tramite ${externalModel.provider_type.toUpperCase()}.`,
          fallbackProvider: externalModel.provider_type,
        });

        // Update placeholder in DB so the warning is also visible after page reload
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        await (this.fastify as any).db.execute(
          'UPDATE messages SET content = ? WHERE id = ?',
          [
            `⚠️ vLLM temporaneamente saturo — elaborazione in corso tramite ${externalModel.provider_type.toUpperCase()}...`,
            job.placeholderMessageId,
          ]
        );

        // Brief pause so the WS event reaches the client before the response starts
        await new Promise(r => setTimeout(r, 500));

        this.fastify.log.warn(
          `[JobWorker] Job ${job.id} falling back to external provider: ${externalModel.model_id}`
        );
        const fallbackProvider = AIProviderFactory.getProvider(externalModel.model_id);
        result = await fallbackProvider.complete({
          messages,
          model: externalModel.model_id,
          maxTokens: 4096,
        });

        // Use the fallback model/provider for the stored response
        job = { ...job, model: externalModel.model_id, providerName: externalModel.provider_type };
      }

      const responseContent = result!.content ?? 'Nessuna risposta generata.';

      // C4: Replace the placeholder message in-place instead of inserting a new one
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      await (this.fastify as any).db.execute(
        'UPDATE messages SET content = ?, is_ai_generated = ?, ai_model = ?, ai_provider = ?, updated_at = NOW() WHERE id = ?',
        [responseContent, true, job.model, job.providerName, job.placeholderMessageId]
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
