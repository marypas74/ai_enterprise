# Enterprise AI Chat — Report Architetturale e Stima di Valore

**Versione:** 1.7.9
**Data:** 28 Febbraio 2026
**Tipo:** Piattaforma AI Enterprise Full-Stack

---

## 1. EXECUTIVE SUMMARY

**Enterprise AI Chat** è una piattaforma di intelligenza artificiale enterprise completa, composta da:

- **Backend API** (Fastify 5 + TypeScript) — 98 file, ~32.800 LOC
- **Frontend Web** (React 18 + Vite + Tailwind) — 49 file, ~17.000 LOC
- **Estensione VS Code** (TypeScript + React Webview) — 25 file, ~10.100 LOC
- **Infrastruttura Kubernetes** (10 servizi containerizzati)
- **Database** (MariaDB con 50+ tabelle)

**Totale codice sorgente: 179 file, ~64.900 righe di codice TypeScript/TSX**

---

## 2. ARCHITETTURA DEL SISTEMA

### 2.1 Stack Tecnologico

| Livello | Tecnologia | Dettaglio |
|---------|-----------|-----------|
| **Backend** | Node.js 20, Fastify 5, TypeScript 5.6 | API REST + WebSocket + SSE streaming |
| **Frontend** | React 18, Vite 6, Tailwind CSS 3.4, Zustand 5 | SPA con dark mode, responsive |
| **Estensione IDE** | VS Code Extension API, Webpack, esbuild | 30+ comandi, webview React |
| **Database** | MariaDB 10.11 | 50+ tabelle, auto-migrazione |
| **Cache** | Redis 7 | Sessioni, rate limiting, cache |
| **Vector DB** | Qdrant 1.12 | Embeddings per RAG |
| **AI Providers** | OpenAI, Anthropic, Google, Ollama | Multi-provider con failover |
| **Container** | Docker multi-stage | Backend ~1.2GB (con LibreOffice, OCR) |
| **Orchestrazione** | MicroK8s (Kubernetes) | 10 servizi, network policies, RBAC |
| **Reverse Proxy** | Cloudflare Tunnel + Nginx | TLS, rate limiting, IP restriction |

### 2.2 Diagramma dei Servizi

```
                    ┌─────────────────────┐
                    │  Cloudflare Tunnel   │
                    │  plane.lushlolli.com │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │   Nginx Ingress     │
                    │   (Rate Limiting)   │
                    └──────┬──────┬───────┘
                           │      │
              ┌────────────▼┐  ┌──▼────────────┐
              │  Frontend   │  │   Backend API  │
              │  (React)    │  │   (Fastify)    │
              │  ×2 repliche│  │   ×2 repliche  │
              └─────────────┘  └──┬──┬──┬──┬────┘
                                  │  │  │  │
          ┌───────────────────────┘  │  │  └──────────────────┐
          │              ┌───────────┘  └──────────┐          │
    ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐  ┌────────▼────────┐
    │  MariaDB  │  │   Redis   │  │   Qdrant    │  │    LiteLLM      │
    │  (50+ tb) │  │  (Cache)  │  │ (Vectors)   │  │  (LLM Proxy)    │
    └───────────┘  └───────────┘  └─────────────┘  └─────────────────┘

    ┌───────────┐  ┌───────────┐  ┌─────────────┐  ┌─────────────────┐
    │  Parlant  │  │ Open WebUI│  │ Browserless │  │  Doc Processor  │
    │ (Agents)  │  │ (Ollama)  │  │ (Chromium)  │  │  (Documenti)    │
    └───────────┘  └───────────┘  └─────────────┘  └─────────────────┘

                    ┌───────────┐
                    │  Ollama   │  ← Docker su host (GPU)
                    │ (LLM loc.)│
                    └───────────┘
```

---

## 3. BACKEND — Dettaglio Moduli (21 moduli)

| # | Modulo | Descrizione | Complessità |
|---|--------|-------------|-------------|
| 1 | **auth** | Autenticazione (JWT, OAuth Google, MFA/TOTP, sessioni) | Alta |
| 2 | **chat** | Chat AI con streaming SSE, gestione conversazioni, multi-provider | Molto Alta |
| 3 | **admin** | Pannello admin (utenti, gruppi, permessi, provider, plugin, audit) | Molto Alta |
| 4 | **agents** | Integrazione Claude Agent SDK, sessioni agenti, template, conflitti | Molto Alta |
| 5 | **orchestrator** | Coordinamento multi-agente, distribuzione task, dashboard metriche | Alta |
| 6 | **projects** | Gestione progetti con Kanban board (colonne, card, label, checklist) | Alta |
| 7 | **tasks** | Gestione task/card, assegnazione, tracking | Media |
| 8 | **activity** | Feed attività utente, logging | Bassa |
| 9 | **attachments** | Upload file con preprocessing (PDF, OCR, documenti) | Alta |
| 10 | **files** | Operazioni I/O file, gestione file progetto | Media |
| 11 | **downloads** | Consegna documenti generati | Bassa |
| 12 | **tools** | Generazione documenti (Word, Excel, PowerPoint, PDF) | Alta |
| 13 | **memory** | Memoria episodica/dichiarativa/procedurale, vector store | Molto Alta |
| 14 | **forms** | Form conversazionali con validazione JSON schema | Media |
| 15 | **ingestion** | Web scraping, ingestione documenti, pipeline RAG | Alta |
| 16 | **scheduler** | Job schedulati (one-shot, intervallo, cron) | Media |
| 17 | **ai** | Factory multi-provider AI (OpenAI, Anthropic, Google, Ollama) | Alta |
| 18 | **parlant** | Integrazione framework agenti Python | Media |
| 19 | **ralph** | Implementazione loop iterativo di auto-riflessione | Alta |
| 20 | **geo** | Funzionalità geo-localizzazione | Bassa |
| 21 | **public** | Endpoint pubblici (metriche, status) | Bassa |

### Endpoint API: 150+ route REST + 3 endpoint WebSocket

### Integrazioni AI Provider:
- **OpenAI** (GPT-4o, GPT-4-turbo, o1, o3-mini)
- **Anthropic** (Claude 3 Opus, Claude 3.5 Sonnet, Claude 3 Haiku)
- **Google Gemini** (2.0 Flash, 1.5 Pro/Flash)
- **Ollama** (modelli locali su GPU)
- **Endpoint HTTP Custom** (configurabili)

### Servizi Background:
- Sincronizzazione modelli LLM
- Decay memoria (osservazioni)
- Pulizia conversazioni (archiviazione >24h, eliminazione >60gg)
- Job scheduler (cron/intervallo/webhook)
- Worker OCR (Tesseract.js, pool parallelo)
- Client MCP (Model Context Protocol)

---

## 4. FRONTEND — Dettaglio Pagine e Funzionalità

### 4.1 Pagine Principali (8)

| Pagina | Descrizione | LOC |
|--------|-------------|-----|
| **ChatPage** | Interfaccia chat AI con streaming, allegati, markdown, generazione documenti | 1.120 |
| **AutoClaudePage** | Gestione sessioni agenti autonomi, WebSocket real-time, worktree Git | 1.063 |
| **AdminPage** | Hub amministrativo con 22 sotto-pagine | 678 |
| **ProjectsPage** | Kanban board con drag-and-drop, priorità, checklist | 611 |
| **ParlantPage** | Interfaccia agenti Parlant (guidelines, sessioni, eventi) | 649 |
| **PublicMonitorPage** | Dashboard metriche pubblica (no auth) | 487 |
| **SettingsPage** | Impostazioni utente e MFA | 333 |
| **LoginPage** | Autenticazione con supporto MFA | 196 |

### 4.2 Sotto-Pagine Admin (22)

Gestione provider AI, modelli, skill, plugin, agenti, template prompt, sessioni attive, utenti/gruppi, permessi, scheduler, monitor sistema, memoria/vettori, conversazioni archiviate, webhook/hook, grafo plugin, debug, form dinamici.

### 4.3 Funzionalità Chiave

- Chat AI in tempo reale con streaming SSE
- Supporto multi-provider con selezione modello
- Upload e processing file (immagini, PDF, DOCX, XLSX)
- Generazione documenti (Word, Excel, PowerPoint, PDF)
- Sistema memoria con pannello contestuale
- Kanban board completo (drag-and-drop, priorità, checklist, commenti)
- Sessioni agenti autonomi con monitoraggio WebSocket
- Pannello admin completo (22 sotto-pagine)
- Dark mode completo
- Timeout inattività (20 minuti)
- Autenticazione JWT + MFA (TOTP)

---

## 5. ESTENSIONE VS CODE

### 5.1 Comandi (30+)

| Categoria | Comandi | Descrizione |
|-----------|---------|-------------|
| **Chat** | 4 | Apri pannello, nuova chat, invia messaggio, chat agentico |
| **Code Actions** | 7 | Spiega codice, fix, migliora, genera test, inline edit (Ctrl+K) |
| **Autenticazione** | 4 | Login backend, logout, login Claude Pro, configurazione |
| **AI Toolkit** | 4 | Template prompt, playground modelli, RAG search, info versione |
| **Conversazioni** | 3 | Carica storia, carica/elimina conversazione, seleziona modello |
| **Kanban** | 4 | Carica progetti, seleziona progetto, sposta card, completa task |
| **Agenti** | 7 | Pannello agenti, crea/avvia/pausa/riprendi/annulla sessione |

### 5.2 Componenti Webview (13)
- ChatContainer, MessageBubble, CodeBlock, ChatInput, FloatingInput
- MainLayout (Agent Panel), KanbanPanel, MessageArea, WelcomeHero
- BotIcon, LoadingIndicator, ScrollToBottomButton
- Hook personalizzati: useStreamingText, useAutoScroll

### 5.3 Funzionalità Avanzate
- Integrazione diretta con Claude API (modalità Pro)
- Caricamento istruzioni custom dal workspace
- Model Playground con parametri regolabili
- RAG search nel codebase
- Supporto multi-provider (stesse integrazioni del backend)

---

## 6. INFRASTRUTTURA KUBERNETES

### 6.1 Servizi Deployati (10)

| Servizio | Tipo | Repliche | Risorse (CPU/Mem) |
|----------|------|----------|-------------------|
| Backend | Deployment | 2 | 500m-4000m / 1-8Gi |
| Frontend | Deployment | 2 | 50-100m / 64-128Mi |
| MariaDB | StatefulSet | 1 | 250-500m / 512Mi-1Gi |
| Redis | StatefulSet | 1 | 100-200m / 128-256Mi |
| Qdrant | StatefulSet | 1 | 200-500m / 256-512Mi |
| LiteLLM | Deployment | 1 | default |
| Parlant | Deployment | 1 | 250m-1000m / 512Mi-2Gi |
| Open WebUI | Deployment | 1 | default |
| Browserless | Deployment | 1 | 250m-1000m / 512-1536Mi |
| Doc Processor | Deployment | 1 | 200-500m / 256Mi-1Gi |

### 6.2 Risorse Totali Cluster
- **CPU Requests:** ~2.6 core
- **CPU Limits:** ~15 core
- **Memory Requests:** ~4 GB
- **Memory Limits:** ~15 GB

### 6.3 Storage Persistente

| Volume | Dimensione | Uso |
|--------|-----------|-----|
| MariaDB PVC | 10 Gi | Database |
| Redis PVC | 1 Gi | Cache |
| Qdrant PVC | 2 Gi | Vettori |
| Parlant PVC | 5 Gi | Dati agenti |
| Open WebUI PVC | 10 Gi | Interfaccia Ollama |
| Shared Projects PV | 100 Gi | Progetti, estensioni, repository |
| **Totale** | **128 Gi** | |

### 6.4 Sicurezza Infrastruttura
- Network Policies (default deny + whitelist per servizio)
- RBAC (ServiceAccount backend-monitor con permessi minimi)
- Secrets criptati (DB, JWT, chiavi API, certificati mTLS)
- Container non-root (UID 1001)
- Rate limiting su ingress (10 RPS, 300 RPM)
- Cloudflare Tunnel con IP restriction applicativa

---

## 7. DATABASE — Schema (50+ tabelle)

| Dominio | Tabelle | Descrizione |
|---------|---------|-------------|
| **Autenticazione** | 6 | users, refresh_tokens, groups, user_groups, api_keys, user_sessions |
| **Provider AI** | 4 | ai_providers, ai_provider_settings, ai_models, group_model_permissions |
| **Conversazioni** | 2 | conversations, messages |
| **Token & Billing** | 2 | token_usage, monthly_usage |
| **Audit** | 2 | audit_log, activity_log |
| **Plugin & Skill** | 8 | plugins, plugin_settings, skills, tools, user_permissions, etc. |
| **Tool & MCP** | 3 | tool_executions, mcp_servers, user_mcp_permissions |
| **Kanban** | 11 | projects, boards, columns, cards, labels, comments, checklist, etc. |
| **Memoria** | 5 | memory_observations, memory_summaries, memory_settings, vector_index_status, recall_log |
| **Form** | 2 | conversational_forms, form_sessions |
| **Scheduler** | 2 | scheduled_jobs, job_executions |
| **Altro** | 3+ | system_settings, document_chunks, web_ingestions, prompt_templates |

---

## 8. RIEPILOGO QUANTITATIVO

| Metrica | Valore |
|---------|--------|
| **File sorgente TypeScript/TSX** | 179 |
| **Righe di codice totali** | ~64.900 |
| **Moduli backend** | 21 |
| **Endpoint API REST** | 150+ |
| **Endpoint WebSocket** | 3 |
| **Pagine frontend** | 30 (8 principali + 22 admin) |
| **Comandi VS Code** | 30+ |
| **Tabelle database** | 50+ |
| **Servizi Kubernetes** | 10 |
| **Dipendenze npm (produzione)** | 45+ (backend) + 13 (frontend) + 5 (extension) |
| **Provider AI integrati** | 5 (OpenAI, Anthropic, Google, Ollama, Custom) |
| **Modelli AI supportati** | 20+ |
| **Storage persistente** | 128 Gi |
| **Versione corrente** | 1.7.9 |

---

## 9. STIMA DEL VALORE DEL PROGETTO

### 9.1 Metodologia di Stima

La stima si basa su:
- **COCOMO II** (Constructive Cost Model) adattato
- **Tariffe di mercato** per sviluppo enterprise in Italia/Europa (2025-2026)
- **Complessità architetturale** del sistema
- **Valore di mercato** di piattaforme AI comparabili

### 9.2 Scomposizione per Componente

| Componente | LOC | Giorni/Uomo Stimati | Costo Unitario (€/giorno) | Valore (€) |
|------------|-----|---------------------|---------------------------|------------|
| **Backend API** | 32.800 | 120-150 | 450-600 | 54.000 – 90.000 |
| **Frontend Web** | 17.000 | 60-80 | 400-550 | 24.000 – 44.000 |
| **Estensione VS Code** | 10.100 | 40-55 | 450-600 | 18.000 – 33.000 |
| **Infrastruttura K8s** | — | 25-35 | 500-650 | 12.500 – 22.750 |
| **Database Design** | 50+ tabelle | 15-20 | 450-600 | 6.750 – 12.000 |
| **Integrazione AI (5 provider)** | — | 20-30 | 500-650 | 10.000 – 19.500 |
| **Sistema Memoria/RAG** | — | 15-20 | 500-650 | 7.500 – 13.000 |
| **Sicurezza & Auth** | — | 10-15 | 500-650 | 5.000 – 9.750 |
| **Testing & QA** | — | 15-20 | 400-550 | 6.000 – 11.000 |
| **DevOps & CI/CD** | — | 10-15 | 500-650 | 5.000 – 9.750 |
| **Documentazione** | — | 5-8 | 350-450 | 1.750 – 3.600 |

### 9.3 Totale Stimato

| | Stima Bassa | Stima Media | Stima Alta |
|---|------------|-------------|------------|
| **Giorni/Uomo** | 335 | 400 | 448 |
| **Valore Sviluppo** | €150.500 | €194.000 | €268.350 |
| **Overhead (PM, analisi, riunioni) +15%** | €22.575 | €29.100 | €40.253 |
| **TOTALE PROGETTO** | **€173.075** | **€223.100** | **€308.603** |

### 9.4 Valore di Mercato Comparativo

Piattaforme AI enterprise comparabili (con chat multi-provider, gestione agenti, RAG, Kanban, estensione IDE):

| Piattaforma | Tipo | Prezzo di listino |
|-------------|------|-------------------|
| Dust.tt | SaaS AI Platform | $29-89/utente/mese |
| Langflow | Open Source AI Builder | Self-hosted / Enterprise custom |
| Dify.ai | LLM App Platform | $159-499/mese (team) |
| Continue.dev | IDE AI Extension | Open Source / Enterprise custom |

**La piattaforma Enterprise AI Chat combina funzionalità che normalmente richiederebbero 3-4 prodotti separati:**
1. Chat AI multi-provider (come ChatGPT Team/Enterprise)
2. Framework agenti autonomi (come Langflow/CrewAI)
3. Project management con Kanban (come Trello/Jira)
4. Estensione IDE (come Continue/Cursor)

### 9.5 Nota sulla Stima

La stima considera:
- Sviluppo da zero (greenfield) con le specifiche attuali
- Tariffa giornaliera senior developer: €450-650/giorno
- Mercato italiano/europeo 2025-2026
- Non include: costi infrastrutturali (server, cloud, licenze), manutenzione evolutiva, supporto

---

## 10. VOCI PER FATTURAZIONE

### Macro-voci consigliabili per fattura:

1. **Analisi e progettazione architetturale** — Design sistema distribuito, scelta stack tecnologico, modello dati
2. **Sviluppo Backend API** — 21 moduli, 150+ endpoint, integrazioni AI, sistema memoria/RAG
3. **Sviluppo Frontend Web** — 30 pagine, chat real-time, pannello admin, Kanban board
4. **Sviluppo Estensione VS Code** — 30+ comandi, webview React, integrazione agenti
5. **Infrastruttura e DevOps** — Kubernetes (10 servizi), Docker, CI/CD, network security
6. **Progettazione Database** — Schema 50+ tabelle, auto-migrazione, ottimizzazione query
7. **Integrazione Provider AI** — 5 provider, streaming SSE, failover, load balancing
8. **Sicurezza Applicativa** — JWT/MFA, RBAC, encryption, rate limiting, network policies
9. **Testing e Quality Assurance** — E2E (Playwright), unit test (Vitest), validazione
10. **Documentazione tecnica** — Architettura, deployment, configurazione

---

*Report generato automaticamente dall'analisi del codebase v1.7.9*
*179 file sorgente, ~64.900 righe di codice, 50+ tabelle database, 10 servizi Kubernetes*
