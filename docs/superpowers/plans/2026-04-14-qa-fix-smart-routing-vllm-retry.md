# QA Fix: Smart Routing Audio Filter + vLLM Retry + Error Messages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs found in QA: (1) Smart Routing selects audio models for text chat, (2) vLLM 502 during cold-start causes immediate failure without retry, (3) 502 errors show a generic English message instead of a user-friendly Italian message.

**Architecture:** Three focused changes across the model routing layer, vLLM provider, and a new tiny utility module for stream error message mapping. Task 4 is operational (apply docker-compose change already on disk).

**Tech Stack:** TypeScript, Vitest, Fastify 5, OpenAI SDK (vLLM), mysql2/promise

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/services/ModelRouter.ts` | Modify | Add `export` to class + `AND m.model_id NOT LIKE '%audio%'` in SQL |
| `backend/src/modules/chat/completions.ts` | Modify | Same audio filter in fallback (line 88) and escalation (line 591) queries; use `mapStreamErrorToUserMessage()` |
| `backend/src/modules/ai/providers/VLLMProvider.ts` | Modify | Add `retryCreate()` private method; wrap `complete()` and `streamComplete()` create calls |
| `backend/src/modules/chat/stream-error.ts` | Create | `mapStreamErrorToUserMessage(errorMessage, isParlant?)` utility — single testable function replacing duplicated if-chains |
| `backend/src/services/ModelRouter.test.ts` | Create | Unit tests: audio models excluded from routing and fallback queries |
| `backend/src/modules/ai/providers/VLLMProvider.test.ts` | Create | Unit tests: retry on 502/503, no-retry on 4xx, max-retry exhaustion |
| `backend/src/modules/chat/stream-error.test.ts` | Create | Unit tests: all error message branches including new 502 branch |

---

## Task 1: Filter audio models from Smart Routing

Audio models (e.g. `gpt-audio-1.5`) are stored in `model_routing_tiers` with `model_type = 'chat'`, so the current SQL filters don't exclude them. Fix: add `AND m.model_id NOT LIKE '%audio%'` to three SQL queries.

**Files:**
- Modify: `backend/src/services/ModelRouter.ts:141-162` — `loadTierModels()` SQL + export class
- Modify: `backend/src/modules/chat/completions.ts:88-92` — fallback query
- Modify: `backend/src/modules/chat/completions.ts:591-596` — escalation query
- Create: `backend/src/services/ModelRouter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/ModelRouter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter } from './ModelRouter.js';

const makePool = (rows: object[]) => ({
  execute: vi.fn().mockResolvedValue([rows, []]),
}) as any;

describe('ModelRouter — audio model filtering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('excludes audio models from tier routing', async () => {
    const pool = makePool([
      { tier_name: 'fast', model_id: 'gpt-audio-1.5', provider: 'openai', priority: 1 },
      { tier_name: 'fast', model_id: 'gpt-4o-mini', provider: 'openai', priority: 2 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'ciao', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1, hasDocuments: false,
    });
    expect(decision.model).toBe('gpt-4o-mini');
    expect(decision.model).not.toContain('audio');
  });

  it('SQL query contains audio exclusion filter', async () => {
    const pool = makePool([]);
    const router = new ModelRouter(pool);
    await router.route({
      query: 'test', conversationLength: 0, hasAttachments: false,
      attachmentCount: 0, hasVisionAttachments: false, toolsRequested: false,
      userId: 1,
    });
    const [sql] = pool.execute.mock.calls[0];
    expect(sql).toMatch(/NOT LIKE '%audio%'/i);
  });

  it('returns empty model when only audio models are available', async () => {
    const pool = makePool([
      { tier_name: 'balanced', model_id: 'gpt-audio-preview', provider: 'openai', priority: 1 },
    ]);
    const router = new ModelRouter(pool);
    const decision = await router.route({
      query: 'analizza questo documento in dettaglio',
      conversationLength: 0, hasAttachments: false, attachmentCount: 0,
      hasVisionAttachments: false, toolsRequested: false, userId: 1,
    });
    expect(decision.model).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/ModelRouter.test.ts
```

Expected: FAIL — `ModelRouter is not exported` or audio model not filtered.

- [ ] **Step 3: Export `ModelRouter` class**

In `backend/src/services/ModelRouter.ts`, change line 134:

```typescript
// Before:
class ModelRouter {
// After:
export class ModelRouter {
```

- [ ] **Step 4: Add audio filter to `loadTierModels()` SQL**

In `backend/src/services/ModelRouter.ts`, update the SQL in `loadTierModels()` (around line 146):

```typescript
// Before:
const [rows] = await this.db.execute(
  `SELECT rt.tier_name, rt.model_id, rt.provider, rt.priority
   FROM model_routing_tiers rt
   INNER JOIN ai_models m ON rt.model_id = m.model_id
   INNER JOIN ai_providers p ON m.provider_id = p.id
   WHERE rt.is_enabled = TRUE
     AND m.is_enabled = TRUE
     AND p.is_enabled = TRUE
     AND m.model_type IN ('chat', 'completion')
   ORDER BY rt.tier_name, rt.priority ASC`
) as any;

// After:
const [rows] = await this.db.execute(
  `SELECT rt.tier_name, rt.model_id, rt.provider, rt.priority
   FROM model_routing_tiers rt
   INNER JOIN ai_models m ON rt.model_id = m.model_id
   INNER JOIN ai_providers p ON m.provider_id = p.id
   WHERE rt.is_enabled = TRUE
     AND m.is_enabled = TRUE
     AND p.is_enabled = TRUE
     AND m.model_type IN ('chat', 'completion')
     AND m.model_id NOT LIKE '%audio%'
   ORDER BY rt.tier_name, rt.priority ASC`
) as any;
```

- [ ] **Step 5: Add audio filter to fallback query in `completions.ts`**

In `backend/src/modules/chat/completions.ts`, update the fallback query (around line 88):

```typescript
// Before:
const fallbackRow = await findOne<{ model_id: string }>(fastify.db,
  `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
   WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
   ORDER BY m.sort_order ASC LIMIT 1`);

// After:
const fallbackRow = await findOne<{ model_id: string }>(fastify.db,
  `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
   WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
     AND m.model_id NOT LIKE '%audio%'
   ORDER BY m.sort_order ASC LIMIT 1`);
```

- [ ] **Step 6: Add audio filter to escalation query in `completions.ts`**

In `backend/src/modules/chat/completions.ts`, update the escalation query (around line 591):

```typescript
// Before:
const escalatedModel = await findOne<{ model_id: string }>(fastify.db,
  `SELECT rt.model_id FROM model_routing_tiers rt
   INNER JOIN ai_models m ON rt.model_id = m.model_id
   INNER JOIN ai_providers p ON m.provider_id = p.id
   WHERE rt.is_enabled = TRUE AND m.is_enabled = TRUE AND p.is_enabled = TRUE
     AND rt.model_id != ?
   ORDER BY FIELD(rt.tier_name, 'balanced', 'powerful', 'fast'), rt.priority ASC LIMIT 1`, [body.model]);

// After:
const escalatedModel = await findOne<{ model_id: string }>(fastify.db,
  `SELECT rt.model_id FROM model_routing_tiers rt
   INNER JOIN ai_models m ON rt.model_id = m.model_id
   INNER JOIN ai_providers p ON m.provider_id = p.id
   WHERE rt.is_enabled = TRUE AND m.is_enabled = TRUE AND p.is_enabled = TRUE
     AND rt.model_id != ?
     AND m.model_id NOT LIKE '%audio%'
   ORDER BY FIELD(rt.tier_name, 'balanced', 'powerful', 'fast'), rt.priority ASC LIMIT 1`, [body.model]);
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/ModelRouter.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 8: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd /home/marcello/enterprise-ai-chat/backend
git add src/services/ModelRouter.ts src/services/ModelRouter.test.ts src/modules/chat/completions.ts
git commit -m "fix: exclude audio models from smart routing and fallback queries"
```

---

## Task 2: vLLM retry with exponential backoff

When vLLM is cold-starting (~487s), requests arrive while the CUDA graphs are warming up and receive a 502 immediately. The fix adds a `retryCreate()` private method that retries on 502/503 with delays 5s → 15s → 30s (up to 3 retries). Retry only wraps the HTTP connection phase — not mid-stream failures (which can't be retried).

**Files:**
- Modify: `backend/src/modules/ai/providers/VLLMProvider.ts:115-148` — `complete()` and `:150-167` — `streamComplete()` opening
- Create: `backend/src/modules/ai/providers/VLLMProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/ai/providers/VLLMProvider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be defined before vi.mock (vi.hoisted runs at module load time)
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

// Import after mock is set up
const { VLLMProvider } = await import('./VLLMProvider.js');

const make502 = () => Object.assign(new Error('502 Bad Gateway'), { status: 502 });
const make503 = () => Object.assign(new Error('503 Service Unavailable'), { status: 503 });
const make400 = () => Object.assign(new Error('400 Bad Request'), { status: 400 });

describe('VLLMProvider — retry on 502/503', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('complete()', () => {
    it('retries once on 502 and succeeds', async () => {
      vi.useFakeTimers();
      const provider = new VLLMProvider({ baseUrl: 'http://localhost:8087/vllm', apiKey: 'test' });
      const successResponse = {
        choices: [{ message: { content: 'hello', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
      mockCreate
        .mockRejectedValueOnce(make502())
        .mockResolvedValueOnce(successResponse);

      const promise = provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] });
      // Advance through retry delay
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.content).toBe('hello');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('retries up to 3 times then throws on persistent 502', async () => {
      vi.useFakeTimers();
      const provider = new VLLMProvider({ baseUrl: 'http://localhost:8087/vllm', apiKey: 'test' });
      mockCreate.mockRejectedValue(make502());

      const promise = provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] });
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(/complete\(\) failed/);
      expect(mockCreate).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      vi.useRealTimers();
    });

    it('does NOT retry on 400 (client error)', async () => {
      const provider = new VLLMProvider({ baseUrl: 'http://localhost:8087/vllm', apiKey: 'test' });
      mockCreate.mockRejectedValue(make400());

      await expect(
        provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/complete\(\) failed/);
      expect(mockCreate).toHaveBeenCalledTimes(1); // no retry
    });

    it('retries on 503 as well', async () => {
      vi.useFakeTimers();
      const provider = new VLLMProvider({ baseUrl: 'http://localhost:8087/vllm', apiKey: 'test' });
      const successResponse = {
        choices: [{ message: { content: 'ok', tool_calls: undefined } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      };
      mockCreate
        .mockRejectedValueOnce(make503())
        .mockResolvedValueOnce(successResponse);

      const promise = provider.complete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }] });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.content).toBe('ok');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('streamComplete()', () => {
    it('retries stream creation once on 502 and succeeds', async () => {
      vi.useFakeTimers();
      const provider = new VLLMProvider({ baseUrl: 'http://localhost:8087/vllm', apiKey: 'test' });

      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'hello' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
      })();

      mockCreate
        .mockRejectedValueOnce(make502())
        .mockResolvedValueOnce(mockStream);

      const chunks: string[] = [];
      const gen = provider.streamComplete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }], stream: true });
      const collectPromise = (async () => {
        for await (const chunk of gen) {
          if (chunk.content) chunks.push(chunk.content);
        }
      })();

      await vi.runAllTimersAsync();
      await collectPromise;

      expect(chunks.join('')).toBe('hello');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('does NOT retry on 400 for stream', async () => {
      const provider = new VLLMProvider({ baseUrl: 'http://localhost:8087/vllm', apiKey: 'test' });
      mockCreate.mockRejectedValue(make400());

      const gen = provider.streamComplete({ model: 'qwen25vl:32b', messages: [{ role: 'user', content: 'hi' }], stream: true });
      await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow(/streamComplete\(\) failed/);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/ai/providers/VLLMProvider.test.ts
```

Expected: FAIL — no retry logic exists yet.

- [ ] **Step 3: Add `retryCreate()` method to `VLLMProvider`**

In `backend/src/modules/ai/providers/VLLMProvider.ts`, add the private method after the constructor (around line 114):

```typescript
  /**
   * Retry wrapper for vLLM API calls that may fail with 502/503 during cold-start.
   * Uses exponential backoff: 5s → 15s → 30s (3 retries max).
   * Only retries on 502/503 (server-side transient errors), not on 4xx client errors.
   */
  private async retryCreate<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [5_000, 15_000, 30_000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const status = error?.status ?? 0;
        const isTransient = status === 502 || status === 503;
        if (!isTransient || attempt === delays.length) {
          throw error;
        }
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      }
    }
    throw lastError;
  }
```

- [ ] **Step 4: Wrap `complete()` create call with retry**

In `backend/src/modules/ai/providers/VLLMProvider.ts`, update `complete()` (around line 115):

```typescript
  async complete(options: CompletionOptions): Promise<CompletionResult> {
    try {
      const resolvedModel = this.resolveModel(options.model);
      const messages = this.applyThinkingMode(options.messages, options.model);
      const response = await this.retryCreate(() =>
        this.client.chat.completions.create(
          {
            model: resolvedModel,
            messages: messages as OpenAI.ChatCompletionMessageParam[],
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7,
            ...(options.tools?.length ? { tools: this.convertTools(options.tools) } : {}),
          },
          options.signal ? { signal: options.signal } : undefined,
        )
      );

      const message = response.choices[0]?.message;
      const reasoning = (message as any)?.reasoning_content as string | undefined;

      return {
        content: VLLMProvider.stripThinkTags(message?.content || ''),
        tokensInput: response.usage?.prompt_tokens || 0,
        tokensOutput: response.usage?.completion_tokens || 0,
        model: options.model,
        provider: 'vllm',
        toolCalls: message?.tool_calls,
        thinkingContent: reasoning || undefined,
      };
    } catch (error: any) {
      const msg = error?.message || 'Unknown error';
      throw new Error(`[vLLM] complete() failed for model "${options.model}": ${msg}`);
    }
  }
```

- [ ] **Step 5: Wrap `streamComplete()` create call with retry**

In `backend/src/modules/ai/providers/VLLMProvider.ts`, update the stream creation in `streamComplete()` (around line 150):

```typescript
  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const startTime = Date.now();
    try {
      const resolvedModel = this.resolveModel(options.model);
      const messages = this.applyThinkingMode(options.messages, options.model);

      // Retry only the HTTP connection phase (where 502 occurs during cold-start).
      // Mid-stream failures cannot be retried.
      const stream = await this.retryCreate(() =>
        this.client.chat.completions.create(
          {
            model: resolvedModel,
            messages: messages as OpenAI.ChatCompletionMessageParam[],
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7,
            stream: true,
            stream_options: { include_usage: true },
            ...(options.tools?.length ? { tools: this.convertTools(options.tools) } : {}),
          },
          options.signal ? { signal: options.signal } : undefined,
        )
      );

      // ... rest of the generator body (for await loop) is unchanged ...
```

Note: the `for await (const chunk of stream as AsyncIterable<any>)` block and everything after it stays exactly as it is. Only the `const stream = await this.client.chat.completions.create(...)` expression is replaced with the `retryCreate` call.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/ai/providers/VLLMProvider.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /home/marcello/enterprise-ai-chat/backend
git add src/modules/ai/providers/VLLMProvider.ts src/modules/ai/providers/VLLMProvider.test.ts
git commit -m "fix: add exponential backoff retry on 502/503 in VLLMProvider"
```

---

## Task 3: User-friendly error message for vLLM 502

The error message mapping logic is duplicated in two places in `completions.ts` (lines ~754 and ~762). Neither detects 502 specifically — vLLM cold-start errors fall through to the generic "An error occurred". Fix: extract the mapping to a testable utility `stream-error.ts`, add a 502/Bad Gateway branch, and replace both occurrences in `completions.ts`.

**Files:**
- Create: `backend/src/modules/chat/stream-error.ts`
- Create: `backend/src/modules/chat/stream-error.test.ts`
- Modify: `backend/src/modules/chat/completions.ts:753-768`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/chat/stream-error.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapStreamErrorToUserMessage } from './stream-error.js';

describe('mapStreamErrorToUserMessage', () => {
  it('returns generic message for unknown errors', () => {
    expect(mapStreamErrorToUserMessage('some unknown error')).toBe(
      'An error occurred while processing your request.'
    );
  });

  it('maps timeout errors', () => {
    const msg = mapStreamErrorToUserMessage('[vLLM] Request timed out after 300000ms');
    expect(msg).toContain('timed out');
  });

  it('maps 502 Bad Gateway to vLLM startup message', () => {
    const msg = mapStreamErrorToUserMessage('[vLLM] streamComplete() failed (Error/502): 502 Bad Gateway');
    expect(msg).toBe('Il modello AI è in fase di avvio, riprova tra qualche minuto.');
  });

  it('maps "Bad Gateway" string (no status code) to vLLM startup message', () => {
    const msg = mapStreamErrorToUserMessage('Bad Gateway from upstream');
    expect(msg).toBe('Il modello AI è in fase di avvio, riprova tra qualche minuto.');
  });

  it('maps ECONNREFUSED to service unavailable', () => {
    const msg = mapStreamErrorToUserMessage('ECONNREFUSED 127.0.0.1:8000');
    expect(msg).toContain('Could not connect');
  });

  it('maps fetch failed to service unavailable', () => {
    const msg = mapStreamErrorToUserMessage('fetch failed: network error');
    expect(msg).toContain('Could not connect');
  });

  it('maps Parlant error when isParlant=true', () => {
    const msg = mapStreamErrorToUserMessage('Parlant service error', true);
    expect(msg).toContain('Parlant');
  });

  it('ignores Parlant error when isParlant=false', () => {
    const msg = mapStreamErrorToUserMessage('Parlant service error', false);
    expect(msg).toBe('An error occurred while processing your request.');
  });

  it('prioritizes timeout over 502 when both present', () => {
    const msg = mapStreamErrorToUserMessage('timeout after 502 ms');
    expect(msg).toContain('timed out');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/chat/stream-error.test.ts
```

Expected: FAIL — `stream-error.ts` does not exist.

- [ ] **Step 3: Create `stream-error.ts`**

Create `backend/src/modules/chat/stream-error.ts`:

```typescript
/**
 * Maps a raw stream error message to a user-facing message.
 *
 * Extracted from the completions route error handler to enable
 * isolated testing. The function covers all known error categories:
 * Parlant agent errors, timeouts, vLLM 502 cold-start, and connection failures.
 */
export function mapStreamErrorToUserMessage(
  errorMessage: string,
  isParlant = false,
): string {
  if (isParlant && errorMessage.includes('Parlant')) {
    return 'Parlant AI Agent service is temporarily unavailable. Please try again later.';
  }
  if (errorMessage.includes('timeout')) {
    return 'Request timed out. The AI service took too long to respond.';
  }
  if (errorMessage.includes('502') || errorMessage.toLowerCase().includes('bad gateway')) {
    return 'Il modello AI è in fase di avvio, riprova tra qualche minuto.';
  }
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
    return 'Could not connect to the AI service. Please try again later.';
  }
  return 'An error occurred while processing your request.';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/chat/stream-error.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Update `completions.ts` to use `mapStreamErrorToUserMessage()`**

In `backend/src/modules/chat/completions.ts`, add the import at the top with the other chat imports:

```typescript
import { mapStreamErrorToUserMessage } from './stream-error.js';
```

Then replace the duplicated error message mapping blocks in the `catch (streamError)` handler.

**Block A** (around line 753 — when no fallback model is available):

```typescript
// Before:
let userMsg = 'An error occurred while processing your request.';
if (errorMessage.includes('timeout')) userMsg = 'Request timed out. The AI service took too long to respond.';
else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) userMsg = 'Could not connect to the AI service. Please try again later.';
reply.raw.write(`data: ${JSON.stringify({ error: userMsg, done: true })}\n\n`);
reply.raw.end();
return;

// After:
reply.raw.write(`data: ${JSON.stringify({ error: mapStreamErrorToUserMessage(errorMessage), done: true })}\n\n`);
reply.raw.end();
return;
```

**Block B** (around line 762 — the `else` branch):

```typescript
// Before:
let userMsg = 'An error occurred while processing your request.';
if (errorMessage.includes('Parlant')) userMsg = 'Parlant AI Agent service is temporarily unavailable. Please try again later.';
else if (errorMessage.includes('timeout')) userMsg = 'Request timed out. The AI service took too long to respond.';
else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) userMsg = 'Could not connect to the AI service. Please try again later.';
reply.raw.write(`data: ${JSON.stringify({ error: userMsg, done: true })}\n\n`);
reply.raw.end();
return;

// After:
reply.raw.write(`data: ${JSON.stringify({ error: mapStreamErrorToUserMessage(errorMessage, isParlantAgent), done: true })}\n\n`);
reply.raw.end();
return;
```

- [ ] **Step 6: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /home/marcello/enterprise-ai-chat/backend
git add src/modules/chat/stream-error.ts src/modules/chat/stream-error.test.ts src/modules/chat/completions.ts
git commit -m "fix: add vLLM 502 startup message and extract stream error mapping utility"
```

---

## Task 4: Apply vLLM docker-compose thread parallelism

The file `/home/marcello/vllm/docker-compose.yml` already contains the fix (`OMP_NUM_THREADS=16`, `MKL_NUM_THREADS=16`, `TORCH_NUM_THREADS=16`). This task only applies it to the running container and verifies the result.

**Files:**
- Verify: `/home/marcello/vllm/docker-compose.yml` (already modified)

- [ ] **Step 1: Verify the fix is present in the file**

```bash
grep -E 'OMP_NUM_THREADS|MKL_NUM_THREADS|TORCH_NUM_THREADS' /home/marcello/vllm/docker-compose.yml
```

Expected output:
```
      - OMP_NUM_THREADS=16
      - MKL_NUM_THREADS=16
      - TORCH_NUM_THREADS=16
```

- [ ] **Step 2: Restart the vLLM container to apply the new env vars**

```bash
cd /home/marcello/vllm
docker compose up -d
```

Expected: container `vllm` recreated (because env changed).

- [ ] **Step 3: Monitor container startup**

```bash
cd /home/marcello/vllm
docker compose logs -f vllm 2>&1 | head -50
```

Wait for the line: `INFO: Application startup complete.` or `Uvicorn running on http://0.0.0.0:8000`.
This takes approximately 487 seconds (8 minutes) on first start.

- [ ] **Step 4: Verify health**

```bash
curl -sf -H "X-Vllm-Key: mTLS-k8s-backend-2026" http://10.0.1.1:8087/vllm/health && echo "HEALTHY"
```

Expected: `HEALTHY`

- [ ] **Step 5: Verify thread parallelism is active**

Run this while a vLLM inference is in progress (send a test request first):

```bash
docker exec vllm bash -c "cat /proc/\$(pgrep -f 'python.*vllm'| head -1)/status | grep Threads"
```

Expected: `Threads: 16` (or higher, indicating multiple threads are active).

- [ ] **Step 6: Commit docker-compose if not already in git**

```bash
cd /home/marcello/vllm
git diff docker-compose.yml
```

If there are uncommitted changes, commit them:

```bash
git add docker-compose.yml
git commit -m "fix: add OMP/MKL/TORCH_NUM_THREADS=16 for CPU parallelism in vLLM"
```

---

## Final Verification

After completing all tasks, run the full test suite and verify build:

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run
npx tsc --noEmit
```

Expected:
- All tests pass (including new `ModelRouter.test.ts`, `VLLMProvider.test.ts`, `stream-error.test.ts`)
- No TypeScript errors

Optionally, trigger a chat request with `model=auto` in the UI and confirm:
- No audio models appear in the routing log
- If vLLM is warming up, the error message says "Il modello AI è in fase di avvio, riprova tra qualche minuto."
