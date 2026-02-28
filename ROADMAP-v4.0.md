# Roadmap v4.0 — Claude Platform Integration & Efficiency Improvements

> Basata sull'analisi della documentazione Claude Platform (Feb 2026) e cross-reference con l'architettura attuale di enterprise-ai-chat v1.7.9.
> Creata: 2026-02-28

---

## Stato Attuale (v1.7.9)

### Funzionalità Implementate
- Multi-provider: OpenAI, Anthropic (OAuth), Google Gemini, Ollama, Custom
- Tool calling: 19+ strumenti built-in + MCP dinamico, loop 5 round
- Streaming SSE con notifiche tool in tempo reale
- Memoria vettoriale 4-tier (Qdrant): episodica, dichiarativa, procedurale, working
- Elaborazione documenti: PDF, DOCX, XLSX, PPTX, OCR (Tesseract + Ollama vision)
- Generazione documenti: DOCX, XLSX, PPTX
- Sandbox Python isolata con bridge HTTP autenticato
- Claude Agent SDK integrato
- Admin panel completo per provider/modelli/configurazione

### Funzionalità Mancanti (gap rispetto alla piattaforma Claude)
- Prompt caching (cache_control)
- Extended thinking / Adaptive thinking
- Citations API native
- Batch Processing API
- Token counting pre-invio
- Structured Outputs (JSON mode + strict tool use)
- Server-side web search tool nativo
- Files API
- Native PDF support (document blocks)
- Fine-grained tool streaming
- Context compaction/editing
- Provider fallback chains
- Embedding caching
- Costo per utente aggregato

---

## Fase 1 — Risparmio Costi & Performance (Priorità CRITICA)

**Impatto stimato: riduzione costi API 50-90%, latenza -40%**
**Effort: ~3-4 giorni**

### 1.1 Prompt Caching per Anthropic
**Priorità: CRITICA | Risparmio: fino a 90% sui token ripetuti**

Il system prompt, le tool definitions e la cronologia conversazione vengono inviati ad ogni richiesta. Con il prompt caching di Anthropic:
- **Cache 5 min**: write cost 25% extra, read cost 90% risparmio
- **Cache 1 ora**: per contesti meno frequenti
- **Automatic caching**: un singolo `cache_control` al top-level

**Implementazione:**
```typescript
// In providers.ts — AnthropicProvider.streamComplete()
const requestBody = {
  model,
  max_tokens,
  cache_control: { type: "ephemeral" }, // Automatic caching
  system: [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" } // Cache system prompt
    }
  ],
  // ...messages
};
```

**File coinvolti:**
- `backend/src/modules/ai/providers.ts` — aggiungere `cache_control` a system prompt e messaggi
- `backend/src/modules/chat/routes.ts` — tracciare metriche cache (cache_read_input_tokens, cache_creation_input_tokens)
- `backend/src/modules/admin/` — opzione UI per abilitare/disabilitare caching

**Metriche da tracciare:**
- `cache_read_input_tokens` / `cache_creation_input_tokens` nella risposta
- Rapporto cache hit/miss per conversazione
- Risparmio costi effettivo vs. baseline

### 1.2 Token Counting Pre-Invio
**Priorità: ALTA | Beneficio: prevenzione errori context window, routing intelligente**

L'endpoint `/v1/messages/count_tokens` è gratuito e permette di:
- Contare token prima dell'invio (evitare errori context window)
- Routing model intelligente (messaggi corti → Haiku, lunghi → Sonnet)
- Stima costi pre-risposta per l'utente

**Implementazione:**
```typescript
// Nuovo: backend/src/services/TokenCountService.ts
export async function countTokens(
  model: string, messages: Message[], tools?: Tool[], system?: string
): Promise<{ input_tokens: number }> {
  // Chiama Anthropic count_tokens endpoint
}

// In routes.ts — prima di chiamare streamComplete
const tokenCount = await countTokens(model, messages, tools, systemPrompt);
if (tokenCount.input_tokens > modelContextWindow * 0.9) {
  // Auto-summarize o avvisa l'utente
}
```

**File coinvolti:**
- `backend/src/services/TokenCountService.ts` (NUOVO)
- `backend/src/modules/ai/providers.ts` — metodo countTokens per provider
- `backend/src/modules/chat/routes.ts` — integrazione pre-invio

### 1.3 Embedding Caching con Redis
**Priorità: MEDIA | Beneficio: riduzione chiamate API embeddings ~60%**

Gli embedding per lo stesso testo vengono ricalcolati ogni volta. Cache basata su hash SHA-256 del contenuto.

**Implementazione:**
```typescript
// In EmbeddingService.ts
const cacheKey = `emb:${createHash('sha256').update(text).digest('hex')}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);
const embedding = await generateFromProvider(text);
await redis.setex(cacheKey, 86400, JSON.stringify(embedding)); // TTL 24h
```

**File coinvolti:**
- `backend/src/services/EmbeddingService.ts` — aggiungere layer cache Redis

---

## Fase 2 — Qualità Risposte & Reasoning (Priorità ALTA)

**Impatto: risposte più accurate, ragionamento complesso, output verificabili**
**Effort: ~4-5 giorni**

### 2.1 Extended Thinking / Adaptive Thinking
**Priorità: ALTA | Beneficio: ragionamento profondo per task complessi**

Claude supporta "extended thinking" che produce blocchi `thinking` con il ragionamento interno. Per Opus 4.6: usare **adaptive thinking** (`thinking: {type: "adaptive"}`) con il parametro `effort`.

**Implementazione:**
```typescript
// In providers.ts — AnthropicProvider
if (isThinkingModel(model)) {
  requestBody.thinking = model.includes('opus-4-6')
    ? { type: "adaptive" }  // Opus 4.6: adaptive
    : { type: "enabled", budget_tokens: 16000 }; // Altri modelli: manual
}
```

**UI Frontend:**
- Toggle "Deep Thinking" nel pannello chat
- Visualizzazione collassabile dei blocchi `thinking`
- Indicatore "thinking..." durante il ragionamento

**File coinvolti:**
- `backend/src/modules/ai/providers.ts` — parsing blocchi `thinking` nello stream
- `backend/src/modules/chat/routes.ts` — forwarding blocchi thinking via SSE
- `frontend/src/components/chat/` — UI per thinking blocks
- `backend/src/services/ModelConfigService.ts` — flag `supports_thinking` per modello
- DB: aggiungere colonna `supports_thinking` a `ai_models`

### 2.2 Citations API Native
**Priorità: ALTA | Beneficio: risposte verificabili con fonti esatte**

Claude può fornire citazioni precise (indice carattere, pagina, blocco) quando analizza documenti. Il `cited_text` non conta come output tokens.

**Implementazione:**
```typescript
// Quando ci sono allegati nella conversazione
const documentBlocks = attachments.map(att => ({
  type: "document",
  source: { type: "text", media_type: "text/plain", data: att.content },
  title: att.filename,
  citations: { enabled: true }
}));
```

**UI Frontend:**
- Citazioni inline con tooltip che mostra il testo originale
- Click su citazione → highlight nel documento originale
- Icona "fonte" accanto ai claim citati

**File coinvolti:**
- `backend/src/modules/ai/providers.ts` — formatAnthropicMessages con document blocks + citations
- `backend/src/modules/chat/routes.ts` — parsing citations_delta nello stream SSE
- `frontend/src/components/chat/MessageBubble.tsx` — rendering citazioni

### 2.3 Structured Outputs (JSON Mode)
**Priorità: MEDIA | Beneficio: output garantiti conformi a schema**

Due approcci complementari:
1. **JSON outputs** (`output_config.format`): risposte JSON con schema definito
2. **Strict tool use** (`strict: true`): validazione schema garantita sugli input dei tool

**Implementazione:**
```typescript
// Per tool definitions — aggiungere strict: true
const toolDef = {
  name: "generate_excel_document",
  description: "...",
  input_schema: { /* ... */ },
  strict: true  // Schema validation garantita
};

// Per risposte strutturate
const response = await client.messages.create({
  model,
  output_config: {
    format: {
      type: "json_schema",
      json_schema: mySchema
    }
  }
});
```

**File coinvolti:**
- `backend/src/services/ToolService.ts` — aggiungere `strict: true` alle definizioni tool
- `backend/src/modules/ai/providers.ts` — supporto `output_config.format`
- `backend/src/modules/chat/routes.ts` — opzione per richiedere output strutturato

---

## Fase 3 — Elaborazione Documenti Avanzata (Priorità MEDIA)

**Impatto: PDF handling nativo, analisi documenti più accurata**
**Effort: ~3-4 giorni**

### 3.1 Native PDF Support via Claude API
**Priorità: MEDIA | Beneficio: analisi PDF visuale senza OCR esterno**

Claude supporta nativamente i PDF come `document` blocks (base64, URL, o file_id). Analizza sia testo che immagini/grafici. Elimina la necessità di Tesseract/Poppler per molti PDF.

**Implementazione:**
```typescript
// In context injection — per allegati PDF
if (attachment.mime_type === 'application/pdf' && provider === 'anthropic') {
  // Invio diretto come document block (max 100 pagine, 32MB)
  contentBlocks.push({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
    title: attachment.filename,
    citations: { enabled: true },
    cache_control: { type: "ephemeral" } // Cache per domande successive
  });
} else {
  // Fallback: OCR locale per altri provider
}
```

**Vantaggi rispetto all'approccio attuale:**
- Comprensione visiva di grafici, tabelle, diagrammi
- Citazioni con numero di pagina
- Compatibile con prompt caching (cache il PDF, domanda multiple)
- Nessuna dipendenza da Tesseract/Poppler per provider Anthropic

**File coinvolti:**
- `backend/src/modules/chat/routes.ts` — context injection con document blocks per Anthropic
- `backend/src/services/DocumentProcessorService.ts` — bypass OCR se provider Anthropic
- `backend/src/modules/ai/providers.ts` — formatAnthropicMessages con document blocks

### 3.2 Search Results API per RAG
**Priorità: MEDIA | Beneficio: citazioni web-quality per knowledge base**

L'API `search_results` permette citazioni naturali per applicazioni RAG. Invece di iniettare chunks come testo, si inviano come search results strutturati.

**Implementazione:**
```typescript
// In context injection — per chunks da VectorStore
const searchResults = relevantChunks.map(chunk => ({
  type: "search_result",
  source: chunk.metadata.source,
  title: chunk.metadata.title,
  content: [{ type: "text", text: chunk.text }],
  citations: { enabled: true }
}));
```

**File coinvolti:**
- `backend/src/modules/chat/routes.ts` — search_results blocks per RAG chunks
- `backend/src/services/VectorStoreService.ts` — arricchire chunks con metadata fonte

---

## Fase 4 — Scalabilità & Automazione (Priorità MEDIA-BASSA)

**Impatto: riduzione costi batch 50%, automazione workflow, resilienza**
**Effort: ~3-4 giorni**

### 4.1 Batch Processing API
**Priorità: MEDIA | Beneficio: 50% risparmio su operazioni bulk**

Per workflow non-interattivi (analisi documenti batch, generazione report, moderazione contenuti):
- 50% sconto su tutti i token
- Fino a 100.000 richieste per batch
- Risultati entro 24h (tipicamente <1h)

**Casi d'uso nel progetto:**
1. **Analisi batch allegati**: processare N documenti caricati in parallelo
2. **Generazione report**: creare report multipli da template
3. **Re-embedding batch**: ri-generare embeddings per contenuti aggiornati
4. **Moderazione contenuti**: analizzare conversazioni storiche

**Implementazione:**
```typescript
// Nuovo: backend/src/services/BatchProcessingService.ts
export async function submitBatch(requests: BatchRequest[]): Promise<string> {
  const batch = await anthropic.messages.batches.create({ requests });
  return batch.id;
}

export async function pollBatch(batchId: string): Promise<BatchResult[]> {
  // Poll fino a processing_status === 'ended'
  // Stream results con client.messages.batches.results()
}
```

**File coinvolti:**
- `backend/src/services/BatchProcessingService.ts` (NUOVO)
- `backend/src/modules/admin/` — UI gestione batch
- DB: tabella `batch_jobs` per tracking

### 4.2 Provider Fallback Chain
**Priorità: MEDIA | Beneficio: zero downtime per singolo provider**

Se il provider primario fallisce (rate limit, outage), auto-fallback al secondario.

**Implementazione:**
```typescript
// In providers.ts
const FALLBACK_CHAIN = {
  'anthropic': ['openai', 'google'],
  'openai': ['anthropic', 'google'],
  'google': ['anthropic', 'openai'],
};

async function completeWithFallback(options) {
  for (const provider of [primaryProvider, ...fallbackProviders]) {
    try {
      return await provider.streamComplete(options);
    } catch (err) {
      if (isRetryableError(err)) continue;
      throw err;
    }
  }
}
```

**File coinvolti:**
- `backend/src/modules/ai/providers.ts` — wrapper fallback
- `backend/src/services/ModelConfigService.ts` — configurazione fallback chain
- DB: tabella `provider_fallback_config`

### 4.3 Fine-Grained Tool Streaming
**Priorità: BASSA | Beneficio: riduzione latenza tool calls**

Streaming dei parametri tool senza buffering/JSON validation, riducendo la latenza per parametri grandi.

**File coinvolti:**
- `backend/src/modules/ai/providers.ts` — parsing incrementale tool parameters
- `backend/src/modules/chat/routes.ts` — forwarding deltas al client

---

## Fase 5 — Server-Side Tools & MCP Connector (Priorità BASSA)

**Impatto: ricerca web nativa, code execution cloud, riduzione complessità**
**Effort: ~2-3 giorni**

### 5.1 Server-Side Web Search Tool
**Priorità: BASSA | Beneficio: ricerca web con citazioni native, zero infrastruttura**

Claude ha un web search tool server-side (`web_search_20260209`) che esegue ricerche direttamente sui server Anthropic. Citazioni automatiche incluse.

**Pro vs. implementazione attuale:**
- Nessuna API key Brave/Serper/Google da gestire
- Citazioni native con URL verificati
- Dynamic filtering con code execution (Opus/Sonnet 4.6)
- $10/1000 ricerche

**Contro:**
- Solo per provider Anthropic
- Meno controllo sui risultati
- L'implementazione attuale funziona con tutti i provider

**Decisione:** Mantenere l'implementazione attuale come default. Aggiungere opzione per usare il tool nativo quando il provider è Anthropic.

### 5.2 MCP Connector Nativo
**Priorità: BASSA | Beneficio: connessione diretta a MCP server remoti**

Il MCP connector permette di connettere MCP server remoti direttamente dalla Messages API senza implementare un client MCP.

**Nota:** enterprise-ai-chat ha già `MCPClientManager.ts` che gestisce connessioni MCP. Il connector nativo potrebbe semplificare per MCP server remoti specifici ma non sostituisce completamente l'implementazione attuale.

---

## Fase 6 — Context Management Avanzato (Priorità FUTURA)

### 6.1 Context Compaction
Server-side context summarization per conversazioni lunghe. Quando il contesto si avvicina al limite, l'API riassume automaticamente le parti precedenti.

### 6.2 Context Editing
Gestione automatica del contesto con strategie configurabili: pulizia tool results, gestione thinking blocks.

### 6.3 1M Token Context Window
Finestra di contesto estesa fino a 1M token per documenti grandi o conversazioni molto lunghe (beta).

---

## Riepilogo Priorità e Impatto

| Fase | Feature | Priorità | Risparmio/Beneficio | Effort |
|------|---------|----------|---------------------|--------|
| 1.1 | Prompt Caching | CRITICA | 50-90% costi ripetuti | 1 giorno |
| 1.2 | Token Counting | ALTA | Prevenzione errori, routing | 0.5 giorni |
| 1.3 | Embedding Caching | MEDIA | 60% chiamate API | 0.5 giorni |
| 2.1 | Extended/Adaptive Thinking | ALTA | Ragionamento profondo | 2 giorni |
| 2.2 | Citations API | ALTA | Risposte verificabili | 1.5 giorni |
| 2.3 | Structured Outputs | MEDIA | Output garantiti | 1 giorno |
| 3.1 | Native PDF Support | MEDIA | Analisi visiva, no OCR | 1.5 giorni |
| 3.2 | Search Results RAG | MEDIA | Citazioni per RAG | 1 giorno |
| 4.1 | Batch Processing | MEDIA | 50% costi bulk | 1.5 giorni |
| 4.2 | Provider Fallback | MEDIA | Zero downtime | 1 giorno |
| 4.3 | Fine-Grained Streaming | BASSA | Latenza ridotta | 0.5 giorni |
| 5.1 | Server-Side Web Search | BASSA | Citazioni native | 1 giorno |
| 5.2 | MCP Connector | BASSA | Semplificazione MCP | 0.5 giorni |
| 6.x | Context Management | FUTURA | Conversazioni lunghe | TBD |

**Effort totale stimato: ~14-16 giorni**

---

## Piano di Esecuzione Raccomandato

### Sprint 1 (Settimana 1): Cost Optimization
1. Prompt Caching (1.1) — impatto immediato sui costi
2. Token Counting (1.2) — prevenzione errori
3. Embedding Caching (1.3) — riduzione chiamate

### Sprint 2 (Settimana 2): Quality & Reasoning
4. Extended Thinking (2.1) — ragionamento profondo
5. Citations API (2.2) — risposte verificabili

### Sprint 3 (Settimana 3): Documents & Structure
6. Native PDF Support (3.1) — elimina dipendenze OCR per Anthropic
7. Structured Outputs (2.3) — output garantiti
8. Search Results RAG (3.2) — citazioni per knowledge base

### Sprint 4 (Settimana 4): Scale & Resilience
9. Batch Processing (4.1) — costi bulk
10. Provider Fallback (4.2) — resilienza
11. Fine-Grained Streaming (4.3) — latenza

### Backlog
12. Server-Side Web Search (5.1)
13. MCP Connector (5.2)
14. Context Management (6.x)

---

## Note Tecniche

### Compatibilità Multi-Provider
Molte feature (prompt caching, citations, extended thinking, structured outputs) sono specifiche per Anthropic. L'implementazione deve:
1. Verificare il provider attivo prima di applicare feature specifiche
2. Graceful degradation: se il provider non supporta una feature, usare il fallback
3. Metriche separate per provider per tracciare l'efficacia

### Backward Compatibility
Tutte le feature sono additive — nessuna modifica breaking al flusso esistente. Le feature vengono attivate tramite:
- Configurazione admin (toggle per feature)
- Capability model (`supports_thinking`, `supports_citations`, etc.)
- Auto-detection basata sul provider

### Testing Strategy
Per ogni feature:
1. Unit test per la logica di formattazione/parsing
2. Integration test con mock API
3. Test manuale con API reale (solo in staging)
4. Monitoraggio metriche per 48h post-deploy
