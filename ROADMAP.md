# ROADMAP DI SVILUPPO — Enterprise AI Chat

> Documento generato il 2026-02-26 | Versione corrente: 1.6.1

---

## STATO ATTUALE DEL SISTEMA

### Componenti ATTIVI
| Componente | Stato | Note |
|---|---|---|
| Chat multi-modello (14 modelli Ollama) | Funzionante | Sync worker ogni 5 min |
| Web Search (DuckDuckGo + Google) | Funzionante | Auto-detect keyword |
| Web Scraping | Funzionante | SSRF protection |
| Document Processing (PDF, DOCX, XLSX, PPTX, OCR) | Funzionante | Microservizio separato |
| Tool Service (file I/O, doc generation) | Funzionante | Audit log completo |
| Working Memory (Redis) | Funzionante | TTL 2h per sessione |
| Persistent Memory (SQL observations) | Funzionante | Auto-capture, fulltext search |
| EventBus / Hook System (23 hook points) | Funzionante | Priority-based, timeout protection |
| Plugin Loader (Mad Hatter) | Funzionante | Discovery, attivazione, settings |
| LLM Sync Worker | Funzionante | Config sync 2min, model sync 5min |
| Prompt Templates | Funzionante | Customizzabili da admin |
| Metrics Dashboard | Funzionante | CPU, GPU, RAM, pods, containers |

### Componenti IMPLEMENTATI ma NON ATTIVI (mancano prerequisiti)
| Componente | Blocco | File Principale |
|---|---|---|
| Vector Memory (Qdrant 3 collections) | Qdrant non deployato + no embedding model | VectorMemoryService.ts |
| Auto-RAG (AgentChain pipeline) | Qdrant + embeddings + auto_rag_enabled=false | AgentChainService.ts |
| Episodic Memory storage | Qdrant + embeddings | VectorMemoryService.ts |
| Declarative Memory (knowledge base) | Qdrant + embeddings | VectorMemoryService.ts |
| Procedural Memory (tool selection semantico) | Qdrant + embeddings | ProceduralMemoryService.ts |
| HyDE (Hypothetical Document Embeddings) | Embeddings + disabled by default | HyDEService.ts |
| RabbitHole (document ingestion pipeline) | Qdrant + embeddings + tabella web_ingestions mancante | RabbitHoleService.ts |
| Classification Service | Embeddings | ClassificationService.ts |

### Componenti SCAFFOLDED ma NON COMPLETATI
| Componente | Completamento | Cosa Manca |
|---|---|---|
| Agent Orchestrator | 80% | Git worktree, PTY/terminal integration |
| Claude Agent SDK | 60% | MCP server wiring, permission modes |
| Parlant Integration | 40% | Chat routing, API keys, guidelines UI |
| MCP Client Runtime | 20% | Server spawning, tool discovery, connection pool |
| Conversational Forms | 85% | Auto-trigger da chat, callback execution |
| Scheduler (White Rabbit) | 60% | Tabelle DB mancanti, job execution |
| Ralph Loop (iterazione AI) | 70% | UI controls, completion detection |
| Browser Automation | 0% | Non presente |

---

## FASE 1 — INFRASTRUTTURA VECTOR MEMORY (Settimana 1)
**Obiettivo**: Sbloccare il 70% del codice gia' scritto

### 1.1 Deploy Qdrant in Kubernetes
- Creare `k8s/qdrant/` con StatefulSet + Service + PVC
- Image: `qdrant/qdrant:v1.12.1`
- Port: 6333 (REST) + 6334 (gRPC)
- PVC: 2Gi iniziale, espandibile
- Resource limits: 512Mi RAM, 500m CPU
- Health check: `/healthz`
- **Effort**: Medio

### 1.2 Pull embedding model su Ollama
```bash
docker exec ollama ollama pull nomic-embed-text
```
- nomic-embed-text: 137MB, 768 dimensioni, ottimo per RAG locale
- Alternativa: mxbai-embed-large (1024d, piu' preciso ma piu' lento)
- **Effort**: 2 minuti

### 1.3 Seed embedding model nel database
```sql
INSERT INTO ai_models (provider_id, model_id, display_name, description, model_type,
  is_enabled, supports_streaming, sort_order)
VALUES (4, 'nomic-embed-text', 'Nomic Embed Text', 'Embedding model per ricerca semantica (768d)',
  'embedding', TRUE, FALSE, 1);
```
- **Effort**: 5 minuti

### 1.4 Configurare QDRANT_URL nel backend deployment
- Aggiungere env var `QDRANT_URL=http://qdrant:6333` in `k8s/backend/deployment.yaml`
- **Effort**: 5 minuti

### 1.5 Fix auth header su Ollama embedding
- `EmbeddingService.ts` -> aggiungere `X-Ollama-Key` header nella funzione `generateOllamaEmbedding()`
- Stesso fix gia' applicato a chat e admin
- **Effort**: 10 minuti

### 1.6 Abilitare Auto-RAG per utenti
```sql
UPDATE memory_settings SET auto_rag_enabled = 1 WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');
-- Oppure per tutti:
UPDATE memory_settings SET auto_rag_enabled = 1;
```
- **Effort**: 2 minuti

### 1.7 Creare tabelle DB mancanti (migration)
```sql
CREATE TABLE IF NOT EXISTS web_ingestions (...);
CREATE TABLE IF NOT EXISTS scheduled_jobs (...);
CREATE TABLE IF NOT EXISTS job_executions (...);
```
- **Effort**: 30 minuti

---

## FASE 2 — OTTIMIZZAZIONE RETRIEVAL (Settimana 2)
**Obiettivo**: Migliorare qualita' delle risposte con contesto semantico

### 2.1 Attivare HyDE
```sql
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('hyde_config', '{"enabled":true,"maxTokens":150,"maxQueryLength":500}')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
```
- Usa un LLM leggero (qwen2.5:3b) per generare risposte ipotetiche
- Migliora retrieval del 15-25% su query brevi

### 2.2 Tuning parametri recall
| Collection | K (risultati) | Threshold | Razionale |
|---|---|---|---|
| Episodic | 5 | 0.65 | Piu' contesto storico, soglia bassa per catturare piu' conversazioni |
| Declarative | 5 | 0.60 | Knowledge base: meglio piu' risultati con filtro successivo |
| Procedural | 3 | 0.80 | Tool selection: serve alta precisione |

### 2.3 Aggiungere reranking (post-retrieval)
- Dopo recall da Qdrant, secondo passaggio con LLM leggero
- Riordina risultati per rilevanza reale vs solo similarita' coseno
- Pattern: retrieve 10 → rerank → keep top 3
- **Effort**: Alto

### 2.4 Hybrid search (BM25 + vector)
- Combinare MySQL FULLTEXT (keyword) con Qdrant (semantic)
- Reciprocal Rank Fusion (RRF) per unire i ranking
- Migliora recall su query con termini tecnici specifici
- **Effort**: Alto

### 2.5 Chunk overlap ottimizzato
- Attuale: 200 chars statico
- Target: 15-20% della chunk_size (dinamico)
- Aggiungere sentence-boundary chunking (spezzare a fine frase, non a meta')
- Aggiungere section-aware chunking (mantenere headers con contenuto)
- **Effort**: Medio

---

## FASE 3 — PERFORMANCE CHAT PER TUTTI I MODELLI (Settimana 2-3)
**Obiettivo**: Ogni modello risponde al massimo delle sue capacita'

### 3.1 System prompt per famiglia modello
| Famiglia | Stile Ottimale | Note |
|---|---|---|
| Qwen 2.5 | Diretto, strutturato, supporta tool_call | Ottimo per coding |
| Gemma 2 | Conciso, no markdown pesante | Modello piccolo, prompt brevi |
| Phi 3/4 | Istruzioni chiare, step-by-step | Buono per ragionamento |
| GLM 4 | Naturale, NO tools | Non supporta function calling |
| Mixtral 8x7B | Dettagliato, multilingua | MoE, buono per testi lunghi |
| Mistral | Bilanciato | Generalista solido |
| CodeLlama | Solo codice, minimale prose | Specializzato |
| LLaVA | Multimodale (testo + immagini) | Serve gestione input immagine |
| DeepSeek Coder v2 | Codice + ragionamento | Ottimo per debug |

### 3.2 Context window adattivo
- Leggere `context_window` da `ai_models` e adattare:
  - N. messaggi history (piccolo: 5, grande: 20)
  - Max chunk context (piccolo: 500 chars, grande: 2000)
  - Recall K (piccolo: 2, grande: 5)
- **Effort**: Medio

### 3.3 Light mode per modelli piccoli (< 3B)
- Prompt system ridotto (< 500 token)
- No episodic memory injection (troppo contesto)
- Solo declarative memory (knowledge diretto)
- Meno tool definitions
- **Effort**: Medio

### 3.4 Parametri ottimali per modello
- Salvare nel DB: temperature, top_p, repeat_penalty, num_predict
- Applicare automaticamente nel provider
- Default sensibili per famiglia
- **Effort**: Basso

### 3.5 Timeout adattivo
- Modelli grandi (Mixtral 47B): 300s
- Modelli medi (Qwen 7B): 120s
- Modelli piccoli (< 3B): 60s
- Leggere da config DB, non hardcodato
- **Effort**: Basso

### 3.6 Fallback chain automatico
- Se modello fallisce (timeout/OOM), provare il successivo per priorita'
- Log del fallback per analisi
- Notifica utente del cambio modello
- **Effort**: Medio

---

## FASE 4 — INTEGRAZIONE AGENT E PLUGIN (Settimana 3-4)
**Obiettivo**: Attivare tutti i sistemi agent/plugin gia' implementati

### 4.1 Collegare AgentChainService alla chat pipeline
**Stato attuale**: Il codice esiste ma non viene chiamato dal chat handler
**Azione**:
- Integrare `AgentChainService.execute()` nel flusso chat principale
- Pipeline: Memory Recall → Procedures Agent → Memory Agent → LLM Call
- Iniettare contesto richiamato nel system prompt
- **Effort**: Alto (punto critico)

### 4.2 Attivare Tool Execution nella chat
**Stato attuale**: ToolService ha 10+ tool built-in ma non vengono passati al LLM
**Azione**:
- Passare tool definitions al LLM (per modelli che supportano function calling)
- Implementare tool execution loop: LLM chiede tool → backend esegue → risultato torna al LLM
- Rispettare user_tool_permissions per tool approval
- Loggare in tool_executions per audit
- **Effort**: Alto

### 4.3 Attivare Conversational Forms nella chat
**Stato attuale**: Form designer completo, state machine implementata, ma non trigger automatico
**Azione**:
- Implementare form trigger detection: confrontare `start_examples` con messaggio utente
- Quando form attivo: iniettare extraction prompt nel system message
- Gestire stato: incomplete → complete → wait_confirm → closed
- Eseguire on_complete_action (save, webhook, plugin_action)
- **Effort**: Medio

### 4.4 Completare Agent Orchestrator
**Stato attuale**: 80% — session management, slot tracking, template system
**Azione**:
- Implementare PTY/terminal management per agenti code
- Collegare git worktree operations
- Merge conflict resolution workflow
- Task queue processing (agent_task_queue table)
- **Effort**: Alto

### 4.5 Attivare Claude Agent SDK
**Stato attuale**: 60% — Service creato, routes SSE definite
**Azione**:
- Implementare agent run con MCP server configs dal DB
- Permission modes (default, acceptEdits, bypassPermissions)
- Working directory isolation per sessione
- Streaming risposta SSE al frontend
- **Effort**: Alto

### 4.6 Integrare Parlant nel flusso chat
**Stato attuale**: 40% — deployment K8s, proxy routes, UI base
**Azione**:
- Configurare API keys reali in K8s secrets
- Implementare routing conversazione: utente sceglie "Parlant Agent" dal dropdown
- Sincronizzare guidelines con admin UI
- Supporto journal/event tracking
- **Effort**: Alto

### 4.7 Completare Scheduler (White Rabbit)
**Stato attuale**: 60% — Service in-memory, UI completa
**Azione**:
- Creare migration per tabelle `scheduled_jobs` + `job_executions`
- Implementare DB persistence per jobs
- Job types: one_shot, interval, cron
- Action execution: scheduled_message, webhook, hook trigger
- **Effort**: Medio

### 4.8 Attivare Ralph Loop
**Stato attuale**: 70% — Service implementato, routes definite
**Azione**:
- Completare completion detection logic
- Aggiungere UI per configurare e lanciare loop iterativi
- Max iterations safety limit
- **Effort**: Basso-Medio

### 4.9 Plugin Default: registrare tool built-in come procedural memory
**Azione**:
- Al boot, registrare ogni tool built-in in procedural_memory (Qdrant)
- Quando utente chiede qualcosa, il ProceduresAgent trova il tool semanticamente
- Elimina necessita' di passare TUTTI i tool al LLM (risparmio token)
- **Effort**: Basso

---

## FASE 5 — BROWSER INTEGRATION (Settimana 4)
**Obiettivo**: Dare ai modelli la capacita' di navigare il web in modo interattivo

### 5.1 Deploy Browserless in Kubernetes
- Image: `browserless/chromium:latest` (Headless Chrome as a service)
- Alternativa: `ghcr.io/nicholasgasior/goproxy-chromedp` (leggero)
- Port: 3100 (WebSocket + REST API)
- Resource limits: 1Gi RAM, 1 CPU (Chrome e' pesante)
- PVC: 500Mi per cache/download
- **Effort**: Medio

### 5.2 Creare BrowserService
```typescript
// backend/src/services/BrowserService.ts
class BrowserService {
  // Navigazione
  async navigateTo(url: string): Promise<PageContent>
  async takeScreenshot(url: string): Promise<Buffer>
  async extractContent(url: string, selector?: string): Promise<string>

  // Interazione
  async clickElement(sessionId: string, selector: string): Promise<void>
  async fillForm(sessionId: string, fields: Record<string, string>): Promise<void>
  async executeScript(sessionId: string, script: string): Promise<any>

  // Sessioni (per navigazione multi-step)
  async createSession(): Promise<string>
  async closeSession(sessionId: string): Promise<void>

  // Sicurezza
  private isUrlAllowed(url: string): boolean  // SSRF protection
  private sanitizeScript(script: string): string
}
```
- **Effort**: Alto

### 5.3 Registrare Browser Tools
- `browse_url` — Naviga a URL, estrai contenuto testuale
- `take_screenshot` — Screenshot pagina (ritorna immagine per LLaVA)
- `fill_web_form` — Compila form su pagina web
- `click_link` — Clicca un link/bottone su pagina web
- `extract_table` — Estrai tabelle HTML come JSON/CSV
- `search_and_browse` — Web search + naviga al primo risultato
- **Effort**: Medio

### 5.4 Integrazione con modelli multimodali
- LLaVA puo' "vedere" screenshot e descrivere contenuto
- Pipeline: browse → screenshot → LLaVA analizza → risposta testuale
- Utile per: verificare layout, leggere grafici, OCR pagine web
- **Effort**: Medio

### 5.5 Sicurezza browser
- Whitelist domini (configurabile da admin)
- Rate limiting: max 10 navigazioni/minuto per utente
- Timeout: 30s per pagina
- Sandbox: no accesso a filesystem/rete interna
- Blocco URL interni (10.*, 192.168.*, localhost)
- **Effort**: Basso

---

## FASE 6 — MCP (Model Context Protocol) INTEGRATION (Settimana 4-5)
**Obiettivo**: Permettere agli utenti di connettere servizi esterni tramite MCP

### 6.1 Implementare MCP Client Manager
```typescript
// backend/src/services/MCPClientManager.ts
class MCPClientManager {
  private connections: Map<number, MCPConnection>

  // Lifecycle
  async connectServer(serverId: number): Promise<void>
  async disconnectServer(serverId: number): Promise<void>
  async disconnectAll(): Promise<void>

  // Tool discovery
  async listTools(serverId: number): Promise<MCPTool[]>
  async listResources(serverId: number): Promise<MCPResource[]>

  // Execution
  async callTool(serverId: number, toolName: string, args: any): Promise<any>
  async readResource(serverId: number, uri: string): Promise<any>

  // Health
  async healthCheck(serverId: number): Promise<boolean>
}
```
- **Effort**: Alto

### 6.2 Supportare trasporti MCP
| Trasporto | Uso | Implementazione |
|---|---|---|
| stdio | Server locali (memory, filesystem) | Spawn child process |
| SSE | Server remoti HTTP | EventSource client |
| WebSocket | Server remoti real-time | ws client |
- Il DB `mcp_servers` supporta gia' tutti e 3 i trasporti
- **Effort**: Medio

### 6.3 Integrare MCP tools nella chat
- Al login, caricare MCP servers abilitati per l'utente
- Scoprire tool disponibili da ogni server
- Unire ai tool built-in nella tool list
- Quando LLM chiama un MCP tool: MCPClientManager.callTool()
- Risultato torna al LLM come tool_result
- **Effort**: Alto

### 6.4 MCP Servers consigliati da pre-configurare
| Server | Scopo | Trasporto |
|---|---|---|
| `memory` (gia' implementato) | Ricerca osservazioni memoria | stdio |
| `filesystem` | Accesso file progetto utente | stdio |
| `brave-search` | Ricerca web avanzata | stdio |
| `github` | Issues, PR, repo browsing | stdio |
| `sqlite` | Query database locali | stdio |
| `google-drive` | Accesso documenti Google | SSE |
| `slack` | Messaggi e canali Slack | SSE |
| `postgres/mysql` | Query database esterni | stdio |
- **Effort**: Medio (configurazione admin UI gia' esistente)

### 6.5 UI per gestione MCP
- Admin: pagina gia' esistente per CRUD server
- Utente: toggle per abilitare/disabilitare server accessibili
- Chat: indicatore visivo dei server MCP attivi nella sessione
- Tool results: visualizzazione formattata nel messaggio
- **Effort**: Medio

### 6.6 MCP per richieste utente personalizzate
- Permettere agli utenti (con permessi) di registrare i propri MCP server
- Template pre-configurati per servizi comuni (GitHub, Google Drive, ecc.)
- Validazione connessione con test automatico
- Sandbox: limitare tool disponibili per ruolo utente
- **Effort**: Medio

---

## FASE 7 — KNOWLEDGE BASE E DOCUMENT MANAGEMENT (Settimana 5)
**Obiettivo**: Popolare la memoria dichiarativa con knowledge aziendale

### 7.1 UI per upload documenti nella RabbitHole
- Pagina admin/utente per caricare PDF/DOCX/TXT
- Progress bar WebSocket durante ingestion
- Visualizzazione chunks creati e vettori generati
- **Effort**: Alto

### 7.2 Auto-ingest da conversazioni (gia' collegato)
- `storeEpisodic()` e' gia' chiamato dopo ogni chat
- Si attiva automaticamente con Qdrant + embeddings funzionanti
- **Effort**: 0 (gia' implementato)

### 7.3 Web scraping per knowledge
- Importare contenuti da URL → text → chunk → embed → store in declarative
- WebScraperService gia' implementato
- Collegare alla RabbitHole pipeline
- **Effort**: Basso (componenti gia' pronti)

### 7.4 Gestione collections
- UI per visualizzare/svuotare/esportare collections Qdrant
- Endpoint gia' esistenti (wipeCollection, getAllCollectionsInfo, export/import)
- **Effort**: Medio (solo frontend)

### 7.5 Memory decay
- Ridurre gradualmente peso memorie episodiche vecchie
- Decay esponenziale su importance score
- Cleanup automatico memorie con score < threshold
- **Effort**: Basso

### 7.6 Semantic deduplication
- Prima di inserire nuova memoria, cercare duplicati simili (cosine > 0.95)
- Unire contenuti duplicati invece di creare entry separate
- **Effort**: Medio

---

## FASE 8 — MONITORING E ANALYTICS (Settimana 5)
**Obiettivo**: Misurare e migliorare continuamente

### 8.1 Dashboard memorie nel metrics
- Conteggio vettori per collection (episodic, declarative, procedural)
- Hit rate recall (% query con risultati utili)
- Average similarity score per collection
- **Effort**: Medio

### 8.2 Recall quality tracking
- Loggare ogni recall: query, risultati, scores, tempo
- Analisi offline qualita' retrieval
- **Effort**: Basso

### 8.3 A/B testing RAG vs no-RAG
- Toggle per attivare/disattivare Auto-RAG per singola conversazione
- Confrontare qualita' risposte con e senza contesto
- **Effort**: Medio

### 8.4 Token usage per componente
- Tracciare separatamente: system prompt, context, memory injection, HyDE, user message
- Visualizzare breakdown nel metrics
- **Effort**: Basso

### 8.5 Agent execution analytics
- Tempo medio per agent session
- Success rate per tipo di agent
- Tool usage frequency
- Form completion rate
- **Effort**: Medio

---

## PIANO TEMPORALE CONSIGLIATO

```
SETTIMANA 1:  FASE 1 (infrastruttura vector) — CRITICA, sblocca tutto
              ├── 1.1 Deploy Qdrant
              ├── 1.2-1.3 Embedding model
              ├── 1.4-1.5 Config + fix auth
              ├── 1.6 Abilitare Auto-RAG
              └── 1.7 Migration tabelle mancanti

SETTIMANA 2:  FASE 2 (retrieval) + FASE 3 (performance)
              ├── 2.1-2.2 HyDE + tuning
              ├── 3.4-3.5 Parametri modello + timeout
              └── 3.2 Context window adattivo

SETTIMANA 3:  FASE 4 (agent/plugin) — prima meta'
              ├── 4.1 AgentChain → chat pipeline
              ├── 4.2 Tool execution nella chat
              ├── 4.3 Conversational Forms trigger
              └── 4.9 Procedural memory registration

SETTIMANA 4:  FASE 4 (agent/plugin) — seconda meta' + FASE 5 (browser)
              ├── 4.4-4.5 Agent Orchestrator + Claude SDK
              ├── 5.1-5.2 Browserless + BrowserService
              └── 5.3 Browser tools registration

SETTIMANA 5:  FASE 6 (MCP) + FASE 7 (knowledge) + FASE 8 (monitoring)
              ├── 6.1-6.3 MCP Client Manager + chat integration
              ├── 6.4-6.6 MCP servers pre-configurati
              ├── 7.1 UI upload documenti
              └── 8.1-8.5 Dashboard + analytics

POST-LAUNCH:  FASE 2 avanzata (2.3-2.5 reranking, hybrid search)
              FASE 3 avanzata (3.1 system prompt per modello, 3.6 fallback chain)
              FASE 4 restante (4.6 Parlant, 4.7 Scheduler, 4.8 Ralph)
              FASE 7 (7.5-7.6 memory decay, dedup)
```

---

## DIPENDENZE CRITICHE

```
Qdrant (Fase 1.1)
  └── Embedding Model (Fase 1.2-1.3)
       └── Auto-RAG (Fase 1.6)
            ├── Episodic Memory (auto)
            ├── Declarative Memory (Fase 7)
            ├── Procedural Memory (Fase 4.9)
            ├── HyDE (Fase 2.1)
            └── AgentChain (Fase 4.1)
                 ├── Tool Execution (Fase 4.2)
                 ├── Form Trigger (Fase 4.3)
                 └── MCP Integration (Fase 6.3)

Browserless (Fase 5.1)
  └── BrowserService (Fase 5.2)
       └── Browser Tools (Fase 5.3)
            └── Multimodal (Fase 5.4)

MCPClientManager (Fase 6.1)
  └── MCP Transports (Fase 6.2)
       └── Chat Integration (Fase 6.3)
            └── MCP Servers (Fase 6.4-6.6)
```

---

## NOTE ARCHITETTURALI

### Modelli di Embedding Consigliati
| Modello | Dimensioni | Size | Provider | Qualita' | Costo |
|---|---|---|---|---|---|
| nomic-embed-text | 768 | 137MB | Ollama (locale) | Buona | Gratuito |
| mxbai-embed-large | 1024 | 670MB | Ollama (locale) | Molto buona | Gratuito |
| text-embedding-3-small | 1536 | API | OpenAI | Ottima | $0.02/1M token |
| text-embedding-3-large | 3072 | API | OpenAI | Eccellente | $0.13/1M token |

**Raccomandazione**: Partire con `nomic-embed-text` (locale, gratuito, veloce).
Passare a `mxbai-embed-large` se la qualita' del retrieval non e' sufficiente.

### Ispirazione Cheshire Cat AI
Il sistema segue l'architettura del [Cheshire Cat](https://cheshire-cat-ai.github.io/docs/):
- **Qdrant** come vector database
- **3 collections** (episodic, declarative, procedural)
- **Hookable pipeline** (23 hook points)
- **Mad Hatter** (plugin loader)
- **Rabbit Hole** (document ingestion)
- **White Rabbit** (scheduler)
- **HyDE** per improved retrieval
- **Working Memory** per stato sessione

La differenza principale e' che il Cheshire Cat usa Python + LangChain,
mentre enterprise-ai-chat usa TypeScript + Fastify con implementazione nativa.
