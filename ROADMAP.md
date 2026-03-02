# Enterprise AI Chat — Roadmap di Sviluppo

**Data analisi:** 2026-03-01
**Versione corrente:** 1.8.10
**Analisi basata su:** scansione completa del codebase (backend, frontend, vscode-extension, k8s)

---

## Stato Attuale — Executive Summary

| Area | Stato Attuale | Target | Priorità | Effort Stimato |
|------|--------------|--------|-----------|----------------|
| **Test Coverage** | ~5-8% (11 test file backend, 0 frontend, 2 E2E) | 80%+ | CRITICA | ~290 ore |
| **Refactoring** | 15 file >800 LOC, max 4.478 LOC | <800 LOC per file | ALTA | ~65 ore |
| **Security** | 5 endpoint senza auth, 141 cast non validati | Audit completo | ALTA | ~40 ore |
| **Documentazione** | Swagger disabilitato in prod, 36 JSDoc su 100+ file | API docs complete | MEDIA | ~30 ore |
| **Performance** | No lazy loading, cache statica disabilitata | Ottimizzazione completa | MEDIA | ~25 ore |
| **Production Readiness** | No backup, no monitoring, no autoscaling | Production-grade | ALTA | ~35 ore |

**Effort totale stimato: ~485 ore**

---

## INVENTARIO DETTAGLIATO

### Test Coverage — Stato Attuale

| Metrica | Valore Attuale | Target |
|---------|---------------|--------|
| Backend test file | 11 | ~103 necessari |
| Backend copertura file | ~10.7% | 80% |
| Frontend unit test | **0** | ~54 necessari |
| Frontend test coverage | **0%** | 80% |
| E2E spec file | 2 (4 test case) | 15+ necessari |
| Coverage config | **Assente** | vitest coverage + thresholds |
| **Copertura stimata globale** | **~5-8%** | **80%** |

**Test backend esistenti (11 file, ~75 assertion):**
- `services/ChunkingService.test.ts` — 10 test
- `services/CircuitBreakerService.test.ts` — 8 test
- `services/TokenCountService.test.ts` — 8 test
- `services/ToolSelectionService.test.ts` — 17 test
- `services/BatchProcessingService.test.ts` — 5 test
- `services/ConversationCleanupService.test.ts` — 5 test
- `services/DocumentProcessorService.test.ts` — 10 test
- `services/SandboxService.test.ts` — 8 test
- `modules/admin/mfa-reset.test.ts` — 2 test
- `modules/attachments/pdf-extraction.test.ts` — 1 test
- `modules/chat/context-injection.test.ts` — 1 test

**Moduli backend SENZA test (19/22):**
activity, agents, ai, auth, batch, compliance, downloads, files, forms, geo, ingestion, memory, orchestrator, parlant, projects, public, ralph, scheduler, tools

**Servizi backend SENZA test (42/50):**
AgentOrchestrator, AgentSdkService, BrowserService, ClaudeAgentService, ContentSafety, EmbeddingService, EventBusService, GDPRService, GoogleOAuthService, HybridSearchService, LLMSyncWorker, MCPClientManager, MemoryDecayService, MemoryService, MetricsService, ModelFetcher, PermissionService, ProceduralMemoryService, PromptTemplateService, StorageService, ToolService, VectorMemoryService, VectorStoreService, WebScraperService, WebSearchService, WorkingMemoryService, + 16 altri

---

### File >800 LOC da Refactorizzare (15 file)

| # | File | LOC | Severità |
|---|------|-----|----------|
| 1 | `vscode-extension/src/extension.ts` | **4.478** | ESTREMA |
| 2 | `backend/src/modules/chat/routes.ts` | **2.387** | ESTREMA |
| 3 | `backend/src/modules/projects/routes.ts` | **1.384** | SEVERA |
| 4 | `frontend/src/pages/ChatPage.tsx` | **1.293** | SEVERA |
| 5 | `backend/src/modules/ai/providers.ts` | **1.091** | ALTA |
| 6 | `frontend/src/pages/AutoClaudePage.tsx` | **1.063** | ALTA |
| 7 | `backend/src/modules/admin/providers.ts` | **992** | ALTA |
| 8 | `vscode-extension/webview-ui/src/claude-code/MainLayout.tsx` | **971** | ALTA |
| 9 | `backend/src/services/ToolService.ts` | **941** | ALTA |
| 10 | `frontend/src/pages/admin/UsersGroupsPage.tsx` | **912** | ALTA |
| 11 | `backend/src/modules/admin/plugins.ts` | **901** | ALTA |
| 12 | `backend/src/modules/admin/routes.ts` | **895** | ALTA |
| 13 | `backend/src/modules/attachments/routes.ts` | **830** | MODERATA |
| 14 | `vscode-extension/src/AgentPanel.ts` | **808** | MODERATA |
| 15 | `backend/src/services/AgentOrchestrator.ts` | **801** | MODERATA |

**File warning zone (400-800 LOC): 26 file aggiuntivi**

---

### Security — Stato Attuale

| Categoria | Stato | Rischio |
|-----------|-------|---------|
| **Copertura autenticazione** | 305/318 endpoint (97%) | **CRITICO** — 5 tools routes senza auth |
| **Autorizzazione (Admin/RBAC)** | Admin-only check sulle admin routes | BUONO |
| **Input validation** | 74 Zod + 241 Fastify schema, ma 141 cast non sicuri | MEDIO |
| **Rate limiting** | Globale + login-specific, ma admin esente | MEDIO |
| **CORS** | Configurato correttamente | BUONO |
| **Security headers** | Helmet abilitato | BUONO |
| **CSRF** | Non necessario (JWT Bearer) | BASSO |
| **SQL injection** | Query parametrizzate ovunque | BASSO |
| **XSS** | Nessun pattern pericoloso trovato | MOLTO BASSO |
| **Password hashing** | bcrypt cost 10 | BUONO |
| **Secrets management** | Encrypted at rest, validati al boot | BUONO |
| **Session management** | Activity tracking, revocation, refresh rotation | FORTE |

**Endpoint SENZA autenticazione (RISCHIO CRITICO):**
- `POST /api/tools/generate-docx` (tools/routes.ts:25)
- `POST /api/tools/generate-excel` (tools/routes.ts:63)
- `POST /api/tools/generate-pptx` (tools/routes.ts:109)
- `POST /api/tools/convert-to-pdf` (tools/routes.ts:164) — anche IDOR vulnerability
- `GET /api/tools/download/:filename` (tools/routes.ts:347)

---

### Performance — Stato Attuale

| Area | Stato | Severità |
|------|-------|----------|
| DB connection pool | 10 per pod, potenzialmente insufficiente | MEDIA |
| DB queue limit | Illimitato (0) — rischio memory buildup | MEDIA |
| N+1 query patterns | 18 file con await sequenziali in loop | MEDIA |
| Frontend code splitting | Non configurato | ALTA |
| Frontend lazy loading | Tutte le pagine importate eagerly | ALTA |
| Static asset caching | **Completamente disabilitato** (no-cache su asset hashati) | ALTA |
| Source maps in produzione | Abilitati | MEDIA |
| Circuit breaker scope | Solo per-pod, non condiviso | BASSA |
| Redis cache utilization | Chiavi definite ma possibilmente sottoutilizzate | MEDIA |

---

### Production Readiness — Stato Attuale

| Area | Stato | Severità |
|------|-------|----------|
| **Database backup** | **Nessuno configurato** | **CRITICO** |
| Health endpoint (root) | Non verifica DB/Redis | ALTA |
| Monitoring/metrics | No Prometheus/Grafana | ALTA |
| Startup probes | Mancanti su tutti i deployment | MEDIA |
| HPA (autoscaling) | Non configurato | MEDIA |
| PodDisruptionBudget | Non configurato | MEDIA |
| Content-Security-Policy | Mancante su frontend | MEDIA |
| Egress network policy | Non configurata | BASSA |
| Log shipping/aggregation | Non configurato | MEDIA |
| Request tracing/correlation IDs | Non presenti | MEDIA |

---

## FASE 0 — Fix Immediati di Sicurezza (Settimana 1)

> Questi fix devono essere applicati PRIMA di qualsiasi altro lavoro.

### 0.1 — CRITICAL: Aggiungere autenticazione a tools routes
**File:** `backend/src/modules/tools/routes.ts`
**Problema:** 5 endpoint completamente senza autenticazione — chiunque può generare file e scaricarli.

| Endpoint | Linea | Fix |
|----------|-------|-----|
| `POST /api/tools/generate-docx` | 25 | Aggiungere `onRequest: [(fastify as any).authenticate]` |
| `POST /api/tools/generate-excel` | 63 | Aggiungere `onRequest: [(fastify as any).authenticate]` |
| `POST /api/tools/generate-pptx` | 109 | Aggiungere `onRequest: [(fastify as any).authenticate]` |
| `POST /api/tools/convert-to-pdf` | 164 | Aggiungere `onRequest: [(fastify as any).authenticate]` + user ownership check |
| `GET /api/tools/download/:filename` | 347 | Aggiungere `onRequest: [(fastify as any).authenticate]` |

### 0.2 — CRITICAL: IDOR in convert-to-pdf
**File:** `backend/src/modules/tools/routes.ts:164`
**Problema:** `SELECT * FROM chat_attachments WHERE id = ?` senza check `user_id` — qualsiasi utente può accedere a qualsiasi allegato.
**Fix:** Aggiungere `AND user_id = ?` alla query.

### 0.3 — Rate limiting admin endpoints
**File:** `backend/src/index.ts:466`
**Problema:** `/api/admin/*` esente da rate limiting.
**Fix:** Rimuovere dall'allowList, usare un limite più alto (es. 200/min) invece dell'esenzione totale.

### 0.4 — Input validation per tools routes
**File:** `backend/src/modules/tools/routes.ts`
**Problema:** Body di PPTX e PDF conversion usano `request.body as any` senza validazione.
**Fix:** Aggiungere Zod schemas per ogni endpoint.

**Effort: ~4 ore | Rischio: NULLO (fix chirurgici)**

---

## FASE 1 — Production Readiness Critica (Settimane 2-3)

### 1.1 — Database Backup Strategy
**Stato attuale:** ZERO backup configurati. Perdita PVC = perdita totale dati.

**Azioni:**
- [ ] Creare CronJob K8s per `mysqldump` giornaliero con retention 30 giorni
- [ ] Configurare storage backup su volume separato o S3-compatible
- [ ] Creare script di restore e testarlo
- [ ] Documentare procedura di disaster recovery

**Effort: ~8 ore**

### 1.2 — Health Check Migliorato
**File:** `backend/src/index.ts:418`
**Stato attuale:** `/health` ritorna `{ status: 'ok' }` senza verificare DB/Redis.

**Azioni:**
- [ ] Aggiungere check connessione MariaDB (query `SELECT 1`)
- [ ] Aggiungere check connessione Redis (comando `PING`)
- [ ] Ritornare `503` se qualsiasi dipendenza è down
- [ ] Aggiungere startup probe al backend deployment K8s

**Effort: ~3 ore**

### 1.3 — Monitoring & Alerting
**Stato attuale:** Nessun Prometheus, nessun Grafana, nessun alerting.

**Azioni:**
- [ ] Installare `fastify-metrics` per esporre `/metrics`
- [ ] Deployare Prometheus su K8s (o kube-prometheus-stack)
- [ ] Deployare Grafana con dashboard per: API latency, error rate, DB connections, Redis usage
- [ ] Configurare alerting base: error rate >5%, latency p99 >5s, pod restart, DB pool exhausted

**Effort: ~16 ore**

### 1.4 — K8s Hardening

**Azioni:**
- [ ] Aggiungere `startupProbe` al backend (per migrazioni lunghe)
- [ ] Aggiungere `PodDisruptionBudget` (minAvailable: 1 per backend)
- [ ] Valutare `HorizontalPodAutoscaler` per backend (CPU/memory based)
- [ ] Ridurre spread memory request/limit (da 1Gi/8Gi a 2Gi/6Gi)

**Effort: ~4 ore**

---

## FASE 2 — Performance Quick Wins (Settimana 3-4)

### 2.1 — Frontend: Lazy Loading Pagine
**File:** `frontend/src/App.tsx`
**Stato attuale:** Tutte le 10+ pagine importate eagerly.

**Fix:** Convertire tutti gli import a `React.lazy()` + `<Suspense>`.

**Impatto: Riduzione ~60-70% del bundle iniziale**
**Effort: ~2 ore**

### 2.2 — Frontend: Correggere Cache Statica Nginx
**File:** `frontend/nginx.conf`
**Stato attuale:** TUTTI gli asset statici serviti con `no-cache`.

**Fix:** Asset hashati Vite → `Cache-Control: public, max-age=31536000, immutable`. Solo `index.html` → `no-cache`.

**Effort: ~1 ora**

### 2.3 — Frontend: Code Splitting Vite
**File:** `frontend/vite.config.ts`
**Stato attuale:** No `manualChunks`, nessuna strategia di splitting.

**Fix:** Aggiungere chunk splitting per vendor pesanti + disabilitare source maps in produzione.

**Effort: ~2 ore**

### 2.4 — Backend: DB Connection Pool Tuning
**File:** `backend/src/database/index.ts`
**Stato attuale:** `connectionLimit: 10`, `queueLimit: 0`.

**Fix:** `connectionLimit: 25`, `queueLimit: 50`.

**Effort: ~1 ora**

### 2.5 — Backend: Audit N+1 Query
**File con pattern sospetti:** `admin/providers.ts`, `admin/plugins.ts`, `admin/settings.ts`, `admin/skills.ts`, `projects/routes.ts`
**Azione:** Convertire loop `for...of await db.execute()` in batch query `WHERE id IN (...)`.

**Effort: ~8 ore**

---

## FASE 3 — Refactoring Codice (Settimane 4-8)

### 3.1 — Split `extension.ts` (4.478 → <800 LOC per file)

| Nuovo File | LOC Stimate | Contenuto |
|------------|-------------|-----------|
| `src/auth/AuthService.ts` | ~200 | Unificare le 2 implementazioni duplicate login/logout |
| `src/auth/ClaudeOAuth.ts` | ~150 | Handler OAuth Claude, costanti |
| `src/messaging/MessageHandler.ts` | ~200 | handleSendMessage, handleAgenticMessage |
| `src/commands/CodeActions.ts` | ~100 | codeAction, addToChat, addFileToContext |
| `src/commands/RegisterCommands.ts` | ~600 | Blocco registrazione comandi da activate() |
| `src/providers/ChatViewProvider.ts` | ~400 | Classe principale senza HTML |
| `src/providers/ChatViewHtml.ts` | ~700 | Template HTML/CSS/JS |
| `src/providers/ChatViewKanban.ts` | ~200 | Operazioni Kanban |
| `src/providers/ChatViewMessaging.ts` | ~300 | sendMessage, message handling |
| `src/models/ModelFetcher.ts` | ~80 | fetchModels, fetchAIToolkitConfig |
| `src/utils/CustomInstructions.ts` | ~50 | loadCustomInstructions |

**Duplicazione confermata:** 2 set completi login/logout (panel-based linee 393-643, ChatViewProvider linee 1960-2270). Da unificare in AuthService.

**Effort: ~20 ore**

### 3.2 — Split `chat/routes.ts` (2.387 → <800 LOC per file)

| Nuovo File | LOC Stimate | Contenuto |
|------------|-------------|-----------|
| `modules/chat/completions.ts` | ~700 | Handler `/completions` (refactored) |
| `modules/chat/streaming.ts` | ~200 | Utility SSE, tool execution loop condiviso |
| `modules/chat/conversations.ts` | ~300 | CRUD conversazioni |
| `modules/chat/models.ts` | ~170 | Listing modelli |
| `modules/chat/agentic.ts` | ~450 | Handler `/agentic` |
| `modules/chat/routes.ts` | ~50 | Aggregatore fastify.register() |

**Effort: ~12 ore**

### 3.3 — Split `projects/routes.ts` (1.384 LOC)

Split in: `projectCrud.ts`, `boards.ts`, `cards.ts`, `cardFeatures.ts`, `access.ts`

**Effort: ~6 ore**

### 3.4 — Split `ai/providers.ts` (1.091 LOC)

Un file per provider: OpenAI, Anthropic, Google, Ollama, Custom + AIProviderFactory + types.

**Effort: ~4 ore**

### 3.5 — Split pagine frontend grandi

| Pagina | LOC | Azione |
|--------|-----|--------|
| `ChatPage.tsx` (1.293) | Estrarre: `ChatSidebar`, `ChatMessageList`, `ChatInputArea`, hooks custom |
| `AutoClaudePage.tsx` (1.063) | Estrarre 12 sotto-componenti inline in `pages/auto-claude/` |
| `UsersGroupsPage.tsx` (912) | Estrarre `UserForm`, `GroupForm`, `Modal` |
| `MainLayout.tsx` (971) | Estrarre sotto-pannelli |

**Effort: ~12 ore**

### 3.6 — Estrarre utility condivise

- [ ] `sendError(reply, statusCode, message, details?)` — standardizzare le 370 risposte errore
- [ ] `SSEStream` utility class — deduplicare pattern streaming
- [ ] Error envelope standard: `{ success: false, error: string, details?: any }`

**Effort: ~4 ore**

---

## FASE 4 — Test Infrastructure Setup (Settimana 5-6)

### 4.1 — Backend Test Infrastructure

**Azioni:**
- [ ] Installare `@vitest/coverage-v8`
- [ ] Creare `vitest.config.ts` con coverage thresholds 80%, reporter verbose + html
- [ ] Creare `test/setup.ts` con mock globali (database, redis, fastify instance)
- [ ] Creare `test/helpers/` con utility: `createTestFastify()`, `createAuthenticatedRequest()`, `mockDatabase()`

**Effort: ~8 ore**

### 4.2 — Frontend Test Infrastructure

**Azioni:**
- [ ] Installare: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
- [ ] Creare `vitest.config.ts` per frontend con jsdom environment
- [ ] Creare `test/setup.ts` con mock per: zustand, react-router, api.ts
- [ ] Creare test helper per render con provider (auth, router)

**Effort: ~4 ore**

### 4.3 — E2E Test Infrastructure

**Azioni:**
- [ ] Creare Page Object Model per pagine principali
- [ ] Creare fixture per: login, utente autenticato, admin autenticato
- [ ] Configurare test database con seed data
- [ ] Aggiungere CI pipeline per E2E

**Effort: ~6 ore**

---

## FASE 5 — Test Coverage Sprint (Settimane 6-16)

### 5.1 — Backend Unit Tests — Servizi Critici (Settimane 6-8)

**Priorità 1 — Security-critical (0 test attualmente):**

| Servizio | Test da Scrivere |
|----------|-----------------|
| Auth routes | Login, register, refresh, MFA, session management |
| Auth Google OAuth | OAuth flow, callback, token exchange |
| PermissionService | RBAC checks, admin-only, user isolation |
| Crypto utils | Encrypt/decrypt, key derivation |

**Effort: ~20 ore**

**Priorità 2 — Core business logic:**

| Servizio | Test da Scrivere |
|----------|-----------------|
| AgentOrchestrator | Orchestration flow, tool routing, error handling |
| ClaudeAgentService | Agent SDK integration, session management |
| ToolService | Tool execution, sandboxing, result handling |
| EmbeddingService | Embedding generation, batch processing |
| VectorStoreService | Vector search, similarity scoring |
| HybridSearchService | Search pipeline, ranking |

**Effort: ~30 ore**

**Priorità 3 — Supporto e infrastruttura:**

EventBusService, StorageService, WebSearchService, MCPClientManager, PromptTemplateService, MetricsService, ModelFetcher + 10 altri

**Effort: ~20 ore**

### 5.2 — Backend Integration Tests — Route Modules (Settimane 8-10)

Test con `fastify.inject()` per ogni modulo:

| Modulo | Endpoint | Priorità |
|--------|----------|----------|
| chat | 15 | CRITICA |
| admin/* | 63 | ALTA |
| agents | 27 | ALTA |
| auth | 15 | CRITICA |
| tools | 6 | ALTA |
| projects | 20 | MEDIA |
| compliance | 18 | MEDIA |
| memory | 21 | MEDIA |
| tutti gli altri | ~60 | BASSA |

**Effort: ~80 ore**

### 5.3 — Frontend Unit Tests (Settimane 10-12)

**Stores/Hooks:** useAuthStore, useAgentStore, api.ts, useAuth, useIdleTimeout — **15 ore**
**Componenti:** DynamicForm, ConsentModal, FeedbackButtons, MemoryPanel, ecc. — **10 ore**
**Pagine:** LoginPage, ChatPage, SettingsPage, AdminPage — **15 ore**

### 5.4 — E2E Tests Expansion (Settimane 12-14)

| Flow | Priorità |
|------|----------|
| Login completo | CRITICA |
| Chat message send/receive | CRITICA |
| File upload + processing | ALTA |
| Admin user CRUD | ALTA |
| MFA setup + login | ALTA |
| Project management | MEDIA |
| Settings persistence | MEDIA |
| Agent session | MEDIA |
| Error handling/recovery | MEDIA |
| Mobile responsive | BASSA |

**Effort: ~30 ore**

---

## FASE 6 — Security Hardening (Settimane 8-10, parallelo a testing)

### 6.1 — Input Validation Audit
141 `as` type assertion da sostituire con Zod schema parse. Target: 0 cast non validati su dati utente.
**Effort: ~16 ore**

### 6.2 — Authorization Audit
Verificare IDOR su tutti gli endpoint che accedono a risorse per ID. Assicurare `user_id` check.
**Effort: ~8 ore**

### 6.3 — Rate Limiting Fine-Tuning
Rate limit per-route su endpoint costosi: chat/completions (30/min), tools/* (20/min), ingestion/* (10/min). Rate limiting per utente (non solo IP).
**Effort: ~6 ore**

### 6.4 — Security Headers
Aggiungere `Content-Security-Policy` al frontend. Configurare egress network policy.
**Effort: ~4 ore**

### 6.5 — Penetration Testing
OWASP ZAP scan + test manuale su: auth bypass, IDOR, injection, file upload. Verifica isolamento tenant.
**Effort: ~8 ore**

---

## FASE 7 — Documentazione (Settimane 10-12, parallelo)

### 7.1 — Swagger/OpenAPI in Produzione
Abilitare Swagger in produzione (read-only, dietro auth). Sincronizzare versione con package.json. Completare schema body/response per tutti i 325 endpoint.
**Effort: ~12 ore**

### 7.2 — Developer Onboarding Guide
- `docs/GETTING_STARTED.md` — setup ambiente sviluppo
- `docs/ARCHITECTURE.md` — overview architettura, diagrammi
- `docs/API_GUIDE.md` — guida all'uso delle API
- `docs/DEPLOYMENT.md` — guida deploy e operazioni
**Effort: ~12 ore**

### 7.3 — Documentazione Operativa
- `docs/RUNBOOK.md` — procedure per incidenti comuni
- `docs/BACKUP_RESTORE.md` — procedura backup e restore
- `docs/MONITORING.md` — dashboard, alert, troubleshooting
**Effort: ~6 ore**

---

## Timeline Complessiva

```
Settimana  1:  ████ FASE 0 — Security fix immediati (4h)
Settimana  2:  ████████████ FASE 1 — Production readiness (16h)
Settimana  3:  ████████████ FASE 1 + FASE 2 performance (15h)
Settimana  4:  ████████████████ FASE 2 completamento + FASE 3 inizio refactoring (16h)
Settimana  5:  ████████████████████ FASE 3 refactoring extension.ts + chat/routes (20h)
Settimana  6:  ████████████████ FASE 3 completamento + FASE 4 test infra (16h)
Settimana  7:  ████████████████████ FASE 5.1 — test servizi critici (20h)
Settimana  8:  ████████████████████ FASE 5.1 + FASE 6.1 security audit (20h)
Settimana  9:  ████████████████████████ FASE 5.2 — integration test (24h)
Settimana 10:  ████████████████████████ FASE 5.2 + FASE 6 + FASE 7 (24h)
Settimana 11:  ████████████████████ FASE 5.3 — frontend tests + FASE 7 (20h)
Settimana 12:  ████████████████████ FASE 5.3 completamento + FASE 7 (20h)
Settimana 13:  ████████████████ FASE 5.4 — E2E tests (16h)
Settimana 14:  ████████████████ FASE 5.4 completamento + fix finali (16h)
Settimana 15:  ████████████ Verifica coverage, penetration test (12h)
Settimana 16:  ████████ Review finale, documentazione (8h)
```

---

## Dipendenze tra Fasi

```
FASE 0 (Security Fix) ──→ tutto il resto
                            │
FASE 1 (Prod Ready) ───────┤
                            │
FASE 2 (Performance) ──────┤
                            │
FASE 3 (Refactoring) ──────┼──→ FASE 5 (Testing)
                            │        │
FASE 4 (Test Infra) ───────┘        │
                                     ├──→ Coverage 80%+
FASE 6 (Security) ──────────────────┤
                                     │
FASE 7 (Docs) ──────────────────────┘
```

**Note critiche:**
- FASE 3 (Refactoring) DEVE precedere FASE 5 (Testing) per i file >800 LOC
- FASE 4 (Test Infra) è prerequisito per FASE 5
- FASE 6 (Security) e FASE 7 (Docs) possono procedere in parallelo con il testing

---

## Metriche di Successo

| Milestone | Criterio | Target |
|-----------|----------|--------|
| M1 — Security Clean | 0 endpoint senza auth, 0 IDOR | Fine Settimana 1 |
| M2 — Prod Ready | Backup funzionante, health check con dipendenze, monitoring base | Fine Settimana 3 |
| M3 — Performance | Lighthouse score >90, lazy loading attivo, cache statica | Fine Settimana 4 |
| M4 — Refactoring | 0 file >800 LOC | Fine Settimana 6 |
| M5 — Test 50% | Coverage backend >50%, frontend >30% | Fine Settimana 10 |
| M6 — Security Audit | Penetration test superato, 0 cast non validati | Fine Settimana 12 |
| M7 — Docs Complete | Swagger in prod, onboarding guide, runbook | Fine Settimana 12 |
| M8 — Test 80% | Coverage globale >80%, E2E flow critici | Fine Settimana 16 |

---

---

## FASE 8 — Model Orchestrator: Routing Intelligente Automatico (Settimane 17-28)

> **Obiettivo:** L'utente non sceglie il modello. Il sistema analizza ogni query e la instrada al modello ottimale per qualita/costo/latenza, come Perplexity e Gemini CLI.

### Contesto e Ricerca

**Stato dell'arte (Marzo 2026):**

| Progetto | Approccio | Stars | Produzione |
|----------|-----------|-------|------------|
| [RouteLLM](https://github.com/lm-sys/RouteLLM) (LMSYS/UC Berkeley) | Classificatori ML (BERT, MF, LLM) su dati Chatbot Arena | 4.6k | Si — ICLR 2025 |
| [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) (UIUC) | 16+ algoritmi (KNN, SVM, MLP, GNN, BERT, RL) | 1.4k | Si — OpenClaw server |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | Classificazione semantica, Rust inference | 3.3k | Si — SOTA su RouterArena |
| [Aurelio Semantic Router](https://github.com/aurelio-labs/semantic-router) | Embedding similarity, sub-millisecond | 3.3k | Si — MIT license |
| [LiteLLM](https://github.com/BerriAI/litellm) | Gateway + load balancing + fallback | 37.4k | Si — enterprise |
| [TensorZero](https://github.com/tensorzero/tensorzero) | Gateway Rust + A/B testing + feedback loop | 11k | Si |
| [ClawRouter](https://github.com/BlockRunAI/ClawRouter) | 15 dimensioni scoring, <1ms routing | 3.8k | Si — TypeScript |

**Benchmark chiave (LLMRouterBench, Gennaio 2026):** Molti router (inclusi commerciali) non battono in modo affidabile baseline semplici se valutati con protocolli unificati. Consiglio: **partire semplice, iterare con dati reali**.

**Come lo fanno i big:**
- **Perplexity:** Meta-router che valuta tipo task, complessita, latenza. Principio: *"usa il modello piu piccolo che da la migliore UX"*
- **Google Gemini CLI:** Router automatico di default tra Flash e Pro basato su complessita
- **Cursor Auto:** Router reliability-first (switch su degradazione/outage, non su complessita)
- **OpenRouter Auto:** Meta-modello NotDiamond che analizza il prompt e sceglie tra 19+ modelli

**Provider effort controls (alternativa intra-modello):**
- **Anthropic:** `adaptive thinking` + parametro `effort` (low/medium/high/max)
- **OpenAI:** `reasoning.effort` su modelli o-series
- **Google:** `thinking_level` su Gemini 3

### Infrastruttura Esistente (gia pronta)

Il sistema ha gia le basi per il routing:

| Componente | File | Stato |
|------------|------|-------|
| Multi-provider factory | `backend/src/modules/ai/AIProviderFactory.ts` | Funzionante |
| Model capabilities inference | `backend/src/utils/model-capabilities.ts` | Funzionante |
| MODEL_PRICING per costi | `backend/src/modules/ai/types.ts` | Aggiornato Mar 2026 |
| Token tracking per-request | `backend/src/modules/chat/streaming.ts` | Funzionante |
| Latency tracking in ai_decision_log | `backend/src/modules/chat/streaming.ts` | Funzionante |
| Circuit breaker per provider | `backend/src/services/CircuitBreakerService.ts` | Funzionante |
| Model config con context window | `backend/src/services/ModelConfigService.ts` | Funzionante |
| Monthly cost aggregation | tabella `monthly_usage` | Funzionante |
| Model recommendation (basic) | `backend/src/modules/chat/models.ts` | Da sostituire |

### Architettura Target

```
                    ┌─────────────────────────────────────────────┐
                    │              Model Orchestrator              │
                    │                                             │
  User Query ──────▶│  1. Query Analyzer (complessita/tipo)       │
                    │  2. Model Scorer (quality/cost/latency)     │
                    │  3. Model Selector (best match)             │
                    │  4. Fallback Chain (circuit breaker)        │
                    │  5. Feedback Loop (learn from outcomes)     │
                    │                                             │
                    └────────┬──────────┬──────────┬──────────────┘
                             │          │          │
                    ┌────────▼──┐ ┌─────▼─────┐ ┌─▼────────────┐
                    │  Tier 1   │ │  Tier 2   │ │   Tier 3     │
                    │  FAST     │ │  BALANCED  │ │   POWERFUL   │
                    │           │ │           │ │              │
                    │ Haiku 4.5 │ │ Sonnet 4.6│ │  Opus 4.6    │
                    │ GPT-4.1m  │ │ GPT-4.1   │ │  GPT-5       │
                    │ Gem Flash │ │ Gem Pro   │ │  o3           │
                    │ Ollama    │ │           │ │              │
                    │ (locale)  │ │           │ │              │
                    └───────────┘ └───────────┘ └──────────────┘
```

### FASE 8.1 — Rule-Based Router (Settimane 17-18)

> **"L'80% dei casi si gestisce con 5-10 regole semplici"** — LogRocket Production Guide

**Nuovo file:** `backend/src/services/ModelRouter.ts`

**Regole di routing:**

| Segnale | Tier 1 (Fast) | Tier 2 (Balanced) | Tier 3 (Powerful) |
|---------|---------------|-------------------|-------------------|
| Lunghezza input | < 100 chars | 100-2000 chars | > 2000 chars |
| Keyword match | saluto, grazie, ok | analizza, spiega, scrivi | ragiona, confronta, progetta, architettura |
| Tipo task | traduzione, riformulazione | coding, analisi | reasoning multi-step, design |
| Storico conversazione | < 3 messaggi | 3-10 messaggi | > 10 messaggi (contesto ricco) |
| Allegati | nessuno | 1 documento | multi-documento, immagini |
| Lingua richiesta | italiano semplice | tecnico | multi-lingua, legale |
| Tool richiesti | nessuno | 1 tool | multi-tool, agentic |

**Implementazione:**

```typescript
// backend/src/services/ModelRouter.ts
interface RoutingDecision {
  tier: 'fast' | 'balanced' | 'powerful';
  model: string;
  reason: string;
  confidence: number;  // 0-1
  estimatedCost: number;
}

interface RoutingContext {
  query: string;
  conversationLength: number;
  hasAttachments: boolean;
  attachmentTypes: string[];
  userTier: string;        // 'free' | 'standard' | 'premium'
  previousModelUsed?: string;
  toolsRequested: string[];
}

class ModelRouter {
  async route(ctx: RoutingContext): Promise<RoutingDecision> { ... }
}
```

**Database:**
```sql
-- Nuova tabella per configurazione tiers
CREATE TABLE model_routing_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tier_name ENUM('fast', 'balanced', 'powerful'),
  provider VARCHAR(50),
  model_id VARCHAR(100),
  priority INT DEFAULT 0,         -- ordine preferenza dentro il tier
  max_concurrent INT DEFAULT 0,   -- 0 = illimitato
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Log decisioni routing per feedback loop
CREATE TABLE routing_decisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT,
  user_id INT,
  query_length INT,
  query_complexity_score FLOAT,
  selected_tier ENUM('fast', 'balanced', 'powerful'),
  selected_model VARCHAR(100),
  routing_reason VARCHAR(500),
  routing_confidence FLOAT,
  response_quality_score FLOAT NULL,  -- da feedback utente
  latency_ms INT,
  tokens_input INT,
  tokens_output INT,
  cost_usd DECIMAL(10,6),
  user_override BOOLEAN DEFAULT FALSE, -- utente ha cambiato modello?
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tier_date (selected_tier, created_at),
  INDEX idx_user_override (user_override, created_at)
);
```

**Frontend:**
- Sostituire il model selector con un toggle "Auto/Manuale"
- In modalita Auto: mostrare badge con tier selezionato (es. "Haiku 4.5 - Veloce")
- Permettere override manuale con un click
- Tracciare gli override come segnale per migliorare il router

**Effort: ~30 ore**

### FASE 8.2 — Adaptive Effort per Provider (Settimane 19-20)

> Sfruttare i parametri `effort` nativi dei provider per ottimizzare **dentro** lo stesso modello.

**Logica:** Anche quando il router seleziona un tier, il modello puo modulare il "quanto ragionare":

| Complessita Query | Anthropic `effort` | OpenAI `reasoning.effort` | Google `thinking_level` |
|-------------------|--------------------|---------------------------|-------------------------|
| Semplice | `low` | `low` | `minimal` |
| Media | `medium` | `medium` | `medium` |
| Complessa | `high` | `high` | `high` |

**Azioni:**
- [ ] Aggiungere parametro `effort` a `AnthropicProvider.ts` (adaptive thinking)
- [ ] Aggiungere parametro `reasoning.effort` a `OpenAIProvider.ts` (o-series)
- [ ] Aggiungere parametro `thinking_level` a `GoogleProvider.ts` (Gemini 3)
- [ ] Il `ModelRouter` calcola la complessita e passa l'effort level al provider
- [ ] Tracciare thinking_tokens separatamente per analisi costo/beneficio

**Risparmio stimato:** 20-40% sui costi di thinking tokens per query semplici inviate a modelli potenti.

**Effort: ~12 ore**

### FASE 8.3 — Cascade Pattern: Try Cheap First (Settimane 21-22)

> Il pattern piu studiato in letteratura (RouteLLM, C3PO, Select-then-Route). Risparmio fino a 85%.

**Logica:**
1. Inviare la query al modello Tier 1 (fast/economico)
2. Valutare la qualita della risposta con un **quality check rapido**
3. Se insufficiente, escalare al Tier 2/3

**Quality Check (senza LLM aggiuntivo):**
- Lunghezza risposta vs attesa (troppo corta = bassa qualita)
- Presenza di "non so", "non posso", pattern di rifiuto
- Self-consistency: se la risposta contraddice dati nel contesto
- Confidence del modello (logprobs dove disponibili)
- Fallback rate tracking: se un modello fallback >20% delle volte su una categoria, promuovere direttamente

**Nuovo file:** `backend/src/services/ResponseQualityChecker.ts`

```typescript
interface QualityAssessment {
  score: number;           // 0-1
  shouldEscalate: boolean;
  reason: string;
  metrics: {
    responseLength: number;
    containsRefusal: boolean;
    containsUncertainty: boolean;
    coherenceScore: number;
  };
}
```

**Gestione UX durante escalation:**
- L'utente vede subito la risposta del modello fast (streaming)
- Se escalation necessaria: mostrare notifica "Sto approfondendo con un modello piu potente..."
- Sostituire la risposta con quella del modello superiore
- Alternativa: mostrare entrambe e far scegliere all'utente (A/B implicito)

**Effort: ~25 ore**

### FASE 8.4 — Semantic Router per Task Classification (Settimane 23-24)

> Ispirato a [Aurelio Semantic Router](https://github.com/aurelio-labs/semantic-router) — decisioni in microsecondi senza chiamate LLM.

**Logica:** Usare gli embedding gia presenti nel sistema (EmbeddingService) per classificare le query in categorie predefinite, e ogni categoria ha un tier assegnato.

**Route definitions:**

```typescript
const ROUTING_ROUTES = [
  {
    name: 'greeting',
    tier: 'fast',
    examples: [
      'ciao', 'buongiorno', 'come stai', 'hello', 'hi',
      'grazie', 'ok perfetto', 'va bene'
    ]
  },
  {
    name: 'simple_question',
    tier: 'fast',
    examples: [
      'che ore sono', 'qual e la capitale di', 'traduci questa frase',
      'come si dice in inglese', 'riassumi in una riga'
    ]
  },
  {
    name: 'coding',
    tier: 'balanced',
    examples: [
      'scrivi una funzione che', 'correggi questo bug',
      'spiega questo codice', 'aggiungi un test per',
      'refactoring di questo metodo'
    ]
  },
  {
    name: 'analysis',
    tier: 'balanced',
    examples: [
      'analizza questo documento', 'confronta queste opzioni',
      'quali sono i pro e contro', 'spiega la differenza tra'
    ]
  },
  {
    name: 'complex_reasoning',
    tier: 'powerful',
    examples: [
      'progetta un architettura per', 'scrivi un business plan',
      'analizza criticamente', 'valuta i rischi di',
      'proponi una strategia per', 'crea una roadmap'
    ]
  },
  {
    name: 'multi_step_agent',
    tier: 'powerful',
    examples: [
      'cerca sul web e poi analizza', 'scarica il file e processalo',
      'esegui questa pipeline', 'usa gli strumenti per'
    ]
  }
];
```

**Implementazione:**
- [ ] Generare embedding per tutti gli esempi al boot (one-time, cache in Redis)
- [ ] Per ogni query in ingresso: generare embedding, calcolare cosine similarity con tutte le route
- [ ] Selezionare la route con similarity piu alta (soglia minima: 0.65)
- [ ] Se nessuna route matcha → fallback al rule-based router (Fase 8.1)

**Vantaggio:** ~1-5ms di latenza aggiuntiva, zero costi LLM per il routing.

**Effort: ~20 ore**

### FASE 8.5 — Feedback Loop e Auto-Tuning (Settimane 25-26)

> **"Monitor router accuracy, not just model accuracy"** — Community consensus

**Segnali di feedback:**
1. **Feedback esplicito utente** (FeedbackButtons gia presenti): thumbs up/down → `response_quality_score`
2. **Override modello**: l'utente cambia da Auto a manuale → segnale che il router ha sbagliato
3. **Escalation rate**: % di risposte che richiedono cascade → troppo alto = router troppo aggressivo
4. **Latency satisfaction**: tempo di risposta vs aspettativa utente
5. **Regeneration**: l'utente chiede di rigenerare → risposta inadeguata

**Dashboard Admin:**
```
┌─────────────────────────────────────────────────────┐
│  MODEL ORCHESTRATOR DASHBOARD                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Routing Distribution (last 7 days)                 │
│  ████████████████████░░░░░░  Tier 1: 62%           │
│  ████████████░░░░░░░░░░░░░  Tier 2: 30%           │
│  ████░░░░░░░░░░░░░░░░░░░░  Tier 3:  8%           │
│                                                     │
│  Quality Metrics                                    │
│  Positive feedback:     87%                         │
│  Escalation rate:       12%                         │
│  User override rate:     5%                         │
│  False accept rate:      2.1%                       │
│                                                     │
│  Cost Savings vs "always Opus"                      │
│  Questa settimana:  -67% ($142 → $47)              │
│  Questo mese:       -61% ($580 → $226)             │
│                                                     │
│  Per-Tier Performance                               │
│  Tier 1: avg 1.2s, $0.002/req, 91% satisfaction   │
│  Tier 2: avg 3.4s, $0.018/req, 94% satisfaction   │
│  Tier 3: avg 8.1s, $0.089/req, 97% satisfaction   │
│                                                     │
│  Routing Accuracy Trends        [7d] [30d] [90d]   │
│  ▁▂▃▃▄▅▅▆▆▇▇█  improving ↑                        │
└─────────────────────────────────────────────────────┘
```

**Azioni:**
- [ ] Creare endpoint admin `GET /admin/orchestrator/stats` con metriche aggregage
- [ ] Creare pagina frontend `/admin/orchestrator` con dashboard
- [ ] Implementare auto-tuning: aggiustare soglie tier basandosi su override rate e feedback
- [ ] Alert se override rate > 15% o escalation rate > 25%

**Effort: ~25 ore**

### FASE 8.6 — ML-Based Router (Settimane 27-28) [OPZIONALE]

> Solo se le fasi precedenti mostrano che il rule-based + semantic non basta. **LLMRouterBench (Jan 2026) ha dimostrato che spesso router ML non battono baseline semplici.**

**Approccio consigliato:** [RouteLLM](https://github.com/lm-sys/RouteLLM) con il router Matrix Factorization:
- Leggero (non richiede GPU per inference)
- Trainato su dati Chatbot Arena
- Generalizza tra coppie di modelli diversi
- Integrabile come microservizio Python

**Alternativa self-hosted:** Trainare un classificatore DistilBERT sui dati di `routing_decisions` accumulati nelle fasi precedenti:
- Input: query + metadata (lunghezza, ha allegati, num messaggi)
- Output: tier prediction
- Training data: decisioni con feedback positivo + override corrections

**Effort: ~40 ore (include training pipeline, serving, integration)**

---

### Riepilogo Fase 8

| Sotto-fase | Settimane | Effort | Risparmio Atteso | Complessita |
|------------|-----------|--------|------------------|-------------|
| 8.1 Rule-Based Router | 17-18 | 30h | 30-40% | Bassa |
| 8.2 Adaptive Effort | 19-20 | 12h | +20% | Bassa |
| 8.3 Cascade Pattern | 21-22 | 25h | +15-25% | Media |
| 8.4 Semantic Router | 23-24 | 20h | +10% (accuratezza) | Media |
| 8.5 Feedback Loop | 25-26 | 25h | Ottimizzazione continua | Media |
| 8.6 ML Router [OPZ] | 27-28 | 40h | +5-10% | Alta |
| **TOTALE** | **12 sett** | **152h** (112h senza 8.6) | **60-75%** | |

**Risparmio cumulativo stimato:** Da "sempre Opus" a routing intelligente = **60-75% riduzione costi** mantenendo 95%+ della qualita percepita.

### Dipendenze

```
FASE 8.1 (Rules) ───────────────────────────────────────────▶ PRODUZIONE
     │                                                          ↑
     ├──▶ FASE 8.2 (Effort) ──────────────────────────────────┤
     │                                                          │
     ├──▶ FASE 8.3 (Cascade) ─────────────────────────────────┤
     │         │                                                │
     │         └── richiede quality checker funzionante         │
     │                                                          │
     └──▶ FASE 8.4 (Semantic) ────────────────────────────────┤
                                                                │
          FASE 8.5 (Feedback) ── richiede dati da 8.1-8.4 ────┤
                    │                                           │
                    └──▶ FASE 8.6 (ML) ── richiede dati da 8.5 ┘
```

**Nota:** Ogni sotto-fase e deployabile indipendentemente. Si puo mettere in produzione gia dalla 8.1 e iterare.

### Fonti Principali

- [RouteLLM](https://github.com/lm-sys/RouteLLM) — ICLR 2025, 85% cost reduction su MT-Bench
- [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) — 16+ algoritmi di routing
- [Aurelio Semantic Router](https://github.com/aurelio-labs/semantic-router) — Sub-millisecond routing
- [LiteLLM Routing](https://docs.litellm.ai/docs/routing) — Gateway con 6 strategie
- [Anthropic Adaptive Thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [LLMRouterBench](https://arxiv.org/abs/2601.07206) — Benchmark unificato Jan 2026
- [RouteLLM Paper](https://arxiv.org/abs/2406.18665) — Formalizzazione del problema
- [LogRocket LLM Routing Guide](https://blog.logrocket.com/llm-routing-right-model-for-requests/)
- [Perplexity Architecture](https://blog.bytebytego.com/p/how-perplexity-built-an-ai-google)
- [OpenRouter Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router)

---

## FASE 9 — Upgrade Modello Embedding: Velocizzazione Auto-Routing & RAG (Settimane 29-31)

> **Obiettivo:** Sostituire `nomic-embed-text` (768d, 274MB) con un modello più veloce e/o di qualità superiore per ridurre la latenza dell'auto-routing e migliorare la pipeline RAG/memory.

### Stato Attuale

| Componente | Valore Corrente | Note |
|---|---|---|
| **Modello embedding** | `nomic-embed-text:latest` (274MB) | 768 dimensioni, 8192 token context |
| **Modello alternativo installato** | `bge-m3:latest` (1.2GB) | 1024 dimensioni, 8192 token context |
| **Vector store** | Qdrant v1.12.1 (K8s StatefulSet) | Collezioni: `document_chunks`, `episodic_memory`, `declarative_memory`, `procedural_memory` |
| **Caching** | Redis (SHA-256 hash → embedding JSON, TTL 24h) | Funzionante |
| **Latenza stimata nomic** | ~3ms per query (RTX 5090) | Accettabile ma migliorabile |
| **Supporto lingue** | Solo inglese (nomic-embed-text v1.5) | **PROBLEMA: il sistema usa italiano + inglese** |

### Hardware Disponibile

| Componente | Specifica |
|---|---|
| CPU | Intel Core Ultra 9 285K (24 core, 7.3 GHz boost) |
| RAM | 64 GB DDR5 |
| GPU | NVIDIA RTX 5090, 32 GB VRAM, CUDA 13.1 |
| Ollama | Docker container con GPU passthrough |

### Analisi Comparativa — Modelli Embedding (Marzo 2026)

> Ricerca effettuata su: GitHub, Reddit, StackOverflow, Hugging Face MTEB Leaderboard, blog Elephas/Collabnix/BentoML/AIMultiple, paper ICLR/arxiv.

**Legenda:** ✅ = supportato | ❌ = non supportato | 🟡 = parziale

| # | Modello | Params | Dim. | Context | Size Disco | MTEB Score | Latenza RTX 5090 | Multilingua (IT) | Ollama |
|---|---------|--------|------|---------|-----------|------------|-------------------|-------------------|--------|
| 1 | **granite-embedding:30m** | 30M | 384 | 512 | 63 MB | ~52 | **<1ms** | ❌ EN only | ✅ |
| 2 | **snowflake-arctic-embed:110m** | 110M | 768 | 512 | 220 MB | ~55 | **~2ms** | 🟡 limitato | ✅ |
| 3 | **nomic-embed-text** (attuale) | 137M | 768 | 8192 | 274 MB | 62.4 | **~3ms** | ❌ EN only | ✅ |
| 4 | **embeddinggemma:300m** | 308M | 768 | 2048 | ~200 MB (QAT) | 61.2 (multi) | **~3-5ms** | ✅ 100+ lingue | ✅ |
| 5 | **nomic-embed-text-v2-moe** | 475M (305M attivi) | 768 | 8192 | ~550 MB | MIRACL 65.8 | **~4-6ms** | ✅ 100+ lingue | ✅ |
| 6 | **qwen3-embedding:0.6b** | 600M | 32-1024 | 32K | 639 MB | **70.7 (EN v2)** / 64.3 (multi) | **~5-8ms** | ✅ 100+ lingue | ✅ |
| 7 | **bge-m3** (installato) | 567M | 1024 | 8192 | 1.2 GB | ~63 / retrieval 72% | **~6-10ms** | ✅ 100+ lingue | ✅ |
| 8 | **snowflake-arctic-embed2:568m** | 568M | 1024 | 8192 | 1.1 GB | ~55 (nDCG@10) | **~5-8ms** | ✅ IT testato (CLEF) | ✅ |
| 9 | **mxbai-embed-large** | 335M | 1024 | 512 | 670 MB | 64.7 (retrieval) | **~4-6ms** | ❌ EN only | ✅ |

### Problema Critico: Nomic è Solo Inglese

`nomic-embed-text` v1.5 **non supporta l'italiano**. Il sistema Enterprise AI Chat è usato in italiano come lingua primaria. Gli embedding generati per query in italiano producono rappresentazioni semantiche di bassa qualità, degradando:
- La classificazione semantica nell'auto-routing (se riattivata)
- La ricerca RAG nei documenti in italiano
- La memoria vettoriale episodica/dichiarativa

### Raccomandazione

**Approccio a 2 livelli (speed + quality):**

| Uso | Modello Raccomandato | Perché |
|-----|---------------------|--------|
| **Auto-routing (classificazione tier)** | `snowflake-arctic-embed:110m` | <2ms, 768d, sufficiente per classificare 6 categorie di task. Matryoshka a 256d per ulteriore velocità |
| **RAG + Memory vettoriale** | `qwen3-embedding:0.6b` | MTEB 70.7 (top <1B), 32K context, multilingua (IT+EN), dimensioni flessibili |

**Alternativa single-model:** `bge-m3` (già installato) — multilingua eccellente, 1024d, 8K context, ma ~6-10ms. Accettabile se la semplicità di un singolo modello è prioritaria.

### Fonti della Ricerca

- [MTEB Leaderboard — Hugging Face](https://huggingface.co/spaces/mteb/leaderboard) (classifica embedding, Marzo 2026)
- [Qwen3-Embedding-0.6B — HuggingFace](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) (paper + benchmark)
- [Qwen3 Embedding Blog](https://qwenlm.github.io/blog/qwen3-embedding/) (architettura instruction-aware)
- [BGE-M3 — HuggingFace](https://huggingface.co/BAAI/bge-m3) (dense + sparse + multi-vector)
- [Snowflake Arctic Embed 2.0 — Blog](https://www.snowflake.com/en/engineering-blog/snowflake-arctic-embed-2-multilingual/) (benchmark CLEF su IT)
- [EmbeddingGemma — Google Blog](https://developers.googleblog.com/en/introducing-embeddinggemma/) (QAT quantization)
- [Nomic Embed v2-MoE — HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe) (MoE architecture)
- [Collabnix Ollama Embedding Guide](https://collabnix.com/ollama-embedded-models-the-complete-technical-guide-to-local-ai-embeddings-in-2025/)
- [Elephas — 13 Best Embedding Models 2026](https://elephas.app/blog/best-embedding-models)
- [BentoML — Open Source Embedding Guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)
- [AIMultiple — Open Source Embedding Benchmark](https://research.aimultiple.com/open-source-embedding-models/)
- [RTX 5090 Ollama Benchmark — DatabaseMart](https://www.databasemart.com/blog/ollama-gpu-benchmark-rtx5090)
- [Ollama vs vLLM — Red Hat](https://developers.redhat.com/articles/2025/08/08/ollama-vs-vllm-deep-dive-performance-benchmarking)

---

### FASE 9.1 — Pull & Benchmark Modelli Candidati (Settimana 29)

**Obiettivo:** Scaricare i modelli candidati e misurare latenza reale sull'hardware in uso.

**Azioni:**

```bash
# Pull modelli candidati
docker exec ollama ollama pull qwen3-embedding:0.6b
docker exec ollama ollama pull snowflake-arctic-embed:110m
docker exec ollama ollama pull embeddinggemma:300m
docker exec ollama ollama pull nomic-embed-text-v2-moe

# bge-m3 già installato — verificare versione
docker exec ollama ollama list | grep bge
```

**Script di benchmark:**

```bash
# Test latenza per ogni modello (10 iterazioni, query tipiche IT+EN)
for MODEL in nomic-embed-text bge-m3 qwen3-embedding:0.6b snowflake-arctic-embed:110m embeddinggemma:300m nomic-embed-text-v2-moe; do
  echo "--- $MODEL ---"
  for i in $(seq 1 10); do
    START=$(date +%s%N)
    curl -s http://10.0.1.1:8086/ollama/api/embed \
      -H "X-Ollama-Key: mTLS-k8s-backend-2026" \
      -d "{\"model\":\"$MODEL\",\"input\":\"Analizza l'architettura del microservizio di autenticazione e proponi miglioramenti\"}" > /dev/null
    END=$(date +%s%N)
    echo "  Run $i: $(( (END - START) / 1000000 ))ms"
  done
done
```

**Output atteso:** Tabella con p50, p95, p99 per ogni modello su query in italiano.

**Effort:** ~4 ore

---

### FASE 9.2 — Migrazione Qdrant Collections (Settimana 29-30)

> **ATTENZIONE:** Cambiare modello embedding = cambiare dimensionalità dei vettori. Le collezioni Qdrant esistenti **non sono compatibili** e devono essere ricreate.

**Piano di migrazione:**

1. **Backup collezioni esistenti** (export metadata)
   ```bash
   # Snapshot Qdrant
   curl -X POST 'http://qdrant:6333/collections/document_chunks/snapshots'
   curl -X POST 'http://qdrant:6333/collections/episodic_memory/snapshots'
   curl -X POST 'http://qdrant:6333/collections/declarative_memory/snapshots'
   curl -X POST 'http://qdrant:6333/collections/procedural_memory/snapshots'
   ```

2. **Eliminare collezioni vecchie** (i vettori a 768d non sono riusabili)

3. **Ricreare collezioni** con nuove dimensioni
   - Se `qwen3-embedding:0.6b` → 1024d (o custom)
   - Se `bge-m3` → 1024d
   - Se `snowflake-arctic-embed:110m` → 768d (o Matryoshka 256d)

4. **Re-embedding batch** di tutti i documenti esistenti
   - Query tutti i chunk dalla tabella `document_chunks` del DB
   - Rigenerare embedding con il nuovo modello
   - Upsert in Qdrant in batch da 20

**Effort:** ~8 ore

---

### FASE 9.3 — Aggiornamento EmbeddingService.ts (Settimana 30)

**Modifiche necessarie in `backend/src/services/EmbeddingService.ts`:**

1. **Aggiornare la detection delle dimensioni** (riga 90-93):
   ```typescript
   // Vecchio (hardcoded)
   let dimensions = 1536;
   if (embeddingModel.model_id.includes('nomic')) dimensions = 768;
   if (embeddingModel.model_id.includes('3-large')) dimensions = 3072;

   // Nuovo (dinamico — query le dimensioni reali dall'API)
   // Opzione A: Detect da risposta Ollama (embedding.length)
   // Opzione B: Tabella ai_models con colonna embedding_dimensions
   // Opzione C: Mappa configurabile EMBEDDING_DIMENSIONS
   ```

2. **Supporto Ollama `/api/embed` (nuovo endpoint):**
   - Ollama ha deprecato `/api/embeddings` a favore di `/api/embed`
   - Il nuovo endpoint supporta batch nativo (`input: string[]`)
   - Aggiungere supporto batch per Ollama (attualmente solo sequenziale)

3. **Supporto Matryoshka (dimensioni ridotte):**
   - Aggiungere parametro opzionale `truncateDimensions` a `generateEmbedding()`
   - Per il routing: usare 256d (veloce)
   - Per RAG: usare dimensioni piene (1024d)

4. **Invalidazione cache:**
   - Quando si cambia modello, i vecchi embedding in Redis sono invalidi
   - Flush delle chiavi `embedding:*` durante la migrazione

**Effort:** ~6 ore

---

### FASE 9.4 — Riattivazione Semantic Router (Opzionale — Settimana 30-31)

> Nella FASE 8 il SemanticRouter è stato eliminato (dead code). Con un modello embedding multilingua e veloce, ha senso riattivarlo.

**Se riattivato:**
1. Creare `SemanticRouterV2.ts` — versione snella
2. Pre-calcolare embedding per le 6 categorie di task (dal ROADMAP FASE 8.4)
3. Cache in Redis (ricalcolo solo al cambio modello)
4. Cosine similarity su vettori a 256d (Matryoshka) → <1ms su RTX 5090
5. Soglia minima: 0.65 — sotto la soglia, fallback al rule-based router
6. Integrazione nel `ModelRouter.route()` come metodo aggiuntivo

**Effort:** ~8 ore (opzionale)

---

### FASE 9.5 — Pulizia & Rimozione Modelli Obsoleti (Settimana 31)

**Azioni:**

1. **Rimuovere nomic-embed-text da Ollama** (se sostituito):
   ```bash
   docker exec ollama ollama rm nomic-embed-text
   ```

2. **Aggiornare DB `ai_models`**: disabilitare il vecchio modello, abilitare il nuovo

3. **Aggiornare `model-capabilities.ts`**: aggiungere pattern per il nuovo modello

4. **Verificare tutte le collezioni Qdrant**: dimensioni corrette, conteggio vettori

5. **Benchmark finale**: confronto latenza prima/dopo su 100 query reali

6. **Aggiornare README.md**: documentare il nuovo modello embedding

**Effort:** ~4 ore

---

### Timeline Riepilogativa FASE 9

```
Settimana 29   Settimana 30        Settimana 31
│               │                   │
├── 9.1 ────┐   ├── 9.3 ──────────┐ ├── 9.5 ────┐
│  Pull &    │   │  EmbeddingService│ │  Cleanup   │
│  Benchmark │   │  refactoring     │ │  & verify  │
│            │   │                  │ │            │
├── 9.2 ────┤   ├── 9.4 ──────────┤ │            │
│  Qdrant    │   │  SemanticRouter  │ │            │
│  migration │   │  V2 (opzionale)  │ │            │
└────────────┘   └──────────────────┘ └────────────┘
```

**Effort totale FASE 9:** ~30 ore (22 ore core + 8 ore opzionali per SemanticRouter V2)

**Prerequisiti:**
- FASE 8.1 completata (ModelRouter funzionante) ✅
- Hardware RTX 5090 operativo ✅
- Qdrant K8s StatefulSet attivo ✅

**Dipendenze:**
```
FASE 9.1 (Benchmark) ───▶ FASE 9.2 (Qdrant) ───▶ FASE 9.3 (Service)
                                                        │
                                                   FASE 9.4 (Semantic, opzionale)
                                                        │
                                                   FASE 9.5 (Cleanup)
```

---

*Documento generato dall'analisi automatica del codebase il 2026-03-01.*
*Aggiornato il 2026-03-02 con FASE 9 — Upgrade Modello Embedding.*
*Aggiornare questo documento ad ogni milestone raggiunta.*
