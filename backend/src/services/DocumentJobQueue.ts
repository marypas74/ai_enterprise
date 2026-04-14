import { randomUUID } from 'crypto';

export interface DocumentJob {
  id: string;
  userId: number;
  conversationId: number;
  placeholderMessageId: number;
  model: string;
  providerName: string;
  messagesJson: string;
  estimatedTokens: number;
  etaSeconds: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

interface EnqueueParams {
  userId: number;
  conversationId: number;
  placeholderMessageId: number;
  model: string;
  providerName: string;
  messagesJson: string;
  estimatedTokens: number;
}

const QUEUE_KEY = 'doc:jobs';
const JOB_KEY = (id: string) => `doc:job:${id}`;
const METRICS_KEY = 'doc:metrics';
const JOB_TTL_SECONDS = 86400;
const DEFAULT_TOKENS_PER_SEC = 50;

export class DocumentJobQueue {
  constructor(private readonly redis: any) {}

  async enqueue(params: EnqueueParams): Promise<{ jobId: string; eta: number }> {
    const jobId = randomUUID();
    const queueDepth = await this.redis.llen(QUEUE_KEY) as number;
    const eta = await this.calcEta(params.estimatedTokens, queueDepth + 1);

    const fields: Record<string, string> = {
      userId: String(params.userId),
      conversationId: String(params.conversationId),
      placeholderMessageId: String(params.placeholderMessageId),
      model: params.model,
      providerName: params.providerName,
      messagesJson: params.messagesJson,
      estimatedTokens: String(params.estimatedTokens),
      etaSeconds: String(eta),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await this.redis.hset(JOB_KEY(jobId), fields);
    await this.redis.expire(JOB_KEY(jobId), JOB_TTL_SECONDS);
    await this.redis.rpush(QUEUE_KEY, jobId);

    return { jobId, eta };
  }

  async dequeue(): Promise<DocumentJob | null> {
    const jobId = await this.redis.lpop(QUEUE_KEY) as string | null;
    if (!jobId) return null;
    const raw = await this.redis.hgetall(JOB_KEY(jobId)) as Record<string, string> | null;
    if (!raw) return null;
    return this.deserializeJob(jobId, raw);
  }

  async getJob(jobId: string): Promise<DocumentJob | null> {
    const raw = await this.redis.hgetall(JOB_KEY(jobId)) as Record<string, string> | null;
    if (!raw) return null;
    return this.deserializeJob(jobId, raw);
  }

  async updateStatus(
    jobId: string,
    status: DocumentJob['status'],
    extra: Partial<Pick<DocumentJob, 'startedAt' | 'completedAt' | 'errorMessage'>> = {}
  ): Promise<void> {
    const fields: Record<string, string> = { status };
    if (extra.startedAt) fields.startedAt = extra.startedAt;
    if (extra.completedAt) fields.completedAt = extra.completedAt;
    if (extra.errorMessage) fields.errorMessage = extra.errorMessage;
    await this.redis.hset(JOB_KEY(jobId), fields);
  }

  async updateMetrics(tokensProcessed: number, elapsedMs: number): Promise<void> {
    const tokensPerSec = tokensProcessed / (elapsedMs / 1000);
    const current = await this.redis.hgetall(METRICS_KEY) as Record<string, string> | null;
    const prevAvg = current?.avgTokensPerSec ? parseFloat(current.avgTokensPerSec) : DEFAULT_TOKENS_PER_SEC;
    const prevCount = current?.jobsCompleted ? parseInt(current.jobsCompleted, 10) : 0;
    const newAvg = prevCount === 0 ? tokensPerSec : 0.3 * tokensPerSec + 0.7 * prevAvg;
    await this.redis.hset(METRICS_KEY, {
      avgTokensPerSec: String(Math.round(newAvg)),
      jobsCompleted: String(prevCount + 1),
    });
  }

  async calcEta(estimatedTokens: number, queuePosition = 1): Promise<number> {
    const metrics = await this.redis.hgetall(METRICS_KEY) as Record<string, string> | null;
    const avgTps = metrics?.avgTokensPerSec ? parseFloat(metrics.avgTokensPerSec) : DEFAULT_TOKENS_PER_SEC;
    return Math.ceil((estimatedTokens / avgTps) * queuePosition);
  }

  private deserializeJob(id: string, raw: Record<string, string>): DocumentJob {
    return {
      id,
      userId: parseInt(raw.userId, 10),
      conversationId: parseInt(raw.conversationId, 10),
      placeholderMessageId: parseInt(raw.placeholderMessageId, 10),
      model: raw.model,
      providerName: raw.providerName,
      messagesJson: raw.messagesJson,
      estimatedTokens: parseInt(raw.estimatedTokens, 10),
      etaSeconds: parseInt(raw.etaSeconds, 10),
      status: raw.status as DocumentJob['status'],
      createdAt: raw.createdAt,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      errorMessage: raw.errorMessage,
    };
  }
}
