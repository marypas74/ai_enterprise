# Roadmap: Integrazione Funzionalità Cheshire Cat AI in Enterprise AI Chat

**Data**: 2026-02-23
**Versione corrente**: 1.5.29
**Repository analizzato**: https://github.com/iflow-mcp/cheshire-cat-ai-core

---

## Panoramica

Il Cheshire Cat AI Core è un framework Python/FastAPI per agenti conversazionali con RAG automatico, sistema di plugin con hook runtime, memoria vettoriale a 4 livelli e form conversazionali. Questa roadmap identifica le funzionalità mancanti o incomplete in Enterprise AI Chat rispetto a questo framework, ordinate per priorità e impatto.

---

## Stato Attuale - Confronto

| Area | Enterprise AI Chat | Cheshire Cat | Gap |
|------|-------------------|--------------|-----|
| RAG Pipeline | Qdrant + embeddings + chunking | RAG automatico su ogni messaggio | Medio |
| Plugin/Hook System | DB-driven, nessun hook runtime | 27 hook decorators con pipeline | **CRITICO** |
| Agent Pipeline | 3 sistemi (Orchestrator + Claude SDK + Ralph) | MainAgent con procedure dispatch | OK |
| Memory System | Observation-based (SQL + FTS) | 4-tier vettoriale (episodic/declarative/procedural/working) | **CRITICO** |
| Document Ingestion | PDF, DOCX, XLSX, PPTX, OCR | PDF, DOCX, TXT, URL, HTML | Medio |
| WebSocket/Streaming | SSE + WebSocket (superiore) | WebSocket only | OK |
| Auth & RBAC | JWT + MFA + OAuth + Groups + Audit | Nessuno built-in | OK (superiore) |
| LLM Providers | 5 provider + custom + cost tracking | 5+ via LangChain | OK |
| Conversational Forms | DynamicForm HTML (JSON Schema) | CatForm state machine conversazionale | **ALTO** |
| Cache System | Redis + in-memory | Nessuno | OK (superiore) |
| Admin Panel | 14+ pagine, monitoring completo | Basic admin | OK (superiore) |
| Task Scheduling | setInterval, nessun scheduler formale | APScheduler (basico) | Basso |
| URL Ingestion | Non presente | Scraping + parsing automatico | Medio |

---

## FASE 1 - Hook & Event System (Priorità: CRITICA)

### 1.1 Pipeline Event Bus

**Problema**: Il Cheshire Cat ha 27 hook decorators che permettono ai plugin di intercettare e modificare ogni fase della pipeline (pre/post LLM, pre/post RAG, pre/post messaggio). Enterprise AI Chat non ha nessun sistema di hook runtime.

**Cosa sviluppare**:

- [ ] **EventBus service** (`backend/src/services/EventBusService.ts`)
  - Pattern publish/subscribe con priorità
  - Hook sincroni (pipeline - il risultato di un hook alimenta il successivo)
  - Hook asincroni (notifiche - fire-and-forget)
  - Registrazione dinamica da plugin attivi

- [ ] **Hook Points** da implementare (equivalenti Cheshire Cat):
  - `before_message_read` — Pre-processing messaggio utente
  - `after_message_read` — Post-processing messaggio utente
  - `before_llm_call` — Prima della chiamata LLM (modificare prompt/parametri)
  - `after_llm_response` — Dopo la risposta LLM (modificare output)
  - `before_rag_recall` — Prima del recall RAG
  - `after_rag_recall` — Dopo il recall RAG (modificare contesto)
  - `before_memory_store` — Prima del salvataggio in memoria
  - `before_message_send` — Prima dell'invio risposta all'utente
  - `after_message_send` — Dopo l'invio risposta
  - `before_tool_execute` — Prima dell'esecuzione di un tool
  - `after_tool_execute` — Dopo l'esecuzione di un tool
  - `on_document_upload` — Quando un documento viene caricato
  - `on_document_chunked` — Dopo il chunking di un documento
  - `on_bootstrap` — All'avvio del server
  - `fast_reply` — Short-circuit per risposte immediate

- [ ] **Hook registration API** (`/api/admin/hooks`)
  - Lista hook disponibili
  - Lista handler registrati per hook
  - Abilitazione/disabilitazione handler
  - Priorità configurabile

- [ ] **Integrazione con Plugin esistenti**
  - I plugin DB possono dichiarare hook nel `config_schema`
  - Entry point del plugin caricato come modulo TypeScript
  - Sandbox di esecuzione per sicurezza

**File da modificare**:
- `backend/src/modules/chat/routes.ts` — Inserire hook points nella pipeline chat
- `backend/src/modules/admin/plugins.ts` — Aggiungere gestione hook
- `backend/src/services/` — Nuovo `EventBusService.ts`
- `frontend/src/pages/admin/PluginsPage.tsx` — UI gestione hook

**Stima complessità**: Alta (3-5 giorni)

---

## FASE 2 - Memory System Evoluto (Priorità: CRITICA)

### 2.1 Memoria Vettoriale per Osservazioni

**Problema**: Le osservazioni della memoria sono salvate solo in MariaDB con ricerca full-text SQL. Il Cheshire Cat usa Qdrant per tutte le memorie, permettendo recall semantico. L'infrastruttura Qdrant + Embedding esiste già ma è usata solo per documenti allegati.

**Cosa sviluppare**:

- [ ] **Episodic Memory** — Memoria vettoriale delle conversazioni
  - Collection Qdrant dedicata: `episodic_memory`
  - Ad ogni messaggio, vettorizzare la coppia domanda+risposta
  - Metadata: `user_id`, `conversation_id`, `timestamp`, `importance`
  - Recall automatico su ogni nuovo messaggio (top-K semanticamente simili)
  - Configurabile: k=3, threshold=0.7 (default Cheshire Cat)

- [ ] **Declarative Memory** — Fatti e conoscenza
  - Collection Qdrant dedicata: `declarative_memory`
  - I chunk dei documenti uploadati vanno qui (già esistente, rinominare)
  - Le osservazioni di tipo `fact`, `insight` vengono anche vettorizzate qui
  - Recall automatico basato su similarità semantica

- [ ] **Procedural Memory** — Tool e procedure
  - Collection Qdrant dedicata: `procedural_memory`
  - Vettorizzare le descrizioni dei tool/skill disponibili
  - Recall basato sull'intent dell'utente → suggerire tool rilevanti
  - Metadata: `tool_id`, `type` (tool/form/skill), `source` (plugin)

- [ ] **Working Memory** — Stato sessione corrente
  - Oggetto in-memory (Redis-backed) per sessione attiva
  - Contiene: conversation history recente, memorie richiamate, contesto RAG attivo
  - Si assembla automaticamente ad ogni messaggio
  - Iniettato nel prompt LLM come contesto strutturato

- [ ] **Memory Recall Pipeline** (da inserire nella chat pipeline)
  ```
  Messaggio utente
    → Embedding del messaggio
    → Recall parallelo: episodic (k=3) + declarative (k=3) + procedural (k=3)
    → Assemblaggio Working Memory
    → Iniezione nel prompt LLM
    → Risposta LLM
    → Store episodic memory (coppia Q+A)
  ```

- [ ] **API Memory Recall** (`/api/memory/recall`)
  - GET con query parameter `text` → ritorna memorie simili da tutte le collection
  - Filtri per collection, user_id, threshold, k

**File da modificare**:
- `backend/src/modules/memory/service.ts` — Estendere con vector memory
- `backend/src/services/VectorStoreService.ts` — Multi-collection support
- `backend/src/services/EmbeddingService.ts` — Usato per memory embedding
- `backend/src/modules/chat/routes.ts` — Inserire memory recall pipeline
- `frontend/src/pages/admin/MemoryPage.tsx` — UI per visualizzare tutte le collection

**Stima complessità**: Alta (4-6 giorni)

---

## FASE 3 - Conversational Forms (Priorità: ALTA)

### 3.1 Form Conversazionali (CatForm equivalent)

**Problema**: Il Cheshire Cat ha un sistema di "Conversational Forms" dove l'LLM guida l'utente attraverso una raccolta dati strutturata step-by-step. Enterprise AI Chat ha solo form HTML tradizionali.

**Cosa sviluppare**:

- [ ] **CatForm State Machine** (`backend/src/services/ConversationalFormService.ts`)
  - Stati: `INCOMPLETE` → `COMPLETE` → `WAIT_CONFIRM` → `CLOSED`
  - Schema dati basato su JSON Schema (riuso di quello esistente)
  - LLM extraction: ad ogni messaggio, il LLM estrae i campi dal testo
  - Validazione Pydantic-style con zod/ajv
  - Confirmation flow opzionale
  - Exit intent detection (l'utente vuole uscire dal form)

- [ ] **Form Registration** (via plugin system)
  - Tabella DB `conversational_forms`: name, description, json_schema, start_examples, stop_examples, ask_confirm, plugin_id
  - I form vengono vettorizzati nella procedural memory
  - Attivati quando l'intent dell'utente matcha

- [ ] **Form nella Chat Pipeline**
  - Quando un form è attivo, il messaggio viene intercettato dal FormAgent
  - Il FormAgent usa il LLM per estrarre dati dal messaggio
  - Risponde con il prossimo campo da compilare o conferma completamento
  - Al completamento, esegue un'azione configurata (webhook, tool, salvataggio)

- [ ] **Frontend Form UI**
  - Indicatore visivo "Form attivo" nella chat
  - Progress bar dei campi compilati
  - Possibilità di annullare il form
  - Riepilogo dati raccolti prima della conferma

**File da creare**:
- `backend/src/services/ConversationalFormService.ts`
- `backend/src/modules/forms/routes.ts`
- `frontend/src/components/chat/ConversationalFormIndicator.tsx`

**Stima complessità**: Media-Alta (3-4 giorni)

---

## FASE 4 - RAG Automatico su Ogni Messaggio (Priorità: MEDIA)

### 4.1 Always-On RAG Pipeline

**Problema**: Attualmente il RAG funziona solo quando ci sono documenti allegati alla conversazione. Il Cheshire Cat esegue il recall RAG su ogni messaggio automaticamente.

**Cosa sviluppare**:

- [ ] **Auto-RAG toggle** (per-utente e per-conversazione)
  - Setting `auto_rag_enabled` nella tabella user settings
  - Quando attivo, ogni messaggio triggera un recall sulla declarative memory
  - Il contesto recuperato viene iniettato nel prompt

- [ ] **RAG Context Window Management**
  - Limite configurabile di token per il contesto RAG
  - Ranking dei chunk per rilevanza
  - Deduplicazione dei chunk già nel contesto

- [ ] **RAG nella Chat Pipeline** (integrato con Fase 2)
  ```
  Messaggio utente
    → [Hook: before_rag_recall]
    → Embedding messaggio
    → Recall declarative memory (documenti + fatti)
    → [Hook: after_rag_recall]
    → Merge con working memory
    → Iniezione nel prompt
  ```

- [ ] **Frontend indicator**
  - Badge "RAG attivo" nella chat
  - Mostra fonti usate per la risposta (documenti, URL, osservazioni)
  - Toggle on/off per conversazione

**File da modificare**:
- `backend/src/modules/chat/routes.ts` — Auto-RAG pipeline
- `backend/src/services/VectorStoreService.ts` — Cross-collection search
- `frontend/src/components/chat/` — RAG indicators

**Stima complessità**: Media (2-3 giorni)

---

## FASE 5 - URL/Web Ingestion (Priorità: MEDIA)

### 5.1 Rabbit Hole per URL

**Problema**: Il Cheshire Cat può ingerire pagine web da URL. Enterprise AI Chat ha solo upload di file.

**Cosa sviluppare**:

- [ ] **URL Scraper Service** (`backend/src/services/WebScraperService.ts`)
  - Fetch URL con httpx/axios
  - Parsing HTML con cheerio/jsdom → testo pulito
  - Rimozione nav, footer, ads, script
  - Supporto per: HTML pages, PDF URLs, plain text URLs

- [ ] **API Endpoint** (`POST /api/attachments/url`)
  - Accetta URL, opzionalmente conversation_id
  - Scrape → chunk → embed → store in declarative memory
  - Progress notification via SSE/WebSocket

- [ ] **Chat Integration**
  - Detect URL nei messaggi chat (regex)
  - Opzione: "Vuoi che analizzi questa pagina?" o auto-ingest
  - Risultati mostrati come "fonte" nella risposta

- [ ] **Frontend**
  - Input URL nell'area upload
  - Preview del contenuto estratto
  - Indicatore di ingestion in corso

**File da creare**:
- `backend/src/services/WebScraperService.ts`
- `backend/src/modules/attachments/routes.ts` — Aggiungere endpoint URL

**Stima complessità**: Media (2-3 giorni)

---

## FASE 6 - Miglioramenti Minori (Priorità: BASSA)

### 6.1 Task Scheduler Formale

- [ ] Sostituire `setInterval` con un sistema di scheduling appropriato (node-cron o agenda.js)
- [ ] Dashboard schedulazioni nell'admin panel
- [ ] Job: cleanup memoria, sync modelli, archivio conversazioni, health checks

### 6.2 Plugin Runtime Code Loading

- [ ] I plugin possono avere entry point TypeScript caricati dinamicamente
- [ ] Sandbox VM (vm2/isolated-vm) per esecuzione sicura
- [ ] Plugin marketplace con registry remoto

### 6.3 Memory Export/Import

- [ ] Export di tutte le memorie (episodic + declarative + procedural) in formato JSON
- [ ] Import da file JSON (equivalente a POST /rabbithole/memory del Cheshire Cat)
- [ ] Backup automatico periodico

### 6.4 Prompt Template System

- [ ] Template di prompt personalizzabili per ruolo (system, prefix, suffix)
- [ ] Hook points per modificare i prompt (agent_prompt_prefix, agent_prompt_instructions, agent_prompt_suffix)
- [ ] Template per-utente e per-conversazione

**Stima complessità totale Fase 6**: Bassa-Media (3-4 giorni)

---

## Piano di Esecuzione Proposto

| Fase | Descrizione | Priorità | Giorni | Dipendenze |
|------|-------------|----------|--------|------------|
| **1** | Hook & Event System | CRITICA | 3-5 | Nessuna |
| **2** | Memory System Evoluto | CRITICA | 4-6 | Beneficia dalla Fase 1 |
| **3** | Conversational Forms | ALTA | 3-4 | Fase 2 (procedural memory) |
| **4** | RAG Automatico | MEDIA | 2-3 | Fase 2 (memory pipeline) |
| **5** | URL/Web Ingestion | MEDIA | 2-3 | Nessuna |
| **6** | Miglioramenti Minori | BASSA | 3-4 | Fasi 1-2 |
| | **TOTALE** | | **18-25 giorni** | |

---

## Note Importanti

### Licenza
Il Cheshire Cat AI Core è sotto **GPL-3.0** (copyleft). NON copieremo codice dal repository. Implementeremo le funzionalità equivalenti da zero in TypeScript, ispirandoci ai concetti architetturali ma con implementazione originale.

### Compatibilità
Tutte le nuove funzionalità devono essere:
- Retrocompatibili con le feature esistenti
- Opzionali (attivabili/disattivabili)
- Documentate nell'admin panel
- Testate con unit test

### Infrastruttura Esistente da Riutilizzare
- **Qdrant** → già configurato, estendere con nuove collection
- **Redis** → già configurato, usare per working memory
- **EmbeddingService** → già funzionante, riusare per memory embedding
- **VectorStoreService** → già funzionante, estendere per multi-collection
- **Plugin system DB** → estendere con hook registration
- **SSE/WebSocket** → riusare per notifiche real-time

---

*Roadmap generata dall'analisi comparativa di enterprise-ai-chat v1.5.29 vs cheshire-cat-ai-core v1.9.2*
