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

*Documento generato dall'analisi automatica del codebase il 2026-03-01.*
*Aggiornare questo documento ad ogni milestone raggiunta.*
