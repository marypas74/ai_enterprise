# QA Fix: Ollama Error Handling, HTTP Status Messages, Audio Model Badge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Risolvere 3 problemi trovati nei test E2E di v2.1.56: crash GPU Ollama senza retry, messaggi di errore generici per HTTP 401/429/404/503, e modelli audio selezionabili senza avviso.

**Architecture:** Task 1 aggiunge GPU-crash retry in OllamaProvider (pattern simile a VLLMProvider.retryCreate). Task 2 estende stream-error.ts con mapping HTTP status code per tutti i provider. Task 3 aggiunge badge "Solo Audio" nel model selector React. Task 4 bumpa la versione a 2.1.57.

**Tech Stack:** TypeScript, Fastify 5, Vitest (backend), React 18 + Tailwind + lucide-react (frontend).

---

## File Structure

**Modificati:**
- `backend/src/modules/ai/providers/OllamaProvider.ts` — aggiunge GPU-crash retry on 500 in `complete()` e `streamComplete()`
- `backend/src/modules/chat/stream-error.ts` — aggiunge mapping per Ollama 500, HTTP 401, 429, 404, 503
- `backend/src/modules/chat/stream-error.test.ts` — 6 nuovi test per i pattern aggiunti
- `frontend/src/pages/ChatPage.tsx` — aggiunge `isAudio` detection e badge "Solo Audio"

**Creati:**
- `backend/src/modules/ai/providers/OllamaProvider.test.ts` — test per GPU-crash retry

**Versione bumped:**
- `backend/package.json`, `frontend/package.json`, `frontend/src/version.ts`
- `frontend/src/pages/PublicMonitorPage.tsx`, `vscode-extension/package.json`
- `vscode-extension/webview-ui/src/claude-code/MainLayout.tsx` (2 occorrenze)
- `k8s/backend/deployment.yaml`, `k8s/frontend/deployment.yaml`, `k8s/kustomization.yaml`

---

## Task 1: Ollama GPU-crash retry on 500

**Context:** Quando vLLM occupa la VRAM RTX 5090, il runner llama di Ollama crasha con `GGML_ASSERT(buffer) failed` e restituisce HTTP 500. Attualmente OllamaProvider rilancia l'errore senza retry. Fix: 1 retry con delay 2s se la risposta 500 contiene "GGML_ASSERT" o "llama runner process has terminated". Il messaggio di errore deve poi essere mappato a un testo user-friendly.

**Files:**
- Modify: `backend/src/modules/ai/providers/OllamaProvider.ts`
- Create: `backend/src/modules/ai/providers/OllamaProvider.test.ts`

- [ ] **Step 1: Scrivi il test per il GPU-crash retry (deve fallire)**

Crea il file `backend/src/modules/ai/providers/OllamaProvider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CompletionOptions } from '../types.js';

// Mock fetch globally — OllamaProvider uses native fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { OllamaProvider } from './OllamaProvider.js';

// Helper: crea una Response simulata
function makeResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    statusText: status === 500 ? 'Internal Server Error' : 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGpuCrashBody(): string {
  return JSON.stringify({ error: 'llama runner process has terminated: GGML_ASSERT(buffer) failed' });
}

function makeOkStreamBody(): string {
  // Ollama streaming NDJSON response
  return JSON.stringify({ message: { content: 'ciao' }, done: false }) + '\n'
    + JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 3 }) + '\n';
}

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
    });
  });

  describe('GPU crash retry (500 GGML_ASSERT)', () => {
    describe('complete()', () => {
      it('retries once on 500 GPU crash then succeeds', async () => {
        vi.useFakeTimers();

        const successBody = JSON.stringify({
          message: { content: 'Risposta OK' },
          prompt_eval_count: 10,
          eval_count: 5,
        });

        mockFetch
          .mockResolvedValueOnce(makeResponse(500, makeGpuCrashBody()))
          .mockResolvedValueOnce(makeResponse(200, successBody));

        const options: CompletionOptions = {
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
        };

        const promise = provider.complete(options);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.content).toBe('Risposta OK');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });

      it('throws on 500 GPU crash after retry still fails', async () => {
        vi.useFakeTimers();

        mockFetch
          .mockResolvedValue(makeResponse(500, makeGpuCrashBody()));

        const promise = provider.complete({
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
        });
        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Ollama API error: 500');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });

      it('does NOT retry on 500 without GGML_ASSERT (generic server error)', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(500, JSON.stringify({ error: 'some other error' })));

        await expect(provider.complete({
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
        })).rejects.toThrow('Ollama API error: 500');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('streamComplete()', () => {
      it('retries once on 500 GPU crash and streams on retry', async () => {
        vi.useFakeTimers();

        // Second response must be a proper streaming response
        const successResponse = new Response(makeOkStreamBody(), {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });

        mockFetch
          .mockResolvedValueOnce(makeResponse(500, makeGpuCrashBody()))
          .mockResolvedValueOnce(successResponse);

        const chunks: string[] = [];
        const gen = provider.streamComplete({
          model: 'granite3.2-vision:latest',
          messages: [{ role: 'user', content: 'ciao' }],
          stream: true,
        });

        const collectPromise = (async () => {
          for await (const chunk of gen) {
            if (chunk.content) chunks.push(chunk.content);
          }
        })();

        await vi.runAllTimersAsync();
        await collectPromise;

        expect(chunks.join('')).toBe('ciao');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
      });
    });
  });
});
```

- [ ] **Step 2: Esegui il test per verificare che fallisce**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/ai/providers/OllamaProvider.test.ts --reporter=verbose
```

Expected: FAIL — `retries once on 500 GPU crash` perché la logica di retry non esiste ancora.

- [ ] **Step 3: Implementa il GPU-crash retry in OllamaProvider**

In `backend/src/modules/ai/providers/OllamaProvider.ts`, apporta le seguenti modifiche:

**3a. Modifica `complete()` (righe 36-82):** Cambia `const response` in `let response` e aggiungi il blocco GPU-crash dopo il fetch:

```typescript
async complete(options: CompletionOptions): Promise<CompletionResult> {
  const targetModel = this.resolveModel(options.model);
  const useThinking = !!options.thinking;

  let response = await fetch(`${this.baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || ''
    },
    body: JSON.stringify({
      model: targetModel,
      messages: options.messages,
      stream: false,
      tools: options.tools,
      ...(useThinking ? { think: true } : {}),
      options: {
        num_predict: options.maxTokens || 4096,
        temperature: options.temperature || 0.7,
        ...(options.tools && options.tools.length > 0 ? { num_ctx: 8192 } : {})
      },
      keep_alive: this.keepAlive
    }),
    signal: AbortSignal.timeout(this.timeout)
  });

  // GPU crash (GGML_ASSERT): retry once after 2s
  if (response.status === 500) {
    const body500 = await response.text().catch(() => '');
    const isGpuCrash = body500.includes('GGML_ASSERT') || body500.includes('llama runner process has terminated');
    if (isGpuCrash) {
      console.warn('[Ollama] GPU crash detected in complete(), retrying after 2s');
      await new Promise<void>(resolve => setTimeout(resolve, 2000));
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || ''
        },
        body: JSON.stringify({
          model: targetModel,
          messages: options.messages,
          stream: false,
          tools: options.tools,
          ...(useThinking ? { think: true } : {}),
          options: {
            num_predict: options.maxTokens || 4096,
            temperature: options.temperature || 0.7,
            ...(options.tools && options.tools.length > 0 ? { num_ctx: 8192 } : {})
          },
          keep_alive: this.keepAlive
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
    } else {
      console.error(`[Ollama] API error: 500 ${response.statusText} - ${body500}`);
      throw new Error(`Ollama API error: 500 Internal Server Error`);
    }
  }

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }
  // ... resto invariato (riga 67 in poi)
```

**3b. Modifica `streamComplete()` (riga ~125):** Aggiungi il blocco GPU-crash subito dopo `let response = await makeRequest()` e prima del blocco `if (!response.ok && useTools)`:

```typescript
let response = await makeRequest();

const connectTime = Date.now() - startTime;
console.log(`[Ollama] Connection established in ${connectTime}ms, status=${response.status}`);

// GPU crash (GGML_ASSERT): retry once after 2s
if (response.status === 500) {
  const body500 = await response.text().catch(() => '');
  const isGpuCrash = body500.includes('GGML_ASSERT') || body500.includes('llama runner process has terminated');
  if (isGpuCrash) {
    console.warn('[Ollama] GPU crash detected in streamComplete(), retrying after 2s');
    await new Promise<void>(resolve => setTimeout(resolve, 2000));
    response = await makeRequest();
  } else {
    console.error(`[Ollama] API error: 500 ${response.statusText} - ${body500}`);
    throw new Error(`Ollama API error: 500 Internal Server Error`);
  }
}

// If model doesn't support tools, retry without them
if (!response.ok && useTools) {
  // ... resto invariato (riga 132 in poi)
```

- [ ] **Step 4: Esegui i test e verifica che passano**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/ai/providers/OllamaProvider.test.ts --reporter=verbose
```

Expected: 4 PASS (3 complete + 1 streamComplete).

- [ ] **Step 5: Verifica che i test VLLMProvider esistenti non siano stati rotti**

```bash
npx vitest run src/modules/ai/providers/VLLMProvider.test.ts --reporter=verbose 2>&1 | tail -5
```

Expected: 23 PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/modules/ai/providers/OllamaProvider.ts \
        backend/src/modules/ai/providers/OllamaProvider.test.ts
git commit -m "fix(ollama): retry once on GPU crash (GGML_ASSERT) with 2s delay"
```

---

## Task 2: Estendi stream-error.ts con HTTP status codes

**Context:** Gli errori dei provider OpenAI/Anthropic/Google vengono mostrati come messaggio generico. I messaggi di errore includono il codice HTTP (es. "401 Unauthorized", "429 Too Many Requests"). Bisogna aggiungere mapping per 401, 429, 404, 503 in stream-error.ts e il mapping per gli errori Ollama 500.

**Files:**
- Modify: `backend/src/modules/chat/stream-error.ts`
- Modify: `backend/src/modules/chat/stream-error.test.ts`

- [ ] **Step 1: Scrivi i nuovi test (devono fallire)**

Apri `backend/src/modules/chat/stream-error.test.ts` e aggiungi i test alla fine del `describe`:

```typescript
  // HTTP status code mappings
  it('maps 401 Unauthorized to API key error', () => {
    const msg = mapStreamErrorToUserMessage('Error 401: 401 Unauthorized');
    expect(msg).toBe("API key non valida o mancante. Contatta l'amministratore.");
  });

  it('maps "unauthorized" (lowercase) to API key error', () => {
    const msg = mapStreamErrorToUserMessage('OpenAI API error: unauthorized access denied');
    expect(msg).toBe("API key non valida o mancante. Contatta l'amministratore.");
  });

  it('maps 429 to rate limit message', () => {
    const msg = mapStreamErrorToUserMessage('429 Too Many Requests - rate limit exceeded');
    expect(msg).toBe('Limite rate raggiunto. Riprova tra qualche momento.');
  });

  it('maps "rate limit" string to rate limit message', () => {
    const msg = mapStreamErrorToUserMessage('You exceeded your current quota, rate limit reached');
    expect(msg).toBe('Limite rate raggiunto. Riprova tra qualche momento.');
  });

  it('maps 404 to model not found message', () => {
    const msg = mapStreamErrorToUserMessage('404 Not Found: model does not exist');
    expect(msg).toBe("Modello AI non trovato. Contatta l'amministratore.");
  });

  it('maps 503 to service unavailable message', () => {
    const msg = mapStreamErrorToUserMessage('503 Service Unavailable from upstream');
    expect(msg).toBe('Servizio AI temporaneamente non disponibile. Riprova tra qualche minuto.');
  });

  it('maps Ollama 500 error to local model message', () => {
    const msg = mapStreamErrorToUserMessage('Ollama API error: 500 Internal Server Error');
    expect(msg).toBe('Il modello locale non è disponibile al momento. Prova un altro modello.');
  });
```

- [ ] **Step 2: Esegui i test per verificare che falliscono**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/chat/stream-error.test.ts --reporter=verbose
```

Expected: 7 FAIL sui nuovi test, 9 PASS sui test esistenti.

- [ ] **Step 3: Estendi stream-error.ts con i nuovi mapping**

Sostituisci l'intero contenuto di `backend/src/modules/chat/stream-error.ts`:

```typescript
/**
 * Maps a raw stream error message to a user-facing message.
 *
 * Extracted from the completions route error handler to enable
 * isolated testing. Covers: Parlant agent errors, timeouts, vLLM 502
 * cold-start, HTTP status codes (401/429/404/503), Ollama GPU crash,
 * and connection failures.
 *
 * Priority order matters — timeout/502/specific codes checked before
 * generic patterns.
 */
export function mapStreamErrorToUserMessage(
  errorMessage: string,
  isParlant = false,
): string {
  if (isParlant && errorMessage.includes('Parlant')) {
    return 'Parlant AI Agent service is temporarily unavailable. Please try again later.';
  }
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return 'Request timed out. The AI service took too long to respond.';
  }
  if (errorMessage.includes('502') || errorMessage.toLowerCase().includes('bad gateway')) {
    return 'Il modello AI è in fase di avvio, riprova tra qualche minuto.';
  }
  if (errorMessage.includes('401') || errorMessage.toLowerCase().includes('unauthorized')) {
    return "API key non valida o mancante. Contatta l'amministratore.";
  }
  if (
    errorMessage.includes('429') ||
    errorMessage.toLowerCase().includes('too many requests') ||
    errorMessage.toLowerCase().includes('rate limit')
  ) {
    return 'Limite rate raggiunto. Riprova tra qualche momento.';
  }
  if (errorMessage.includes('404') || errorMessage.toLowerCase().includes('not found')) {
    return "Modello AI non trovato. Contatta l'amministratore.";
  }
  if (errorMessage.includes('503') || errorMessage.toLowerCase().includes('service unavailable')) {
    return 'Servizio AI temporaneamente non disponibile. Riprova tra qualche minuto.';
  }
  if (errorMessage.includes('Ollama') && errorMessage.includes('500')) {
    return 'Il modello locale non è disponibile al momento. Prova un altro modello.';
  }
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
    return 'Could not connect to the AI service. Please try again later.';
  }
  return 'An error occurred while processing your request.';
}
```

- [ ] **Step 4: Esegui tutti i test stream-error per verificare che passano**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/modules/chat/stream-error.test.ts --reporter=verbose
```

Expected: 16 PASS (9 precedenti + 7 nuovi). Zero fail.

- [ ] **Step 5: Verifica che il test "prioritizes timeout over 502" sia ancora valido**

Il test `mapStreamErrorToUserMessage('timeout after 502 ms')` deve ritornare `'Request timed out...'` perché il pattern `timeout` è controllato prima di `502`. Se è GREEN sei a posto.

- [ ] **Step 6: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/modules/chat/stream-error.ts \
        backend/src/modules/chat/stream-error.test.ts
git commit -m "fix(stream-error): add HTTP 401/429/404/503 and Ollama 500 error mappings"
```

---

## Task 3: Badge "Solo Audio" nel model selector

**Context:** I modelli audio (`gpt-audio-1.5`, `gpt-4o-audio-preview`, ecc.) sono visibili e selezionabili nel dropdown ma non gestiscono input/output testo. L'utente può selezionarli per errore e ricevere un errore incomprensibile. Fix: aggiungere badge viola "Solo Audio" e avviso quando un modello audio è selezionato.

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

Il badge va inserito a riga ~302 (subito dopo il badge `{isExternal && ...}`). L'icona `Volume2` è già importata da `lucide-react` (riga 18).

- [ ] **Step 1: Individua la sezione corretta nel file**

Apri `frontend/src/pages/ChatPage.tsx`. Cerca la riga che contiene:
```
const isExternal = model.is_local === false;
```
(circa riga 279). Il blocco da modificare è quello dal `<button key={model.id}` fino alla chiusura del `</button>` di ogni modello nel dropdown.

- [ ] **Step 2: Aggiungi `isAudio` e il badge**

Dopo la riga `const isDisabledInRag = isRagMode && isExternal && user?.role !== 'admin';` (riga ~280), aggiungi:

```tsx
const isAudio = model.id.toLowerCase().includes('audio');
```

Poi, nel blocco dei badge (dopo il badge `{isExternal && ...}` che termina a riga ~306), aggiungi il badge audio:

```tsx
{isAudio && (
  <span
    title="Questo modello gestisce solo input/output audio"
    className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 flex items-center gap-0.5"
  >
    <Volume2 className="w-2.5 h-2.5" />
    Solo Audio
  </span>
)}
```

Infine, nel blocco degli avvisi under-badge (dopo il blocco `{isExternal && isRagMode && ...}` che termina a riga ~325), aggiungi l'avviso per il modello audio selezionato:

```tsx
{isAudio && chatMessages.selectedModel === model.id && (
  <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-1 flex items-center gap-1">
    <Volume2 className="w-3 h-3" />
    Questo modello gestisce solo input/output audio
  </p>
)}
```

Il risultato finale per il blocco badge deve essere:

```tsx
<div className="flex items-center gap-2 flex-wrap">
  <span className="font-medium">{model.name}</span>
  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500">{model.provider}</span>
  {isExternal && (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 flex items-center gap-0.5">
      <AlertTriangle className="w-2.5 h-2.5" />
      Esterno
    </span>
  )}
  {isAudio && (
    <span
      title="Questo modello gestisce solo input/output audio"
      className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 flex items-center gap-0.5"
    >
      <Volume2 className="w-2.5 h-2.5" />
      Solo Audio
    </span>
  )}
  {chatMessages.recommendedModel?.id === model.id && (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Consigliato</span>
  )}
</div>
```

- [ ] **Step 3: Verifica TypeScript compile**

```bash
cd /home/marcello/enterprise-ai-chat/frontend
npx tsc --noEmit 2>&1 | grep -E "error TS|ChatPage" | head -10
```

Expected: nessun output (zero errori).

- [ ] **Step 4: Verifica build frontend**

```bash
cd /home/marcello/enterprise-ai-chat/frontend
npm run build 2>&1 | tail -10
```

Expected: `✓ built in` senza errori.

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat(ui): add 'Solo Audio' badge for audio-only models in model selector"
```

---

## Task 4: Version bump 2.1.56 → 2.1.57

**Context:** Ogni deploy K8s richiede un version bump. Tutti i file della lista DEVONO essere aggiornati. Dopo il bump, verifica con grep che non rimangano occorrenze della vecchia versione.

**Files:**
- Modify: `backend/package.json` riga 3
- Modify: `frontend/package.json` riga 3
- Modify: `frontend/src/version.ts` riga 1
- Modify: `frontend/src/pages/PublicMonitorPage.tsx` (cerca `2.1.56`)
- Modify: `vscode-extension/package.json` riga 3
- Modify: `vscode-extension/webview-ui/src/claude-code/MainLayout.tsx` (2 occorrenze)
- Modify: `k8s/backend/deployment.yaml` (image tag)
- Modify: `k8s/frontend/deployment.yaml` (image tag)
- Modify: `k8s/kustomization.yaml` (`app.kubernetes.io/version`)

**NOTA:** `backend/src/services/MCPClientManager.ts` potrebbe contenere la versione — verifica con grep.
**NOTA:** `k8s/mariadb/init-configmap.yaml` contiene `app_version` — verifica se presente.
**NOTA:** `backend-deploy.yaml` (legacy manifest) — verifica se presente.

- [ ] **Step 1: Aggiorna tutti i file della versione**

```bash
cd /home/marcello/enterprise-ai-chat

# backend
sed -i 's/"version": "2\.1\.56"/"version": "2.1.57"/' backend/package.json

# frontend
sed -i 's/"version": "2\.1\.56"/"version": "2.1.57"/' frontend/package.json
sed -i "s/export const APP_VERSION = '2\.1\.56'/export const APP_VERSION = '2.1.57'/" frontend/src/version.ts

# vscode-extension
sed -i 's/"version": "2\.1\.56"/"version": "2.1.57"/' vscode-extension/package.json

# k8s
sed -i 's/enterprise-ai-chat-backend:2\.1\.56/enterprise-ai-chat-backend:2.1.57/' k8s/backend/deployment.yaml
sed -i 's/enterprise-ai-chat-frontend:2\.1\.56/enterprise-ai-chat-frontend:2.1.57/' k8s/frontend/deployment.yaml
sed -i 's/version: "2\.1\.56"/version: "2.1.57"/' k8s/kustomization.yaml
```

- [ ] **Step 2: Aggiorna i file con versione nel testo (manuale)**

Questi file NON supportano sed diretto — usa Edit per aggiornare ogni occorrenza:

- `frontend/src/pages/PublicMonitorPage.tsx` — cerca e sostituisci `2.1.56` → `2.1.57`
- `vscode-extension/webview-ui/src/claude-code/MainLayout.tsx` — 2 occorrenze di `2.1.56` → `2.1.57`

- [ ] **Step 3: Verifica che non rimangano occorrenze vecchie**

```bash
cd /home/marcello/enterprise-ai-chat
grep -rn "2\.1\.56" . \
  --include="*.ts" --include="*.tsx" --include="*.json" \
  --include="*.yaml" --include="*.yml" --include="*.html" \
  | grep -v node_modules | grep -v dist | grep -v package-lock
```

Expected: zero output. Se ci sono occorrenze, aggiornale prima di procedere.

- [ ] **Step 4: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/package.json frontend/package.json frontend/src/version.ts \
        frontend/src/pages/PublicMonitorPage.tsx \
        vscode-extension/package.json \
        vscode-extension/webview-ui/src/claude-code/MainLayout.tsx \
        k8s/backend/deployment.yaml k8s/frontend/deployment.yaml \
        k8s/kustomization.yaml
git commit -m "chore: bump version 2.1.56 → 2.1.57"
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1 copre il fix Ollama GPU crash con retry e test
- ✅ Task 2 copre tutti i mapping HTTP status (401, 429, 404, 503) + Ollama 500
- ✅ Task 3 copre il badge "Solo Audio" con tooltip e avviso when selected
- ✅ Task 4 copre il version bump

**Placeholder scan:** nessun TBD o "handle edge cases" senza codice concreto.

**Type consistency:**
- `OllamaProvider.test.ts` usa `CompletionOptions` che corrisponde al tipo importato in OllamaProvider
- `stream-error.ts` esporta `mapStreamErrorToUserMessage(errorMessage: string, isParlant?: boolean): string` — invariato, compatibile con tutti i chiamanti
- `ChatPage.tsx`: `isAudio` è `boolean`, `model.id` è `string` — tipi coerenti
