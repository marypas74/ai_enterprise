# vLLM Optimization + Async Document Queue — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare il collo di bottiglia CPU/PCIe di vLLM per ottenere latenza primo token bassa con 5 utenti simultanei, e introdurre una coda asincrona con notifica ETA per documenti pesanti (>8K token).

**Architecture:** Due interventi distinti: (1) modifica parametri vLLM in docker-compose per rimuovere cpu-offload e abilitare chunked prefill; (2) nuovo sistema job queue Redis nel backend enterprise-ai-chat con badge/toast nel frontend.

**Tech Stack:** vLLM 0.18.x, Docker Compose, Redis (già in stack), Fastify 5, React 18, Zustand, WebSocket (già in uso), TypeScript.

---

## Sistema 1 — Ottimizzazione vLLM/Ollama

### Contesto

La configurazione attuale ha due problemi critici per la latenza:

1. **`--cpu-offload-gb=20`**: 20 GB di pesi del modello sono su RAM di sistema. Ad ogni inferenza i pesi attraversano il bus PCIe (CPU → GPU), causando TTFT di 10-30s anche per prompt brevi.
2. **`--max-model-len=131072`**: 128K context richiede un KV cache enorme. Con `--gpu-memory-utilization=0.92` quasi tutta la VRAM è occupata e non resta spazio libero.

### Modifiche docker-compose (`/home/marcello/vllm/docker-compose.yml`)

| Parametro | Valore attuale | Valore nuovo | Motivazione |
|-----------|---------------|-------------|-------------|
| `--cpu-offload-gb=20` | presente | **rimosso** | Causa principale TTFT alto |
| `--max-model-len` | `131072` | `65536` | Libera ~5 GB VRAM per KV cache |
| `--gpu-memory-utilization` | `0.92` | `0.88` | Headroom per spike Ollama (keep_alive=30s) |
| `--enable-chunked-prefill` | assente | **aggiunto** | Interleave prefill+decode → primo token anticipato |
| `--max-num-batched-tokens` | `8192` | `2048` | Con chunked prefill batch piccoli = TTFT minore |
| `--max-num-seqs` | assente | `8` | Cap sessioni concorrenti (5 utenti + headroom) |

**Stima VRAM post-modifica (RTX 5090 31.4 GB):**
- Pesi Qwen2.5-VL-32B AWQ: ~18 GB
- KV cache fp8 a 64K context, 8 sessioni simultanee: ~9 GB
- Totale occupato: ~27 GB
- VRAM budget con `--gpu-memory-utilization=0.88`: 27.6 GB ✓

### Ollama

`OLLAMA_KEEP_ALIVE=30s` già configurato e attivo (`/home/marcello/k8s-ollama/docker-compose.yml`). Nessuna modifica ulteriore necessaria.

---

## Sistema 2 — Coda Asincrona Documenti

### Principio di funzionamento

Ogni richiesta chat viene classificata da un **Token Estimator** prima di essere inviata a vLLM:

- **≤ 8.000 token** → flusso immediato normale (nessun cambiamento per l'utente)
- **> 8.000 token** → accodata in Redis, risposta differita con ETA, utente può continuare a lavorare

La soglia di 8.000 token corrisponde a ~11 pagine di testo o ~8 pagine come immagini (Qwen2.5-VL).

### Flusso completo

```
Utente invia messaggio
        │
        ▼
[Token Estimator]
tokenEstimator.ts
        │
   > 8K token?
   ┌────┴────┐
  NO        SÌ
   │         │
   ▼         ▼
Flusso   [DocumentJobQueue.enqueue()]
normale   Salva job in Redis
          Calcola ETA
          Risponde al client:
          { jobId, eta, status:"queued" }
               │
               ▼
          completions.ts inserisce messaggio
          placeholder nella conversazione:
          "Documento ricevuto — risposta attesa in ~X min"
               │
               ▼
          Frontend: aggiorna useJobStore
          → AsyncJobBadge mostra "🔄 1 in elaborazione"
               │
               ▼
          [DocumentJobWorker] (loop continuo)
          Pop job da Redis LIST
          Chiama vLLM
          Salva risposta in DB (sostituisce placeholder)
          Emette WebSocket: { type:"job_complete", jobId, conversationId }
               │
               ▼
          Frontend: useJobNotifications riceve evento
          → rimuove job da useJobStore
          → mostra toast: "Risposta pronta per il tuo documento"
          → messaggio appare nella conversazione originale
```

### Stima ETA

```typescript
// ETA in secondi
const eta = Math.ceil(
  (estimatedTokens / avgTokensPerSec) * queuePosition
);
// avgTokensPerSec aggiornato dopo ogni job completato (media scorrevole ultimi 5)
// queuePosition = numero job con status "pending" davanti al corrente
// Valore iniziale avgTokensPerSec = 50 tok/s (conservativo) finché non ci sono job completati
```

**Stima token immagini — fallback per dimensioni sconosciute:**
- Se le dimensioni sono disponibili: `Math.ceil(width * height / 560)`
- Se le dimensioni non sono disponibili (base64 puro): `Math.ceil(base64Length * 0.75 / 560 * 100)` (stima da dimensione file)
- Default conservativo se nessuna info disponibile: `1000 token per immagine`

### Struttura dati Redis

```
doc:jobs            → Redis LIST  (FIFO queue, contiene jobId)
doc:job:{uuid}      → Redis HASH  {
                        userId, conversationId, messageId,
                        status,           // "pending" | "processing" | "done" | "error"
                        estimatedTokens,
                        createdAt,        // ISO timestamp
                        startedAt,        // ISO timestamp (quando worker inizia)
                        completedAt,      // ISO timestamp
                        errorMessage      // solo se status="error"
                      }
doc:metrics         → Redis HASH  {
                        avgTokensPerSec,  // media scorrevole
                        jobsCompleted     // contatore totale
                      }
```

TTL di ogni job hash: 24 ore (pulizia automatica).

### File da creare/modificare

**Backend (`backend/src/`):**

| File | Operazione | Responsabilità |
|------|-----------|----------------|
| `utils/tokenEstimator.ts` | **Crea** | Stima token da testo (`chars/4`) e immagini (`w*h/560`) |
| `services/DocumentJobQueue.ts` | **Crea** | enqueue, dequeue, getStatus, calculateEta, updateMetrics |
| `services/DocumentJobWorker.ts` | **Crea** | Worker loop: pop → vLLM → salva msg → WS notify. Avviato in `src/index.ts` all'avvio del backend (`worker.start()`) |
| `modules/chat/completions.ts` | **Modifica** | Intercetta richieste >8K, smista a queue o flusso normale |
| `modules/chat/routes.ts` | **Modifica** | Aggiunge `GET /api/chat/jobs/:jobId` per status polling |

**Frontend (`frontend/src/`):**

| File | Operazione | Responsabilità |
|------|-----------|----------------|
| `stores/useJobStore.ts` | **Crea** | Zustand store: lista job pendenti, ETA, aggiornamenti |
| `hooks/useJobNotifications.ts` | **Crea** | Listener WebSocket per `job_complete`, aggiorna store |
| `components/AsyncJobBadge.tsx` | **Crea** | Badge header con contatore + ETA aggregato + click → lista |

### Comportamento con più job in coda

Se arrivano 2 documenti pesanti in sequenza:
- Job 1 entra in coda → ETA 4 min → badge "🔄 1 in elaborazione"
- Job 2 entra in coda → ETA 9 min (ETA job1 + elaborazione job2) → badge "🔄 2 in elaborazione"
- Clic sul badge → mostra lista con ETA individuali per conversazione

### Gestione errori

- **vLLM timeout/errore**: job passa a `status="error"`, messaggio nella conversazione: *"Elaborazione non riuscita — riprova con un documento più breve"*
- **Worker crash**: job rimane in Redis con `status="processing"`. Al riavvio del worker, i job "processing" da più di 10 minuti vengono riportati a "pending" e rielaborati (at-least-once delivery)
- **Documento > 64K token**: Token Estimator lo rileva, risponde con suggerimento di divisione del documento prima dell'accodamento

---

## Dipendenze e ordine di implementazione

1. **Prima**: ottimizzazione vLLM (nessuna dipendenza, deploy immediato)
2. **Poi**: Token Estimator + DocumentJobQueue (fondamenta del sistema async)
3. **Poi**: DocumentJobWorker (dipende da Queue)
4. **Poi**: integrazione in completions.ts + routes (dipende da Worker)
5. **Poi**: frontend (store + hook + badge) — può procedere in parallelo con step 3-4

---

## Criteri di successo

- TTFT per documenti ≤ 8K token: **< 3 secondi** (dal clic "Invia" al primo token visualizzato)
- 5 utenti simultanei con documenti medi: nessuna degradazione percepibile
- Documenti > 8K: ETA mostrato entro 500ms dalla richiesta
- Notifica badge al completamento: latenza WebSocket < 1s
- Nessuna perdita di job in caso di riavvio del worker
