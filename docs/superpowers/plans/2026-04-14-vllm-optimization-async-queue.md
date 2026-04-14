# vLLM Optimization + Async Document Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare il cpu-offload di vLLM per abbassare il TTFT, e aggiungere una coda asincrona Redis per documenti >8K token con badge/notifica nel frontend.

**Architecture:** (1) Modifiche docker-compose vLLM: rimozione `--cpu-offload-gb`, riduzione `max-model-len` a 64K, aggiunta `--enable-chunked-prefill`. (2) Backend: `tokenEstimator` → `DocumentJobQueue` (Redis) → `DocumentJobWorker` (background) → injection in `completions.ts`. (3) Frontend: Zustand store + WS hook + `AsyncJobBadge` nel header di `ChatPage`.

**Tech Stack:** vLLM 0.18.x, Docker Compose, Redis (ioredis via `@fastify/redis`), Fastify 5, TypeScript, Vitest, React 18, Zustand, WebSocket (`@fastify/websocket`).

---

## File Map

### Nuovi file

| File | Responsabilità |
|------|----------------|
| `backend/src/utils/tokenEstimator.ts` | Stima token da array `Message[]` (testo + immagini) |
| `backend/src/utils/tokenEstimator.test.ts` | Test unit |
| `backend/src/services/DocumentJobQueue.ts` | Operazioni Redis: enqueue, dequeue, getJob, updateStatus, calcEta, updateMetrics |
| `backend/src/services/DocumentJobQueue.test.ts` | Test con mock Redis |
| `backend/src/services/JobEventEmitter.ts` | Singleton EventEmitter per WS job notifications (pattern AgentEventEmitter) |
| `backend/src/services/DocumentJobWorker.ts` | Worker loop: pop Redis → chiama AI → salva in DB → emette WS event |
| `backend/src/services/DocumentJobWorker.test.ts` | Test worker con mock |
| `frontend/src/stores/useJobStore.ts` | Zustand store: lista job pendenti con ETA |
| `frontend/src/hooks/useJobNotifications.ts` | Hook WebSocket → aggiorna useJobStore |
| `frontend/src/components/AsyncJobBadge.tsx` | Badge header con contatore + ETA |

### File modificati

| File | Modifica |
|------|---------|
| `/home/marcello/vllm/docker-compose.yml` | Rimuove cpu-offload, abbassa max-model-len, aggiunge chunked-prefill |
| `backend/src/modules/chat/completions.ts` | Inject token check dopo `ensureItalianSystemPrompt`, prima di `reply.hijack()` |
| `backend/src/modules/chat/routes.ts` | Aggiunge `GET /jobs/:jobId` |
| `backend/src/index.ts` | Avvia `DocumentJobWorker`, aggiunge WS endpoint `/ws/jobs` |
| `frontend/src/pages/ChatPage.tsx` | Import badge + hook, aggiunge `<AsyncJobBadge>` nell'header |

---

## Task 1: Ottimizzazione vLLM docker-compose

**Files:**
- Modify: `/home/marcello/vllm/docker-compose.yml`

> Questo task è indipendente dagli altri. Può essere deployato subito senza toccare il backend.

- [ ] **Step 1: Modifica docker-compose**

Apri `/home/marcello/vllm/docker-compose.yml`. Trova il blocco `command:` del servizio `vllm` e sostituisci le righe indicate:

```yaml
    command:
      - ${VLLM_MODEL:-Qwen/Qwen2.5-VL-32B-Instruct-AWQ}
      - --dtype=bfloat16
      - --quantization=awq_marlin
      - --gpu-memory-utilization=${GPU_MEM_UTIL:-0.88}
      - --max-model-len=${MAX_MODEL_LEN:-65536}
      - --kv-cache-dtype=fp8
      - --tensor-parallel-size=1
      - --host=0.0.0.0
      - --port=8000
      - --api-key=${VLLM_API_KEY:-vllm-local-2026}
      - --served-model-name=${SERVED_MODEL_NAME:-qwen25vl:32b}
      - --enable-prefix-caching
      - --enable-chunked-prefill
      - --max-num-batched-tokens=2048
      - --max-num-seqs=8
      - '--limit-mm-per-prompt={"image": 50}'
      - --mm-processor-kwargs={"max_pixels":1003520}
```

Rimosse: `--cpu-offload-gb=20`.
Cambiate: `--gpu-memory-utilization` da 0.92 a 0.88, `--max-model-len` da 131072 a 65536.
Aggiunte: `--enable-chunked-prefill`, `--max-num-batched-tokens=2048`, `--max-num-seqs=8`.

- [ ] **Step 2: Riavvia vLLM**

```bash
cd /home/marcello/vllm
docker compose up -d vllm
```

Attendi che il container sia healthy (il modello impiega ~10 minuti a caricarsi):

```bash
docker compose logs -f vllm 2>&1 | grep -E "startup|ready|error|Uvicorn" | head -5
# Atteso: "Uvicorn running on http://0.0.0.0:8000"
```

- [ ] **Step 3: Verifica**

```bash
curl -s http://localhost:8087/v1/models \
  -H "Authorization: Bearer vllm-local-2026" | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK:', d['data'][0]['id'])"
# Atteso: OK: qwen25vl:32b
```

- [ ] **Step 4: Commit**

```bash
cd /home/marcello/vllm
git add docker-compose.yml
git commit -m "perf(vllm): remove cpu-offload, reduce max-model-len to 64K, enable chunked-prefill"
```

---

## Task 2: Token Estimator

**Files:**
- Create: `backend/src/utils/tokenEstimator.ts`
- Create: `backend/src/utils/tokenEstimator.test.ts`

- [ ] **Step 1: Scrivi il test**

Crea `backend/src/utils/tokenEstimator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { estimateMessageTokens, ASYNC_TOKEN_THRESHOLD } from './tokenEstimator.js';
import type { Message } from '../modules/ai/providers.js';

describe('estimateMessageTokens', () => {
  it('estimates text-only messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello world' },
    ];
    // 17 chars system + 11 chars user = 28 chars / 4 ≈ 7 tokens
    expect(estimateMessageTokens(messages)).toBe(7);
  });

  it('estimates multipart messages with image_url', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(100) } },
        ] as any,
      },
    ];
    // text: 22 chars / 4 = 5 tokens; image: 100 chars base64 → decoded 75 bytes = single image → 1000 default tokens
    const result = estimateMessageTokens(messages);
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(2000);
  });

  it('returns 0 for empty messages array', () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it('ASYNC_TOKEN_THRESHOLD is 8000', () => {
    expect(ASYNC_TOKEN_THRESHOLD).toBe(8000);
  });

  it('correctly identifies large document over threshold', () => {
    // 40000 chars / 4 = 10000 tokens > 8000 threshold
    const messages: Message[] = [
      { role: 'user', content: 'A'.repeat(40000) },
    ];
    expect(estimateMessageTokens(messages)).toBeGreaterThan(ASYNC_TOKEN_THRESHOLD);
  });

  it('correctly identifies small message under threshold', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Summarize this in one line.' },
    ];
    expect(estimateMessageTokens(messages)).toBeLessThan(ASYNC_TOKEN_THRESHOLD);
  });
});
```

- [ ] **Step 2: Esegui il test — deve fallire**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/utils/tokenEstimator.test.ts 2>&1 | tail -5
# Atteso: FAIL — "Cannot find module './tokenEstimator.js'"
```

- [ ] **Step 3: Implementa**

Crea `backend/src/utils/tokenEstimator.ts`:

```typescript
import type { Message } from '../modules/ai/providers.js';

export const ASYNC_TOKEN_THRESHOLD = 8000;

/**
 * Stima il numero di token in un array di messaggi.
 * Testo: chars / 4 (approssimazione standard).
 * Immagini base64: dimensione decoded / 560 (formula Qwen2.5-VL).
 * Immagini senza dimensioni: 1000 token default.
 */
export function estimateMessageTokens(messages: Message[]): number {
  let total = 0;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as any[]) {
        if (part.type === 'text' && typeof part.text === 'string') {
          total += Math.ceil(part.text.length / 4);
        } else if (part.type === 'image_url') {
          total += estimateImageTokens(part.image_url?.url ?? '');
        }
      }
    }
  }

  return total;
}

function estimateImageTokens(url: string): number {
  if (!url) return 1000;

  // base64 data URL: stima da dimensione encoded
  const base64Match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (base64Match) {
    const base64Data = base64Match[1];
    // base64 → bytes: length * 0.75; poi token per Qwen2.5-VL: bytes / 560
    const estimatedBytes = base64Data.length * 0.75;
    const tokens = Math.ceil(estimatedBytes / 560);
    return Math.max(tokens, 64); // minimo 64 token per immagine
  }

  // URL esterno senza dimensioni note: default conservativo
  return 1000;
}
```

- [ ] **Step 4: Esegui il test — deve passare**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/utils/tokenEstimator.test.ts 2>&1 | tail -5
# Atteso: PASS — 6 tests
```

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/utils/tokenEstimator.ts backend/src/utils/tokenEstimator.test.ts
git commit -m "feat(utils): add tokenEstimator for async job threshold detection"
```

---

## Task 3: DocumentJobQueue

**Files:**
- Create: `backend/src/services/DocumentJobQueue.ts`
- Create: `backend/src/services/DocumentJobQueue.test.ts`

- [ ] **Step 1: Scrivi il test**

Crea `backend/src/services/DocumentJobQueue.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentJobQueue, type DocumentJob } from './DocumentJobQueue.js';

// Mock Redis client
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

    expect(jobId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
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
```

- [ ] **Step 2: Esegui il test — deve fallire**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/DocumentJobQueue.test.ts 2>&1 | tail -5
# Atteso: FAIL — "Cannot find module './DocumentJobQueue.js'"
```

- [ ] **Step 3: Implementa**

Crea `backend/src/services/DocumentJobQueue.ts`:

```typescript
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
const JOB_TTL_SECONDS = 86400; // 24h
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
    // Exponential moving average (alpha=0.3)
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
```

- [ ] **Step 4: Esegui il test — deve passare**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/DocumentJobQueue.test.ts 2>&1 | tail -5
# Atteso: PASS — 5 tests
```

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/DocumentJobQueue.ts backend/src/services/DocumentJobQueue.test.ts
git commit -m "feat(services): add DocumentJobQueue for async document processing"
```

---

## Task 4: JobEventEmitter

**Files:**
- Create: `backend/src/services/JobEventEmitter.ts`

> No test dedicato — segue esattamente il pattern di `AgentEventEmitter.ts` già testato in produzione.

- [ ] **Step 1: Implementa**

Crea `backend/src/services/JobEventEmitter.ts`:

```typescript
import { EventEmitter } from 'events';

export interface JobEvent {
  type: 'job_complete' | 'job_error';
  jobId: string;
  userId: number;
  conversationId: number;
  messageId?: number;
  etaSeconds?: number;
  errorMessage?: string;
  timestamp: Date;
}

class JobEventEmitterClass extends EventEmitter {
  private static instance: JobEventEmitterClass;
  private userSubscribers: Map<number, Set<(event: JobEvent) => void>> = new Map();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): JobEventEmitterClass {
    if (!JobEventEmitterClass.instance) {
      JobEventEmitterClass.instance = new JobEventEmitterClass();
    }
    return JobEventEmitterClass.instance;
  }

  public subscribeToUser(userId: number, callback: (event: JobEvent) => void): () => void {
    if (!this.userSubscribers.has(userId)) {
      this.userSubscribers.set(userId, new Set());
    }
    this.userSubscribers.get(userId)!.add(callback);

    return () => {
      const subscribers = this.userSubscribers.get(userId);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          this.userSubscribers.delete(userId);
        }
      }
    };
  }

  public emitJobComplete(event: Omit<JobEvent, 'type' | 'timestamp'>): void {
    const fullEvent: JobEvent = { ...event, type: 'job_complete', timestamp: new Date() };
    this.notifyUser(fullEvent);
  }

  public emitJobError(event: Omit<JobEvent, 'type' | 'timestamp'>): void {
    const fullEvent: JobEvent = { ...event, type: 'job_error', timestamp: new Date() };
    this.notifyUser(fullEvent);
  }

  private notifyUser(event: JobEvent): void {
    const subscribers = this.userSubscribers.get(event.userId);
    if (subscribers) {
      subscribers.forEach(callback => {
        try { callback(event); }
        catch (err) { /* subscriber error must not crash worker */ }
      });
    }
  }
}

export const JobEventEmitter = JobEventEmitterClass.getInstance();
```

- [ ] **Step 2: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/JobEventEmitter.ts
git commit -m "feat(services): add JobEventEmitter for async job WS notifications"
```

---

## Task 5: DocumentJobWorker

**Files:**
- Create: `backend/src/services/DocumentJobWorker.ts`
- Create: `backend/src/services/DocumentJobWorker.test.ts`

- [ ] **Step 1: Scrivi il test**

Crea `backend/src/services/DocumentJobWorker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentJobWorker } from './DocumentJobWorker.js';
import { DocumentJobQueue } from './DocumentJobQueue.js';
import { JobEventEmitter } from './JobEventEmitter.js';

// Minimal Fastify mock
function makeFastifyMock(dequeueResult: any = null) {
  const insertedMessages: any[] = [];
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    redis: {},
    db: {
      execute: vi.fn().mockResolvedValue([{ insertId: 101 }]),
    },
    _inserted: insertedMessages,
  };
}

describe('DocumentJobWorker', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitSpy = vi.spyOn(JobEventEmitter, 'emitJobComplete');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates instance without throwing', () => {
    const fastify = makeFastifyMock();
    const queue = { dequeue: vi.fn().mockResolvedValue(null) } as any;
    expect(() => new DocumentJobWorker(fastify as any, queue)).not.toThrow();
  });

  it('processJob saves response message and emits job_complete', async () => {
    const fastify = makeFastifyMock();
    const queue = {
      dequeue: vi.fn().mockResolvedValue(null),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateMetrics: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockProvider = {
      complete: vi.fn().mockResolvedValue({ content: 'La risposta del documento.' }),
    };
    vi.mock('../modules/ai/providers.js', () => ({
      AIProviderFactory: {
        getProvider: vi.fn(() => mockProvider),
      },
      calculateCost: vi.fn(() => 0),
    }));

    const worker = new DocumentJobWorker(fastify as any, queue);

    const job = {
      id: 'test-uuid',
      userId: 1,
      conversationId: 42,
      placeholderMessageId: 99,
      model: 'qwen25vl:32b',
      providerName: 'ollama',
      messagesJson: JSON.stringify([{ role: 'user', content: 'Summarize this doc.' }]),
      estimatedTokens: 10000,
      etaSeconds: 200,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };

    await worker.processJob(job);

    expect(fastify.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      expect.arrayContaining([42, 'assistant'])
    );
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'test-uuid',
      userId: 1,
      conversationId: 42,
    }));
  });
});
```

- [ ] **Step 2: Esegui il test — deve fallire**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/DocumentJobWorker.test.ts 2>&1 | tail -5
# Atteso: FAIL — "Cannot find module './DocumentJobWorker.js'"
```

- [ ] **Step 3: Implementa**

Crea `backend/src/services/DocumentJobWorker.ts`:

```typescript
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

      // Save response as new message in conversation
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
```

- [ ] **Step 4: Esegui il test — deve passare**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/DocumentJobWorker.test.ts 2>&1 | tail -10
# Atteso: PASS — 2 tests
```

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/DocumentJobWorker.ts backend/src/services/DocumentJobWorker.test.ts
git commit -m "feat(services): add DocumentJobWorker for background async document processing"
```

---

## Task 6: Integrazione in completions.ts

**Files:**
- Modify: `backend/src/modules/chat/completions.ts`

L'injection avviene DOPO `ensureItalianSystemPrompt(messages);` (riga ~419) e PRIMA di `reply.hijack()` (riga ~422).

- [ ] **Step 1: Aggiungi gli import in cima a completions.ts**

Trova le righe degli import esistenti (righe 1-28) e aggiungi dopo l'ultimo import:

```typescript
import { estimateMessageTokens, ASYNC_TOKEN_THRESHOLD } from '../../utils/tokenEstimator.js';
import { DocumentJobQueue } from '../../services/DocumentJobQueue.js';
```

- [ ] **Step 2: Aggiungi il blocco async dopo `ensureItalianSystemPrompt`**

Trova la riga `ensureItalianSystemPrompt(messages);` e aggiungi subito dopo:

```typescript
      ensureItalianSystemPrompt(messages);

      // ── Async document queue: intercept large requests ──────────────
      const estimatedTokens = estimateMessageTokens(messages);
      if (estimatedTokens > ASYNC_TOKEN_THRESHOLD) {
        const redis = (fastify as any).redis;
        const jobQueue = new DocumentJobQueue(redis);

        // Save placeholder assistant message
        const placeholderContent = '⏳ Documento ricevuto — elaborazione in corso...';
        const [placeholderInsert] = await fastify.db.execute(
          'INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?)',
          [conversationId, 'assistant', placeholderContent, false, body.model, providerName]
        );
        const placeholderMessageId = (placeholderInsert as any).insertId;

        const { jobId, eta } = await jobQueue.enqueue({
          userId: user.id,
          conversationId,
          placeholderMessageId,
          model: body.model,
          providerName,
          messagesJson: JSON.stringify(messages),
          estimatedTokens,
        });

        const etaLabel = eta < 60
          ? `${eta} secondi`
          : `${Math.ceil(eta / 60)} minut${Math.ceil(eta / 60) === 1 ? 'o' : 'i'}`;

        // Return SSE-compatible response (frontend expects SSE format)
        reply.hijack();
        writeSseHeaders(reply, { conversationId, webSearchPerformed: false, model: body.model, providerName });
        const sseWrite = createSseWriter(reply);
        sendInitialSseEvents(sseWrite, { model: body.model, providerName, safetyResult, recalledVectorMemories });
        sseWrite(`data: ${JSON.stringify({
          job: { id: jobId, eta, estimatedTokens },
          content: `⏳ Documento ricevuto — elaborazione in corso, risposta attesa in circa ${etaLabel}.`,
          done: true,
          conversationId,
        })}\n\n`);
        fastify.log.info(`[Chat] Async job ${jobId} queued for user ${user.id}, eta=${eta}s, tokens=${estimatedTokens}`);
        return;
      }
      // ── End async queue check ────────────────────────────────────────
```

- [ ] **Step 3: Verifica compilazione TypeScript**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit 2>&1 | head -20
# Atteso: nessun errore
```

- [ ] **Step 4: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/modules/chat/completions.ts
git commit -m "feat(chat): intercept large requests (>8K tokens) and route to async job queue"
```

---

## Task 7: WS endpoint + Job status route

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/modules/chat/routes.ts`

- [ ] **Step 1: Aggiungi WS endpoint in index.ts**

Trova il blocco WebSocket in `backend/src/index.ts` (vicino a `fastify.get('/ws/orchestrator',...)`). Aggiungi DOPO l'endpoint `/ws/orchestrator`:

```typescript
    // WebSocket per job notifications (async document queue)
    fastify.get('/ws/jobs', { websocket: true }, async (socket, request) => {
      if (!(await authenticateWs(request))) {
        socket.send(JSON.stringify({ error: 'Unauthorized' }));
        socket.close();
        return;
      }

      const user = (request as any).user as { id: number };

      const { JobEventEmitter } = await import('./services/JobEventEmitter.js');
      const unsubscribe = JobEventEmitter.subscribeToUser(user.id, (event) => {
        try { socket.send(JSON.stringify(event)); }
        catch { unsubscribe(); }
      });

      socket.on('close', () => unsubscribe());
      socket.on('error', () => unsubscribe());
    });
```

- [ ] **Step 2: Avvia DocumentJobWorker in index.ts**

Trova il blocco dove viene avviato `syncWorker` (riga ~648). Aggiungi dopo `syncWorker.start()`:

```typescript
    let docJobWorker: import('./services/DocumentJobWorker.js').DocumentJobWorker | null = null;
    try {
      const { DocumentJobQueue } = await import('./services/DocumentJobQueue.js');
      const { DocumentJobWorker } = await import('./services/DocumentJobWorker.js');
      const redis = (fastify as any).redis;
      const queue = new DocumentJobQueue(redis);
      docJobWorker = new DocumentJobWorker(fastify, queue);
      docJobWorker.start();
    } catch (err: any) {
      fastify.log.warn(`[JobWorker] Could not initialize DocumentJobWorker: ${err.message}`);
    }
```

E nel blocco `gracefulShutdown`:

```typescript
      docJobWorker?.stop();
```

- [ ] **Step 3: Aggiungi GET /jobs/:jobId in routes.ts**

In `backend/src/modules/chat/routes.ts`, aggiungi dopo gli import esistenti:

```typescript
import { FastifyInstance } from 'fastify';
import { completionRoutes } from './completions.js';
import { conversationRoutes } from './conversations.js';
import { modelRoutes } from './models.js';
import { agenticRoutes } from './agentic.js';
import { voiceRoutes } from './voice.js';

export async function chatRoutes(fastify: FastifyInstance) {
  await fastify.register(completionRoutes);
  await fastify.register(conversationRoutes);
  await fastify.register(modelRoutes);
  await fastify.register(agenticRoutes);
  await fastify.register(voiceRoutes);

  // Async document job status
  fastify.get('/jobs/:jobId', {
    onRequest: [(fastify as any).authenticate],
    schema: { description: 'Get async document job status', tags: ['chat'] }
  }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { DocumentJobQueue } = await import('../../services/DocumentJobQueue.js');
    const redis = (fastify as any).redis;
    const queue = new DocumentJobQueue(redis);
    const job = await queue.getJob(jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const user = (request as any).user as { id: number };
    if (job.userId !== user.id) return reply.status(403).send({ error: 'Forbidden' });

    return reply.send({
      jobId: job.id,
      status: job.status,
      eta: job.etaSeconds,
      conversationId: job.conversationId,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      errorMessage: job.errorMessage,
    });
  });
}
```

- [ ] **Step 4: Verifica compilazione**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit 2>&1 | head -20
# Atteso: nessun errore
```

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/index.ts backend/src/modules/chat/routes.ts
git commit -m "feat(backend): add /ws/jobs WS endpoint, /api/chat/jobs/:jobId route, start DocumentJobWorker"
```

---

## Task 8: Frontend — useJobStore

**Files:**
- Create: `frontend/src/stores/useJobStore.ts`

- [ ] **Step 1: Implementa**

Crea `frontend/src/stores/useJobStore.ts`:

```typescript
import { create } from 'zustand';

export interface PendingJob {
  jobId: string;
  conversationId: number;
  etaSeconds: number;
  queuedAt: number; // Date.now() quando accodato
  estimatedTokens?: number;
}

interface JobStore {
  pendingJobs: PendingJob[];
  addJob: (job: PendingJob) => void;
  removeJob: (jobId: string) => void;
  getEtaRemaining: (jobId: string) => number; // secondi rimanenti
}

export const useJobStore = create<JobStore>((set, get) => ({
  pendingJobs: [],

  addJob: (job) =>
    set((state) => ({
      pendingJobs: [...state.pendingJobs.filter((j) => j.jobId !== job.jobId), job],
    })),

  removeJob: (jobId) =>
    set((state) => ({
      pendingJobs: state.pendingJobs.filter((j) => j.jobId !== jobId),
    })),

  getEtaRemaining: (jobId) => {
    const job = get().pendingJobs.find((j) => j.jobId === jobId);
    if (!job) return 0;
    const elapsed = Math.floor((Date.now() - job.queuedAt) / 1000);
    return Math.max(0, job.etaSeconds - elapsed);
  },
}));
```

- [ ] **Step 2: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add frontend/src/stores/useJobStore.ts
git commit -m "feat(frontend): add useJobStore for async document job tracking"
```

---

## Task 9: Frontend — useJobNotifications hook

**Files:**
- Create: `frontend/src/hooks/useJobNotifications.ts`

- [ ] **Step 1: Implementa**

Crea `frontend/src/hooks/useJobNotifications.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { useAuthStore } from './useAuthStore';
import { useJobStore } from '../stores/useJobStore';

/**
 * Connects to /ws/jobs WebSocket and updates useJobStore on job events.
 * Must be mounted once at app level (e.g. in ChatPage or App).
 */
export function useJobNotifications(
  onJobComplete?: (conversationId: number, messageId?: number) => void
) {
  const { accessToken, isAuthenticated } = useAuthStore();
  const { removeJob } = useJobStore();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/jobs?token=${encodeURIComponent(accessToken)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'job_complete') {
          removeJob(data.jobId);
          onJobComplete?.(data.conversationId, data.messageId);
        }

        if (data.type === 'job_error') {
          removeJob(data.jobId);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      // silently ignore — worker will retry on next page load
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isAuthenticated, accessToken]);
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add frontend/src/hooks/useJobNotifications.ts
git commit -m "feat(frontend): add useJobNotifications hook for WS job completion events"
```

---

## Task 10: Frontend — AsyncJobBadge + wiring in ChatPage

**Files:**
- Create: `frontend/src/components/AsyncJobBadge.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Crea AsyncJobBadge.tsx**

Crea `frontend/src/components/AsyncJobBadge.tsx`:

```typescript
import { Clock } from 'lucide-react';
import { useJobStore } from '../stores/useJobStore';

/**
 * Badge nel header che mostra quanti documenti sono in elaborazione asincrona.
 * Clic → mostra tooltip con ETA per ogni job.
 */
export function AsyncJobBadge() {
  const { pendingJobs, getEtaRemaining } = useJobStore();

  if (pendingJobs.length === 0) return null;

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                   bg-amber-50 dark:bg-amber-900/30
                   border border-amber-200 dark:border-amber-700
                   text-amber-700 dark:text-amber-300
                   text-xs font-medium
                   hover:bg-amber-100 dark:hover:bg-amber-900/50
                   transition-colors"
        title={`${pendingJobs.length} documento${pendingJobs.length > 1 ? 'i' : ''} in elaborazione`}
      >
        <Clock className="w-3 h-3 animate-pulse" />
        <span>{pendingJobs.length} in elaborazione</span>
      </button>

      {/* Dropdown tooltip con dettagli per ogni job */}
      <div
        className="absolute right-0 top-full mt-2 w-64 z-50
                   bg-white dark:bg-surface-800
                   border border-surface-200 dark:border-surface-700
                   rounded-lg shadow-lg p-3
                   hidden group-hover:block"
      >
        <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wide">
          Documenti in elaborazione
        </p>
        {pendingJobs.map((job) => {
          const remaining = getEtaRemaining(job.jobId);
          const label = remaining <= 0
            ? 'Quasi pronto...'
            : remaining < 60
            ? `~${remaining}s`
            : `~${Math.ceil(remaining / 60)} min`;
          return (
            <div key={job.jobId} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-surface-600 dark:text-surface-300 truncate max-w-[160px]">
                Conversazione #{job.conversationId}
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 ml-2 shrink-0">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modifica ChatPage.tsx — aggiungi import**

Trova il blocco degli import in `frontend/src/pages/ChatPage.tsx` (righe 1-44). Aggiungi:

```typescript
import { AsyncJobBadge } from '../components/AsyncJobBadge';
import { useJobStore } from '../stores/useJobStore';
import { useJobNotifications } from '../hooks/useJobNotifications';
```

- [ ] **Step 3: Modifica ChatPage.tsx — aggiungi hook e handler**

Trova dove vengono dichiarati gli altri hook (dopo riga 44, blocco `const conversations = ...`). Aggiungi:

```typescript
  const { addJob } = useJobStore();

  // Callback quando un job asincrono completa — ricarica i messaggi della conversazione
  const handleJobComplete = (conversationId: number) => {
    if (conversations.currentConversationId === conversationId) {
      chatMessages.reload?.();
    }
  };

  useJobNotifications(handleJobComplete);
```

- [ ] **Step 4: Modifica ChatPage.tsx — cattura jobId dalla risposta SSE**

Nel codice che processa gli eventi SSE in arrivo, cerca dove vengono processati i dati SSE (nel hook `useChatMessages` o nel `ChatPage`). Cerca `done: true` o il handler degli eventi SSE.

Trova la funzione/hook che chiama `/api/chat/completions` e processa la risposta SSE. Aggiungi handling del campo `job` nell'evento SSE:

```typescript
// Dove viene processato ogni evento SSE (cerca "done" o "content" nell'SSE handler)
// Aggiungi:
if (sseData.job) {
  addJob({
    jobId: sseData.job.id,
    conversationId: sseData.conversationId,
    etaSeconds: sseData.job.eta,
    queuedAt: Date.now(),
    estimatedTokens: sseData.job.estimatedTokens,
  });
}
```

Il parser SSE è in `frontend/src/services/api.ts` intorno alla riga 178. Trova:

```typescript
if (data.content) onChunk(data.content);
if (data.done) { onDone(data.conversationId || convId); return true; }
```

La firma della funzione che contiene questo codice passa `onChunk`, `onDone` come callback. Devi aggiungere un callback `onJob` (opzionale) e aggiornare i call site, OPPURE più semplicemente aggiungere il dispatch inline. La soluzione più semplice: aggiungi un callback opzionale `onJob` alla firma della funzione che chiama `/api/chat/completions` (cerca `function streamChat` o simile in `api.ts`). Poi aggiungi:

```typescript
if (data.content) onChunk(data.content);
if (data.job) onJob?.(data.job, data.conversationId);  // ADD THIS LINE
if (data.done) { onDone(data.conversationId || convId); return true; }
```

Dove `onJob` ha firma: `(job: { id: string; eta: number; estimatedTokens: number }, conversationId: number) => void`.

- [ ] **Step 5: Modifica ChatPage.tsx — aggiungi badge nell'header**

Trova l'header (riga ~225): `<header className="flex items-center justify-between...">`. Aggiungi `<AsyncJobBadge />` nella sezione destra dell'header, accanto agli altri pulsanti (cerca dove c'è il pulsante settings o il modello selector):

```tsx
{/* Nell'header, prima dei pulsanti esistenti nella sezione destra */}
<AsyncJobBadge />
```

- [ ] **Step 6: Verifica build frontend**

```bash
cd /home/marcello/enterprise-ai-chat/frontend
npm run build 2>&1 | tail -10
# Atteso: nessun errore TypeScript/build
```

- [ ] **Step 7: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add frontend/src/components/AsyncJobBadge.tsx \
        frontend/src/pages/ChatPage.tsx
git commit -m "feat(frontend): add AsyncJobBadge with job tracking and WS notifications"
```

---

## Task 11: Version bump 2.1.57 → 2.1.58

**Files:** Tutti i file di versione (vedi checklist completa in MEMORY.md)

- [ ] **Step 1: Aggiorna tutti i file di versione**

```bash
cd /home/marcello/enterprise-ai-chat

# Verifica versione attuale
grep -r "2\.1\.57" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v dist | grep -v package-lock | grep -v ".vsix"
```

Aggiorna ogni file trovato da `2.1.57` a `2.1.58`:

1. `backend/package.json` — `"version": "2.1.58"`
2. `frontend/package.json` — `"version": "2.1.58"`
3. `frontend/src/version.ts` — `export const APP_VERSION = '2.1.58'`
4. `frontend/src/pages/PublicMonitorPage.tsx` — versione nella stringa header
5. `vscode-extension/package.json` — `"version": "2.1.58"`
6. `vscode-extension/webview-ui/src/claude-code/MainLayout.tsx` — 2 occorrenze
7. `k8s/backend/deployment.yaml` — image tag
8. `k8s/frontend/deployment.yaml` — image tag
9. `k8s/kustomization.yaml` — `app.kubernetes.io/version`
10. `k8s/mariadb/init-configmap.yaml` — `app_version` seed value

- [ ] **Step 2: Verifica nessuna occorrenza rimasta**

```bash
grep -rn "2\.1\.57" . --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v dist | grep -v package-lock
# Atteso: nessun risultato
```

- [ ] **Step 3: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add -u
git commit -m "chore: bump version 2.1.57 → 2.1.58"
```

---

## Note finali

**Ordine di deploy:**
1. Task 1 (vLLM) — indipendente, può andare subito in produzione
2. Task 2-7 (backend) — commit separati, deploy backend una volta completati tutti
3. Task 8-10 (frontend) — deploy frontend separato
4. Task 11 (version bump) — come sempre, ultimo prima del build

**Test complessivo post-deploy:**
```bash
# Backend tests
cd backend && npx vitest run src/utils/tokenEstimator.test.ts src/services/DocumentJobQueue.test.ts src/services/DocumentJobWorker.test.ts

# Build check
npx tsc --noEmit

# Frontend build
cd ../frontend && npm run build
```
