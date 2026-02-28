# Piano di Auto-Esecuzione — Roadmap v4.0

> Questo piano viene eseguito automaticamente senza intervento utente.
> NON include la build finale (esplicita richiesta dell'utente).
> Versione corrente: 1.7.9 | Branch: feature/agent-framework-v1.6

---

## Pre-Condizioni

- Backup gia' effettuato: tag `snapshot/pre-roadmap-v4-v1.7.9`
- File di backup in `backups/pre-roadmap-v4/`
- Test baseline: 32/32 passano

---

## STEP 1 — Estensione Interfacce e Tipi Base

### 1.1 Estendere `CompletionOptions` in `providers.ts`

**File:** `backend/src/modules/ai/providers.ts` (linee 16-23)

Aggiungere a `CompletionOptions`:
```typescript
export interface CompletionOptions {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  // --- NUOVI CAMPI v4.0 ---
  cacheControl?: boolean;              // Abilita prompt caching Anthropic
  thinking?: {                          // Extended thinking
    type: 'enabled' | 'adaptive';
    budgetTokens?: number;
  };
  outputSchema?: {                      // Structured outputs
    type: 'json_schema';
    jsonSchema: Record<string, any>;
  };
  documentBlocks?: Array<{              // Native PDF/document blocks
    type: 'document';
    source: { type: 'base64' | 'text'; media_type: string; data: string };
    title?: string;
    citations?: { enabled: boolean };
    cacheControl?: { type: 'ephemeral' };
  }>;
}
```

### 1.2 Estendere `CompletionResult` in `providers.ts`

**File:** `backend/src/modules/ai/providers.ts` (linee 25-32)

Aggiungere a `CompletionResult`:
```typescript
export interface CompletionResult {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  provider: ProviderType;
  toolCalls?: any[];
  // --- NUOVI CAMPI v4.0 ---
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  thinkingContent?: string;
  thinkingTokens?: number;
  citations?: Array<{
    type: string;
    citedText: string;
    documentIndex: number;
    documentTitle?: string;
    startCharIndex?: number;
    endCharIndex?: number;
    startPageNumber?: number;
    endPageNumber?: number;
  }>;
}
```

### 1.3 Estendere `StreamChunk` in `providers.ts`

**File:** `backend/src/modules/ai/providers.ts` (linee 34-38)

```typescript
export interface StreamChunk {
  content: string;
  done: boolean;
  toolCalls?: any[];
  // --- NUOVI CAMPI v4.0 ---
  thinking?: string;           // Contenuto thinking block
  thinkingDone?: boolean;      // Fine del thinking
  citations?: any[];           // Citations delta
}
```

### 1.4 Estendere `ModelConfig` in `ModelConfigService.ts`

**File:** `backend/src/services/ModelConfigService.ts` (linee 8-20)

Aggiungere a `ModelConfig`:
```typescript
export interface ModelConfig {
  // ... campi esistenti ...
  supportsThinking: boolean;   // Model supporta extended/adaptive thinking
  supportsCitations: boolean;  // Model supporta citations API
  supportsCaching: boolean;    // Provider supporta prompt caching
  supportsNativePdf: boolean;  // Provider supporta document blocks PDF
}
```

E aggiornare `getConfig()` per leggere i nuovi campi dal DB o inferirli dal provider:
```typescript
supportsThinking: row?.supports_thinking ?? (modelId.startsWith('claude-') || modelId.startsWith('o1') || modelId.startsWith('o3')),
supportsCitations: row?.supports_citations ?? modelId.startsWith('claude-'),
supportsCaching: row?.supports_caching ?? modelId.startsWith('claude-'),
supportsNativePdf: row?.supports_native_pdf ?? modelId.startsWith('claude-'),
```

---

## STEP 2 — Prompt Caching (Anthropic)

### 2.1 Modificare `AnthropicProvider` in `providers.ts`

**Dove:** Metodo `complete()` (linea ~239) e `streamComplete()` (linea ~289)

**Logica:**
- Se `options.cacheControl === true`, aggiungere `cache_control: { type: "ephemeral" }` al top-level del body
- Per `callWithOAuth()` (linea 165): il body gia' viene passato, basta aggiungere il campo
- Per SDK client: passare nel body della request

**In `complete()` (~linea 243):**
```typescript
const requestBody: any = {
  model: options.model,
  max_tokens: options.maxTokens || 4096,
  system: systemMessage?.content
    ? [{ type: 'text', text: systemMessage.content, ...(options.cacheControl ? { cache_control: { type: 'ephemeral' } } : {}) }]
    : undefined,
  messages: this.formatAnthropicMessages(options.messages),
  tools: options.tools as any,
  ...(options.cacheControl ? { cache_control: { type: 'ephemeral' } } : {}),
};
```

**In `streamComplete()` — stessa logica per il body.**

### 2.2 Tracciare metriche cache nella risposta

Nella risposta Anthropic, estrarre:
- `usage.cache_creation_input_tokens`
- `usage.cache_read_input_tokens`

Popolare `CompletionResult.cacheCreationTokens` e `cacheReadTokens`.

### 2.3 In `routes.ts` — abilitare caching per Anthropic

**Dove:** Prima della chiamata `provider.streamComplete()` (area ~linea 643)

```typescript
const isAnthropic = providerName === 'anthropic';
const completionOptions: CompletionOptions = {
  model,
  messages: allMessages,
  maxTokens: modelConfig.maxOutputTokens,
  temperature: modelConfig.temperature,
  tools: toolDefs,
  cacheControl: isAnthropic, // Auto-enable per Anthropic
};
```

### 2.4 In `routes.ts` — salvare metriche cache nel DB

**Dove:** Area token_usage (dopo ~linea 1131)

Salvare `cacheCreationTokens` e `cacheReadTokens` nella tabella `token_usage` (nuove colonne).

---

## STEP 3 — Token Counting Service

### 3.1 Creare `backend/src/services/TokenCountService.ts`

**File NUOVO.**

```typescript
/**
 * TokenCountService — Pre-send token estimation
 * Uses Anthropic count_tokens API (free) or tiktoken for OpenAI
 */

export async function countTokensAnthropic(
  apiKey: string,
  model: string,
  messages: any[],
  system?: string,
  tools?: any[]
): Promise<number> {
  const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, messages, system, tools }),
  });
  const data = await response.json();
  return data.input_tokens;
}

export function estimateTokens(text: string): number {
  // Stima rapida: ~4 chars per token (fallback per non-Anthropic)
  return Math.ceil(text.length / 4);
}
```

### 3.2 Integrare in `routes.ts`

**Dove:** Prima di `provider.streamComplete()` (~linea 643)

```typescript
// Pre-flight token check per Anthropic
if (isAnthropic && apiKey) {
  const inputTokens = await countTokensAnthropic(apiKey, model, formattedMessages, systemPrompt, toolDefs);
  if (inputTokens > modelConfig.contextWindow * 0.95) {
    // Auto-trim: rimuovi messaggi piu' vecchi fino a rientrare
    // oppure avvisa l'utente via SSE
  }
}
```

---

## STEP 4 — Embedding Caching (Redis)

### 4.1 Modificare `EmbeddingService.ts`

**File:** `backend/src/services/EmbeddingService.ts`

**Dove:** Funzione `generateEmbedding()` (~linea 123)

Aggiungere cache layer:
```typescript
import { createHash } from 'crypto';

export async function generateEmbedding(db: mysql.Pool, text: string, redis?: any): Promise<EmbeddingResult> {
  // Cache check
  if (redis) {
    const hash = createHash('sha256').update(text).digest('hex');
    const cacheKey = `emb:${hash}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  // Genera embedding (logica esistente)
  const result = await generateFromProvider(db, text);

  // Cache store (TTL 24h)
  if (redis) {
    const hash = createHash('sha256').update(text).digest('hex');
    await redis.setex(`emb:${hash}`, 86400, JSON.stringify(result));
  }

  return result;
}
```

### 4.2 Aggiornare chiamanti

Passare `fastify.redis` come parametro opzionale nelle chiamate a `generateEmbedding()`:
- `VectorStoreService.ts` — `indexChunks()` e `searchSimilar()`
- `VectorMemoryService.ts` — memory storage/recall
- `ToolService.ts` — `vector_memory_search` tool

### 4.3 Aggiungere cache key in `cache/index.ts`

```typescript
EMBEDDING: (hash: string) => `emb:${hash}`,
```

---

## STEP 5 — Extended Thinking / Adaptive Thinking

### 5.1 Modificare `AnthropicProvider` in `providers.ts`

**In `streamComplete()` — costruzione body (~linea 289-424):**

```typescript
// Se thinking abilitato
if (options.thinking) {
  requestBody.thinking = options.thinking.type === 'adaptive'
    ? { type: 'adaptive' }
    : { type: 'enabled', budget_tokens: options.thinking.budgetTokens || 16000 };
}
```

**Nel parsing dello stream:**

Riconoscere i blocchi `thinking`:
- `content_block_start` con `type: 'thinking'` → inizia accumulo thinking
- `content_block_delta` con `type: 'thinking_delta'` → accumula testo thinking
- `content_block_stop` per thinking → yield `StreamChunk` con `thinking` e `thinkingDone: true`

### 5.2 In `routes.ts` — abilitare thinking

**Dove:** Prima di `provider.streamComplete()` (~linea 643)

```typescript
if (isAnthropic && modelConfig.supportsThinking) {
  completionOptions.thinking = model.includes('opus-4-6') || model.includes('opus-4-5')
    ? { type: 'adaptive' }
    : { type: 'enabled', budgetTokens: 16000 };
}
```

### 5.3 In `routes.ts` — forwarding thinking via SSE

**Nel loop di streaming (~linea 655-690):**

```typescript
for await (const chunk of stream) {
  if (chunk.thinking) {
    sseWrite(`data: ${JSON.stringify({ thinking: chunk.thinking, thinkingDone: chunk.thinkingDone })}\n\n`);
  }
  if (chunk.content) {
    fullResponse += chunk.content;
    sseWrite(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
  }
  // ... tool calls handling ...
}
```

### 5.4 Aggiornare `ModelConfigService.ts`

Nella funzione `getConfig()`:
```typescript
supportsThinking: modelId.startsWith('claude-') || modelId.startsWith('o1') || modelId.startsWith('o3'),
```

---

## STEP 6 — Citations API

### 6.1 Modificare `formatAnthropicMessages()` in `providers.ts`

**Dove:** Metodo `formatAnthropicMessages()` (~linea 199)

Se `options.documentBlocks` presente, iniettarli nel primo messaggio utente:
```typescript
// In formatAnthropicMessages, o in un wrapper che lo chiama
if (options.documentBlocks?.length) {
  // Trova primo messaggio user e aggiungi document blocks
  const firstUserIdx = formatted.findIndex(m => m.role === 'user');
  if (firstUserIdx >= 0) {
    const existingContent = Array.isArray(formatted[firstUserIdx].content)
      ? formatted[firstUserIdx].content
      : [{ type: 'text', text: formatted[firstUserIdx].content }];
    formatted[firstUserIdx].content = [...options.documentBlocks, ...existingContent];
  }
}
```

### 6.2 Parsing citations nello stream

**In `streamComplete()` — parsing SSE events:**

Riconoscere `citations_delta` events:
```typescript
if (delta.type === 'citations_delta') {
  yield { content: '', done: false, citations: [delta.citation] };
}
```

### 6.3 In `routes.ts` — costruire document blocks per allegati

**Dove:** Attachment processing (~linea 280-373)

Per provider Anthropic con allegati piccoli:
```typescript
if (isAnthropic && attachment.content_type === 'application/pdf' && rawSize < 32 * 1024 * 1024) {
  // Usa document block nativo
  completionOptions.documentBlocks = completionOptions.documentBlocks || [];
  completionOptions.documentBlocks.push({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
    title: attachment.original_name,
    citations: { enabled: true },
    cacheControl: { type: 'ephemeral' },
  });
} else {
  // Fallback: chunking + text injection (logica esistente)
}
```

### 6.4 Forwarding citations via SSE

**Nel loop streaming (~linea 655):**
```typescript
if (chunk.citations?.length) {
  sseWrite(`data: ${JSON.stringify({ citations: chunk.citations })}\n\n`);
}
```

---

## STEP 7 — Structured Outputs

### 7.1 Modificare `AnthropicProvider` in `providers.ts`

**In `complete()` e `streamComplete()` — body construction:**

```typescript
if (options.outputSchema) {
  requestBody.output_config = {
    format: {
      type: options.outputSchema.type,
      json_schema: options.outputSchema.jsonSchema,
    }
  };
}
```

### 7.2 Aggiungere `strict: true` alle tool definitions

**File:** `backend/src/services/ToolService.ts`

Per ogni tool definition in `getToolDefinitions()`, aggiungere:
```typescript
{
  name: "write_file",
  description: "...",
  input_schema: { /* ... */ },
  strict: true,  // NUOVO: schema validation garantita
}
```

**NOTA:** solo per provider Anthropic. Per OpenAI, `strict` va nel campo `function.strict`.
La logica in ToolSelectionService dovra' filtrare `strict` per provider non supportati.

---

## STEP 8 — Native PDF Support (Anthropic document blocks)

### 8.1 Bypass OCR per Anthropic + PDF

**File:** `backend/src/modules/chat/routes.ts` — attachment processing

**Dove:** Area ~linee 280-373

Logica:
1. Se provider e' Anthropic E allegato e' PDF E size < 32MB:
   - Leggi raw PDF bytes
   - Converti in base64
   - Crea document block con `citations: { enabled: true }`
   - Salta processing OCR/chunking
2. Altrimenti: usa pipeline esistente (OCR + chunking)

### 8.2 Modificare `DocumentProcessorService.ts`

**File:** `backend/src/services/DocumentProcessorService.ts`

Aggiungere flag `skipProcessing` per PDF che verranno gestiti come document blocks:
```typescript
export async function processAttachment(attachment, options?: { skipOcr?: boolean }): Promise<ProcessedResult> {
  if (options?.skipOcr) {
    // Ritorna solo metadata senza OCR
    return { content: '[Native PDF - processed by AI provider]', pages: 0 };
  }
  // ... logica OCR esistente ...
}
```

---

## STEP 9 — Provider Fallback Chain

### 9.1 Modificare fallback in `routes.ts`

**Dove:** Error handling ~linee 957-1060

Attualmente il fallback e' hardcoded. Renderlo configurabile:

```typescript
// Configurazione fallback chain
const FALLBACK_CHAINS: Record<string, string[]> = {
  'claude-opus-4-20250514': ['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.0-flash'],
  'claude-sonnet-4-20250514': ['gpt-4o-mini', 'gemini-2.0-flash'],
  'gpt-4o': ['gpt-4o-mini', 'claude-sonnet-4-20250514'],
  'gpt-4.1': ['gpt-4.1-mini', 'claude-sonnet-4-20250514'],
};
```

### 9.2 Circuit breaker

**File NUOVO:** `backend/src/services/CircuitBreakerService.ts`

```typescript
const providerErrors = new Map<string, { count: number; lastError: number }>();
const THRESHOLD = 3;
const RESET_MS = 60000;

export function isProviderHealthy(provider: string): boolean {
  const state = providerErrors.get(provider);
  if (!state) return true;
  if (Date.now() - state.lastError > RESET_MS) {
    providerErrors.delete(provider);
    return true;
  }
  return state.count < THRESHOLD;
}

export function recordProviderError(provider: string): void {
  const state = providerErrors.get(provider) || { count: 0, lastError: 0 };
  providerErrors.set(provider, { count: state.count + 1, lastError: Date.now() });
}

export function recordProviderSuccess(provider: string): void {
  providerErrors.delete(provider);
}
```

---

## STEP 10 — Batch Processing Service

### 10.1 Creare `backend/src/services/BatchProcessingService.ts`

**File NUOVO.**

```typescript
export interface BatchRequest {
  customId: string;
  model: string;
  messages: any[];
  system?: string;
  maxTokens?: number;
}

export async function submitBatch(apiKey: string, requests: BatchRequest[]): Promise<string> {
  const formattedRequests = requests.map(r => ({
    custom_id: r.customId,
    params: { model: r.model, max_tokens: r.maxTokens || 4096, messages: r.messages, system: r.system }
  }));
  const response = await fetch('https://api.anthropic.com/v1/messages/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ requests: formattedRequests }),
  });
  const data = await response.json();
  return data.id;
}

export async function getBatchStatus(apiKey: string, batchId: string): Promise<any> {
  const response = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  return response.json();
}

export async function* streamBatchResults(apiKey: string, batchId: string): AsyncGenerator<any> {
  // Stream JSONL results
}
```

### 10.2 Creare route batch

**File:** `backend/src/modules/batch/routes.ts` (NUOVO modulo)

Endpoints:
- `POST /api/batch/submit` — invia batch
- `GET /api/batch/:id/status` — stato batch
- `GET /api/batch/:id/results` — risultati

### 10.3 Registrare modulo

**File:** `backend/src/index.ts` — registrare il nuovo modulo batch routes.

---

## STEP 11 — Migrazione Database

### 11.1 Nuove colonne per `ai_models`

```sql
ALTER TABLE ai_models ADD COLUMN supports_thinking BOOLEAN DEFAULT FALSE AFTER supports_streaming;
ALTER TABLE ai_models ADD COLUMN supports_citations BOOLEAN DEFAULT FALSE AFTER supports_thinking;
ALTER TABLE ai_models ADD COLUMN supports_caching BOOLEAN DEFAULT FALSE AFTER supports_citations;
ALTER TABLE ai_models ADD COLUMN supports_native_pdf BOOLEAN DEFAULT FALSE AFTER supports_caching;
```

### 11.2 Nuove colonne per `token_usage`

```sql
ALTER TABLE token_usage ADD COLUMN cache_creation_tokens INT DEFAULT 0 AFTER cost_usd;
ALTER TABLE token_usage ADD COLUMN cache_read_tokens INT DEFAULT 0 AFTER cache_creation_tokens;
ALTER TABLE token_usage ADD COLUMN thinking_tokens INT DEFAULT 0 AFTER cache_read_tokens;
```

### 11.3 Update modelli Claude con capabilities

```sql
UPDATE ai_models SET
  supports_thinking = TRUE,
  supports_citations = TRUE,
  supports_caching = TRUE,
  supports_native_pdf = TRUE
WHERE model_id LIKE 'claude-%';
```

### 11.4 Nuova tabella `batch_jobs`

```sql
CREATE TABLE IF NOT EXISTS batch_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  batch_id VARCHAR(255) NOT NULL,
  model VARCHAR(100) NOT NULL,
  status ENUM('in_progress','canceling','ended') DEFAULT 'in_progress',
  total_requests INT DEFAULT 0,
  succeeded INT DEFAULT 0,
  errored INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## STEP 12 — Aggiornamento Prezzi Modelli

### 12.1 Aggiornare `MODEL_PRICING` in `providers.ts`

Aggiungere nuovi modelli Claude 4.5/4.6:
```typescript
// Claude 4.6
'claude-opus-4-6': { input: 0.005, output: 0.025 },
'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
// Claude 4.5
'claude-opus-4-5-20251101': { input: 0.005, output: 0.025 },
'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
```

---

## STEP 13 — Unit Tests

### 13.1 Test per TokenCountService

**File NUOVO:** `backend/src/services/TokenCountService.test.ts`
- Test estimateTokens()
- Test countTokensAnthropic() con mock fetch

### 13.2 Test per prompt caching

Aggiungere test in `SandboxService.test.ts` o creare file dedicato per Anthropic provider caching.

### 13.3 Test per CircuitBreakerService

**File NUOVO:** `backend/src/services/CircuitBreakerService.test.ts`
- Test isProviderHealthy() con e senza errori
- Test reset dopo timeout
- Test threshold

### 13.4 Test per BatchProcessingService

**File NUOVO:** `backend/src/services/BatchProcessingService.test.ts`
- Test submitBatch con mock
- Test getBatchStatus

### 13.5 Aggiornare test esistenti

- `ToolSelectionService.test.ts` — aggiornare se cambiano tool definitions
- `SandboxService.test.ts` — assicurare compatibilita'

---

## STEP 14 — TypeScript Build Verification

```bash
cd enterprise-ai-chat/backend && npx tsc --noEmit
```

Risolvere TUTTI gli errori TS prima di procedere.

---

## STEP 15 — Test Suite Completa

```bash
cd enterprise-ai-chat/backend && npm test
```

Tutti i test devono passare (target: 80%+ coverage).

---

## STEP 16 — Commit (NO Build)

```bash
git add -A
git commit -m "feat: implement Roadmap v4.0 - prompt caching, extended thinking, citations, batch API, token counting, PDF native support, structured outputs, provider fallback, embedding cache"
```

**NOTA: NON eseguire build o deploy. L'utente lo fara' manualmente.**

---

## Ordine di Esecuzione

```
STEP 1  → Interfacce e tipi (base per tutto)
STEP 11 → Migrazione DB (prerequisito per runtime)
STEP 12 → Prezzi modelli aggiornati
STEP 2  → Prompt caching (impatto costi immediato)
STEP 3  → Token counting service
STEP 4  → Embedding caching
STEP 5  → Extended thinking
STEP 6  → Citations API
STEP 7  → Structured outputs
STEP 8  → Native PDF
STEP 9  → Provider fallback + circuit breaker
STEP 10 → Batch processing
STEP 13 → Unit tests
STEP 14 → TypeScript verification
STEP 15 → Test suite
STEP 16 → Commit
```

---

## File Coinvolti (Riepilogo)

| File | Azione | Step |
|------|--------|------|
| `backend/src/modules/ai/providers.ts` | MODIFICA | 1,2,5,6,7,12 |
| `backend/src/modules/chat/routes.ts` | MODIFICA | 2,3,5,6,8,9 |
| `backend/src/services/ModelConfigService.ts` | MODIFICA | 1,5 |
| `backend/src/services/EmbeddingService.ts` | MODIFICA | 4 |
| `backend/src/services/ToolService.ts` | MODIFICA | 7 |
| `backend/src/services/DocumentProcessorService.ts` | MODIFICA | 8 |
| `backend/src/cache/index.ts` | MODIFICA | 4 |
| `backend/src/services/TokenCountService.ts` | NUOVO | 3 |
| `backend/src/services/CircuitBreakerService.ts` | NUOVO | 9 |
| `backend/src/services/BatchProcessingService.ts` | NUOVO | 10 |
| `backend/src/modules/batch/routes.ts` | NUOVO | 10 |
| `backend/src/services/TokenCountService.test.ts` | NUOVO | 13 |
| `backend/src/services/CircuitBreakerService.test.ts` | NUOVO | 13 |
| `backend/src/services/BatchProcessingService.test.ts` | NUOVO | 13 |
| `k8s/mariadb/init-configmap.yaml` | MODIFICA | 11 |

**Totale: 10 file modificati + 5 file nuovi**
