# VS Code Extension Rewrite — Design Specification

**Data:** 2026-03-15
**Approccio:** Riscrittura completa con architettura modulare
**Versione target:** 3.0.0

## Decisioni di Design

| Area | Decisione |
|------|-----------|
| Modalità connessione | Solo backend (rimossa modalità Claude diretto) |
| Nuove funzionalità | Documenti/RAG, Template Agenti, Worktree/Conflitti, Orchestratore, Generazione Documenti |
| Funzionalità escluse | Voice (meglio su web/mobile), Compliance (solo admin web) |
| Webview | Multi-panel indipendenti (un bundle per panel) |
| Autenticazione | Invariata (username/password + TOTP, JWT in globalState) |
| Server URL default | `https://plane.lushlolli.com` |
| Selezione modelli | Solo dinamica da backend (`GET /api/chat/models`) |
| Apertura panel | Command Palette (nessuna Activity Bar aggiuntiva) |
| Generazione documenti | Chat + comando dedicato |
| Documenti/RAG | `@document` nella chat (nessun panel dedicato) |
| Orchestratore | Status bar + panel on-demand |
| Template agenti | Solo selezione (gestione su web UI) |
| Worktree/Conflitti | Integrata nel Source Control di VS Code |

## Architettura

```
vscode-extension/
├── src/
│   ├── extension.ts                    # Entry point (~50 righe, bootstrap moduli)
│   │
│   ├── core/                           # Service layer condiviso
│   │   ├── ApiClient.ts                # HTTP client verso backend
│   │   ├── AuthService.ts              # Login, JWT, refresh, TOTP
│   │   ├── ConfigService.ts            # Settings centralizzati
│   │   ├── EventBus.ts                 # Event emitter inter-modulo
│   │   └── types.ts                    # Tipi condivisi
│   │
│   ├── modules/
│   │   ├── chat/
│   │   │   ├── ChatPanel.ts            # WebviewPanel provider
│   │   │   ├── ChatCommands.ts         # Comandi registrati
│   │   │   └── ChatService.ts          # Logica chat, streaming SSE
│   │   │
│   │   ├── code-actions/
│   │   │   ├── CodeActionProvider.ts    # VS Code CodeActionProvider
│   │   │   └── CodeActionCommands.ts   # Comandi explain/fix/improve/tests
│   │   │
│   │   ├── documents/
│   │   │   ├── DocumentService.ts      # Upload, RAG search, generazione
│   │   │   ├── DocumentCommands.ts     # Comandi generazione DOCX/Excel/PDF
│   │   │   └── DocumentProvider.ts     # @document autocomplete nella chat
│   │   │
│   │   ├── agents/
│   │   │   ├── AgentPanel.ts           # Panel sessioni agente
│   │   │   ├── AgentCommands.ts        # Crea sessione, scegli template
│   │   │   └── AgentService.ts         # API sessioni, log streaming
│   │   │
│   │   ├── orchestrator/
│   │   │   ├── OrchestratorStatusBar.ts  # Indicatore status bar
│   │   │   ├── OrchestratorPanel.ts      # Panel dettagli on-demand
│   │   │   └── OrchestratorService.ts    # API slot, metriche
│   │   │
│   │   └── worktree/
│   │       ├── WorktreeScmProvider.ts    # SCM provider VS Code
│   │       ├── WorktreeCommands.ts       # Merge, discard, review
│   │       └── WorktreeService.ts        # API worktree, conflitti
│   │
│   └── utils/
│       ├── helpers.ts
│       └── constants.ts
│
├── webview-ui/
│   ├── shared/
│   │   ├── components/
│   │   │   ├── MessageBubble.tsx        # Rendering messaggi
│   │   │   ├── CodeBlock.tsx            # Syntax highlighting + copia
│   │   │   ├── StreamingText.tsx        # Testo streaming con cursore
│   │   │   ├── LoadingSpinner.tsx       # Spinner unificato
│   │   │   ├── ErrorBanner.tsx          # Banner errori
│   │   │   ├── ModelPicker.tsx          # Selettore modello dinamico
│   │   │   └── DocumentChip.tsx         # Chip @document selezionato
│   │   │
│   │   ├── hooks/
│   │   │   ├── useVsCodeApi.ts          # Comunicazione con extension host
│   │   │   ├── useStreaming.ts          # SSE streaming
│   │   │   ├── useModels.ts             # Fetch e cache modelli
│   │   │   └── useAuth.ts              # Stato autenticazione
│   │   │
│   │   └── theme/
│   │       └── main.css                 # CSS variables VS Code + stili base
│   │
│   ├── chat/index.tsx                   # Entry webview Chat
│   ├── agents/index.tsx                 # Entry webview Agenti
│   ├── orchestrator/index.tsx           # Entry webview Orchestratore
│   └── build.mjs                        # esbuild multi-entry
│
└── package.json
```

### Principi architetturali

- **`extension.ts` slim** (~50 righe): solo bootstrap dei moduli e lifecycle
- **`core/`** service layer condiviso: ogni modulo riceve i servizi via dependency injection
- **`modules/`** un modulo per dominio: ognuno registra i propri comandi, panel e provider
- **`EventBus`** comunicazione disaccoppiata: nessuna dipendenza diretta tra moduli
- **`webview-ui/shared/`** componenti React riutilizzabili: ogni panel importa solo cio che serve (tree-shaking)
- **File < 400 righe**, max 800: funzioni < 50 righe

## Core Service Layer

### ApiClient

Unico punto di contatto con il backend.

- Base URL da `ConfigService` (default: `https://plane.lushlolli.com`)
- JWT token injection automatica in ogni request
- Self-signed cert support (opzionale, via config `allowSelfSignedCerts`)
- Retry con backoff esponenziale (max 3 tentativi)
- SSE streaming per chat e log agenti (metodo dedicato `stream()`)
- Error handling centralizzato: 401 → refresh token, 403 → notifica utente

```typescript
ApiClient.get<T>(path, params?) → Promise<T>
ApiClient.post<T>(path, body?) → Promise<T>
ApiClient.delete<T>(path) → Promise<T>
ApiClient.stream(path, body?, onChunk, onError?) → AbortController
```

**Strategia SSE streaming:**
- Riconnessione automatica con backoff esponenziale (1s, 2s, 4s, max 30s)
- Max 5 tentativi di riconnessione, poi errore al chiamante
- `onError` callback per gestire errori a livello modulo (es. mostrare banner nel webview)
- Ogni modulo (chat, agents, orchestrator) usa `stream()` senza reimplementare la logica di reconnect

### AuthService

- Login: `POST /api/auth/login` con username/password + TOTP opzionale
- Token JWT in `globalState` (persistente tra sessioni VS Code)
- Refresh automatico prima della scadenza
- Stato auth esposto via `EventBus` (`auth:login`, `auth:logout`)
- Logout pulisce token e resetta stato di tutti i moduli

### ConfigService

- Wrappa `vscode.workspace.getConfiguration('enterprise-ai')`
- Metodi tipizzati: `getServerUrl()`, `getAllowSelfSigned()`, ecc.
- Listener su cambi configurazione → notifica moduli via `EventBus` (`config:changed`)
- Rimosse tutte le config Claude diretto

### EventBus

```
auth:login           → utente autenticato
auth:logout          → sessione terminata
config:changed       → configurazione aggiornata
models:loaded        → lista modelli disponibile
agent:started        → sessione agente avviata
agent:completed      → sessione agente completata
worktree:ready       → worktree pronta per merge
orchestrator:update  → stato slot cambiato
```

## Moduli

### Chat Module

Panel webview React. Funzionalita:

- Streaming SSE via `ApiClient.stream()`
- Selezione modello dinamica — `GET /api/chat/models` all'avvio, picker nel panel
- `@document` — autocomplete tra documenti indicizzati (`GET /api/documents`), iniettati come contesto RAG
- `@file` e `@selection` — invariati
- Conversazioni — lista, crea, elimina, rinomina via API
- Inline Edit — Ctrl+Shift+K su selezione (evita conflitto con Ctrl+K chord nativo di VS Code)
- Generazione documenti in chat — bottone "Scarica" quando l'AI genera un documento

### Code Actions Module

- `CodeActionProvider` registrato per tutti i linguaggi
- Azioni: Explain, Fix, Improve, Generate Tests
- Ogni azione apre chat con codice selezionato + prompt pre-compilato
- Menu contestuale nell'editor (sottomenu "Enterprise AI")

### Documents Module

Nessun panel dedicato. Due componenti:

1. **DocumentProvider** — `@document` autocomplete nella chat
   - Lista documenti da `GET /api/documents`
   - Cache locale con invalidazione su evento
   - Fuzzy matching sul nome
   - Implementato interamente nel webview React: il componente chat input intercetta `@document` e mostra un dropdown con risultati filtrati (non usa VS Code CompletionItemProvider, che non funziona nei webview)

2. **DocumentCommands** — generazione documenti da Command Palette
   - `Enterprise AI: Generate Document` → quick pick formato → input contenuto → backend → salva file
   - Supporto generazione anche via risposta chat (bottone scarica)

### Agents Module

- `Enterprise AI: New Agent Session` → quick pick template (`GET /api/agents/templates`) → input prompt → avvia
- `Enterprise AI: View Agent Sessions` → panel con lista sessioni
- Panel webview: lista sessioni (attive/completate/fallite), log SSE real-time, azioni pause/resume/cancel
- **Gestione errori sessioni:** se lo stream SSE si disconnette, il panel mostra banner "Connessione persa — riconnessione..." (gestito da ApiClient). Se la sessione fallisce lato backend, lo stato passa a "failed" con messaggio di errore visibile nel log
- EventBus: `agent:started` e `agent:completed` aggiornano status bar orchestratore

### Orchestrator Module

1. **OrchestratorStatusBar** — `StatusBarItem` con `$(pulse) 3/12 slots`
   - Polling ogni 10s su `GET /api/orchestrator/status` (configurabile via `orchestrator.pollingInterval`)
   - Click → apre panel dettagli
   - Colore: verde (< 50%), giallo (50-80%), rosso (> 80%)
   - Quando il panel e aperto, il polling si ferma (il panel usa SSE, evita richieste duplicate)

2. **OrchestratorPanel** — webview on-demand
   - Griglia 12 slot (occupato/libero, sessione associata)
   - Per slot attivo: nome agente, durata, progresso
   - Azioni: rilascia slot, termina sessione
   - Auto-refresh via SSE (`GET /api/orchestrator/events`)
   - Alla chiusura del panel, la status bar riprende il polling

### Worktree Module

Integrato nel Source Control VS Code. Le worktree sono git worktree create dal backend durante le sessioni agente. Il backend gestisce la creazione e il lifecycle; l'estensione le visualizza e offre azioni di merge.

**API backend:**
- `GET /api/agents/sessions/{id}/worktree` — stato worktree della sessione (path, branch, file modificati, conflitti)
- `POST /api/agents/sessions/{id}/worktree/merge` — merge worktree branch nel branch target
- `POST /api/agents/sessions/{id}/worktree/discard` — elimina worktree
- `GET /api/orchestrator/worktrees` — lista tutte le worktree attive

**WorktreeScmProvider** implementa `vscode.SourceControl` API:
- SCM provider "Enterprise AI Worktrees" — appare nella vista Source Control accanto a Git
- Ogni worktree attiva e un resource group con nome branch e sessione associata
- I file modificati sono `SourceControlResourceState` con diff inline (confronto branch worktree vs branch target)
- Polling su `GET /api/orchestrator/worktrees` ogni 15s + aggiornamento su evento `worktree:ready`

**Azioni SCM:**
- Merge to target branch (chiama `POST .../worktree/merge`, con conferma utente)
- Discard worktree (chiama `POST .../worktree/discard`)
- Open diff per file specifico (usa `vscode.commands.executeCommand('vscode.diff', ...)`)
- Resolve conflicts — apre editor merge nativo di VS Code sui file in conflitto

**Notifiche:** su evento `worktree:ready` via EventBus, mostra notification con azioni rapide (Merge, Review, Dismiss)

## Package.json

### Settings rimossi

- `useDirectClaude`
- `claudeAuthMode`
- `claudeApiKey`
- `claudeModel`
- `defaultModel`

### Settings aggiornati

- `serverUrl` — default: `https://plane.lushlolli.com`
- `allowSelfSignedCerts` — default: `false`

### Settings mantenuti

- `botIconStyle` — invariato (default, purple, sparkle, brain, chat, robot)

### Settings rimossi (aggiuntivi)

- `useReactUI` — rimosso, la riscrittura usa solo React (nessun fallback non-React)

### Settings nuovi

- `orchestrator.pollingInterval` — intervallo polling status bar (default: 10000ms)
- `orchestrator.showStatusBar` — mostra/nascondi indicatore (default: true)

### Comandi rimossi

- `loginClaudePro`
- `selectModel` (ora interno al panel chat)

### Comandi (prefisso uniforme `enterprise-ai.`)

**Chat:**
- `enterprise-ai.openChat` — Apri Chat
- `enterprise-ai.newChat` — Nuova Chat

**Code Actions:**
- `enterprise-ai.explainCode` — Explain Code
- `enterprise-ai.fixCode` — Fix Code
- `enterprise-ai.improveCode` — Improve Code
- `enterprise-ai.generateTests` — Generate Tests

**Context:**
- `enterprise-ai.addToChat` — Add to Enterprise AI
- `enterprise-ai.addFileToContext` — Add File to Context
- `enterprise-ai.chatWithContext` — Chat with Context
- `enterprise-ai.inlineEdit` — Inline Edit with AI

**Toolkit:**
- `enterprise-ai.useTemplate` — Use Prompt Template
- `enterprise-ai.ragSearch` — RAG Search

**Documenti:**
- `enterprise-ai.generateDocument` — Generate Document

**Agenti:**
- `enterprise-ai.newAgentSession` — New Agent Session
- `enterprise-ai.viewAgentSessions` — View Agent Sessions

**Orchestratore:**
- `enterprise-ai.openOrchestrator` — Open Orchestrator Dashboard

**Worktree:**
- `enterprise-ai.manageWorktrees` — Manage Worktrees

**Auth:**
- `enterprise-ai.login` — Login
- `enterprise-ai.logout` — Logout
- `enterprise-ai.configure` — Open Settings

**Diagnostica:**
- `enterprise-ai.showLogs` — Show Logs (apre Output Channel)

### Keybinding

| Comando | Shortcut | Condizione |
|---------|----------|------------|
| openChat | Ctrl+Shift+L | — |
| newChat | Ctrl+N | In chat view |
| addToChat | Ctrl+Shift+A | Selezione attiva |
| inlineEdit | Ctrl+Shift+K | Editor + selezione |
| chatWithContext | Ctrl+Shift+C | Editor text focus |
| useTemplate | Ctrl+Shift+T | — |
| ragSearch | Ctrl+Shift+R | — |
| generateDocument | Ctrl+Alt+G | — |
| newAgentSession | Ctrl+Alt+N | — |

### Menu contestuali

**Editor context menu** (sottomenu "Enterprise AI"):
- Inline Edit (con selezione)
- Chat with Context
- Add to Chat (con selezione)
- Explain Code (con selezione)
- Improve Code (con selezione)
- Fix Code (con selezione)
- Generate Tests (con selezione)

**Explorer context menu:**
- Add to Enterprise AI

## Attivazione e Diagnostica

### Activation Events

Attivazione lazy per garantire startup < 500ms:
- `onCommand:enterprise-ai.openChat`
- `onCommand:enterprise-ai.login`
- `onCommand:enterprise-ai.explainCode` (e altri code action commands)
- `onCommand:enterprise-ai.newAgentSession`
- `onCommand:enterprise-ai.openOrchestrator`
- `onCommand:enterprise-ai.generateDocument`
- `onCommand:enterprise-ai.manageWorktrees`

- `onCommand:enterprise-ai.showLogs`
- `onStartupFinished` — fallback per context menu e SCM provider (attivazione differita, non blocca startup VS Code)

Non usare `*` (attivazione globale).

### Output Channel

`OutputChannel` dedicato "Enterprise AI" per log diagnostici:
- Errori API con dettagli (status code, endpoint, messaggio)
- Stato connessione SSE (connect, reconnect, disconnect)
- Ciclo auth (login, refresh, logout)
- Attivazione/disattivazione moduli

Accessibile da: Command Palette → "Enterprise AI: Show Logs" oppure Output panel → dropdown "Enterprise AI".

## Build Pipeline

### Extension host
- esbuild: `src/extension.ts` → `out/extension.js` (bundle singolo)
- Target: ES2022, module Node16

### Webview
- esbuild multi-entry via `webview-ui/build.mjs`:
  - `chat/index.tsx` → `out/chatWebview.js`
  - `agents/index.tsx` → `out/agentsWebview.js`
  - `orchestrator/index.tsx` → `out/orchestratorWebview.js`
  - `shared/theme/main.css` → `out/theme.css`
- React 18, tree-shaking componenti shared

### Comandi build
- `npm run build:all` — compila extension + tutti i webview
- `npm run build:ext` — solo extension host
- `npm run build:webview` — solo webview bundles
- `npm run watch` — watch mode per sviluppo
- `npm run package` — VSIX production

## Fasi di Rilascio

### Fase 1 — Core + Chat (MVP)

Obiettivo: estensione funzionante con chat e code actions su architettura nuova.

Scope:
- `core/` completo (ApiClient, AuthService, ConfigService, EventBus)
- `modules/chat/` con streaming, modello dinamico, conversazioni
- `modules/code-actions/` — explain, fix, improve, generate tests
- `webview-ui/shared/` componenti base
- `webview-ui/chat/` UI chat
- `package.json` aggiornato
- Rimozione completa modalita Claude diretto

Criterio: estensione si installa, login funziona, chat con streaming, code actions operativi.

### Fase 2 — Agenti + Orchestratore

Obiettivo: gestione sessioni agente e monitoraggio slot.

Scope:
- `modules/agents/` — nuova sessione, lista, log streaming, template
- `modules/orchestrator/` — status bar + panel on-demand
- `webview-ui/agents/` e `webview-ui/orchestrator/`

Criterio: avviare sessione da template, log real-time, status bar con slot attivi.

### Fase 3 — Documenti + Worktree

Obiettivo: integrazione completa con tutte le funzionalita backend.

Scope:
- `modules/documents/` — `@document` autocomplete, generazione documenti
- `modules/worktree/` — SCM provider, merge, diff, conflitti

Criterio: `@document` funziona, generare DOCX da comando, merge worktree da SCM.

### Fase 4 — Polish & Test

Obiettivo: qualita production-ready.

Scope:
- Test unitari core (80%+ coverage): ApiClient, AuthService, ConfigService, EventBus
- Test integrazione moduli: ogni modulo con mock del core
- E2E test flussi critici:
  - Login → apri chat → invia messaggio → ricevi risposta streaming
  - Code action (selezione codice → explain → risposta nel chat panel)
  - Avvia sessione agente → vedi log → stop sessione
  - Status bar orchestratore → click → panel → verifica slot
  - `@document` autocomplete → selezione → messaggio con contesto RAG
  - Genera documento da command palette → file salvato
  - Worktree: agente completa sessione → notifica appare → merge da SCM view → branch mergiato
- Performance: attivazione estensione < 500ms (misurato con `--prof` flag)
- Packaging VSIX e test installazione pulita su VS Code senza configurazione precedente
- Output channel "Enterprise AI" funzionante con log leggibili
