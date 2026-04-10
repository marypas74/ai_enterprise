# Marketplace Competenze — Design Spec

**Data**: 2026-03-19
**Autore**: Claude Opus 4.6
**Stato**: Reviewed
**Versione**: 1.1

## 1. Obiettivo

Creare un microservice Marketplace che sincronizza il catalogo di competenze (skills, agents, MCP, hooks) da [aitmpl.com](https://www.aitmpl.com/) tramite il CLI `claude-code-templates`, le rende navigabili e installabili nel progetto enterprise-ai-chat, con integrazione Qdrant per ricerca semantica e knowledge base, e integrazione EventBus per hook pipeline configurabile.

## 2. Decisioni di Design

| Decisione | Scelta | Motivazione |
|---|---|---|
| Architettura | Microservice separato | Isolamento, non impatta il backend esistente |
| Import method | CLI + Sync | Usa il CLI `claude-code-templates` come sorgente |
| Scope | Tier 1/2/3 filtering | Rilevanza per enterprise AI chat |
| User vs Admin | Self-service con limiti | Skills/agents: liberi. MCP/hooks: approvazione admin |
| Qdrant | Auto-suggest + Knowledge base | Ricerca semantica competenze + docs per competenza |
| Hooks | Statici + pipeline configurabile | 25+ hook points esistenti, priorità configurabile |
| Sync | On-demand + notifiche | Admin triggera, notifica nuove competenze |
| Resilienza | Cache-first, 3 failures → suspend | Autonomia totale dopo primo sync |

## 3. Architettura

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend React                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Admin    │  │ User         │  │ Marketplace       │  │
│  │ Skills/  │  │ Settings/    │  │ Browser/Install/  │  │
│  │ Hooks    │  │ My Skills    │  │ Notifications     │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
└───────┼────────────────┼──────────────────┼─────────────┘
        │                │                  │
        ▼                ▼                  ▼
┌──────────────┐              ┌──────────────────────┐
│   Backend    │◄────REST────►│  Marketplace Service │
│   Fastify    │              │  (microservice)      │
│              │              │                      │
│ • Skills API │              │ • Catalogo aitmpl    │
│ • MCP API    │              │ • CLI sync engine    │
│ • Hooks API  │              │ • Qdrant indexing    │
│ • EventBus   │              │ • Notifiche update   │
│ • Qdrant     │              │ • Approval workflow  │
└──────┬───────┘              └──────────┬───────────┘
       │                                 │
       ▼                                 ▼
┌──────────────┐              ┌──────────────────────┐
│   MariaDB    │              │  MariaDB (stesso DB, │
│   (esistente)│              │  schema separato     │
└──────────────┘              │  marketplace_*)      │
                              └──────────────────────┘
       │                                 │
       ▼                                 ▼
┌──────────────────────────────────────────────────────┐
│                    Qdrant                             │
│  ┌────────────┐  ┌─────────────┐  ┌───────────────┐ │
│  │doc_chunks  │  │competency_  │  │competency_kb  │ │
│  │(esistente) │  │catalog      │  │(payload filter)│ │
│  └────────────┘  └─────────────┘  └───────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Marketplace Service

- **Stack**: Node.js + Fastify (coerenza col backend)
- **Porta**: 3100
- **K8s**: Deployment 1 replica, namespace `enterprise-ai-chat`
- **Comunicazione**: REST interne service-to-service con JWT
- **Ruolo**: propone competenze, il Backend le installa come source of truth

## 4. Schema DB

Stesso MariaDB del backend, schema con prefisso `marketplace_`.

**Migrazione**: il marketplace service esegue le proprie migrazioni al startup con un advisory lock MySQL (`GET_LOCK('marketplace_migrate', 10)`) per evitare race condition. Le migrazioni sono versionati in `marketplace/src/database/migrations/`.

```sql
-- Catalogo sincronizzato da aitmpl.com (cache locale)
CREATE TABLE marketplace_catalog_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_id VARCHAR(255) NOT NULL,
  type ENUM('skill', 'agent', 'mcp', 'hook') NOT NULL,
  tier ENUM('tier1', 'tier2', 'tier3') NOT NULL,
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  description TEXT,
  category VARCHAR(100),
  metadata JSON,
  version VARCHAR(50),
  embedding_indexed BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_source_id (source_id),
  INDEX idx_type (type),
  INDEX idx_tier (tier),
  INDEX idx_category (category)
);

-- Installazioni
CREATE TABLE marketplace_installations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  catalog_item_id BIGINT UNSIGNED NOT NULL,
  installed_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED,
  status ENUM('pending_approval', 'installed', 'disabled', 'failed') NOT NULL,
  target_type ENUM('skill', 'mcp_server', 'hook_handler') NOT NULL,
  target_id BIGINT UNSIGNED,
  installed_version VARCHAR(50),
  config_overrides JSON,
  installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (catalog_item_id) REFERENCES marketplace_catalog_items(id) ON DELETE CASCADE,
  FOREIGN KEY (installed_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_installed_by (installed_by),
  INDEX idx_status (status)
);

-- Stato sync (singleton — sempre max 1 riga, gestita via UPSERT)
CREATE TABLE marketplace_sync_state (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  last_sync_at TIMESTAMP,
  status ENUM('success', 'failed', 'suspended') NOT NULL,
  items_added INT DEFAULT 0,
  items_updated INT DEFAULT 0,
  items_removed INT DEFAULT 0,
  consecutive_failures INT DEFAULT 0,
  error_message TEXT,
  next_check_at TIMESTAMP NULL
);

-- Richieste di approvazione (MCP/hooks)
CREATE TABLE marketplace_approval_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  catalog_item_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  admin_notes TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  resolved_by BIGINT UNSIGNED,
  FOREIGN KEY (catalog_item_id) REFERENCES marketplace_catalog_items(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_status (status),
  INDEX idx_requested_by (requested_by)
);

-- Knowledge base per competenza
CREATE TABLE marketplace_kb_documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  installation_id BIGINT UNSIGNED NOT NULL,
  document_name VARCHAR(500),
  source_url TEXT,
  chunk_count INT DEFAULT 0,
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (installation_id) REFERENCES marketplace_installations(id) ON DELETE CASCADE
);
```

### Type Mapping

| Catalog `type` | Installation `target_type` | Backend table |
|---|---|---|
| `skill` | `skill` | `skills` |
| `agent` | `skill` | `skills` (agent = skill con system_prompt specializzato) |
| `mcp` | `mcp_server` | `mcp_servers` |
| `hook` | `hook_handler` | Registrato in EventBusService |

### Category Mapping

Le categorie dal marketplace (`VARCHAR(100)`) vengono mappate alle ENUM del backend al momento dell'installazione:

| Marketplace category | Backend `skills.category` |
|---|---|
| document-processing | `technical` |
| database, devops-infrastructure | `technical` |
| security | `technical` |
| development-tools, programming-languages | `coding` |
| ai-research, data-ai | `analysis` |
| deep-research-team | `research` |
| enterprise-communication | `communication` |
| creative-design, media | `creative` |
| Altro | `other` |

### Flusso Dati

1. Sync CLI → popola `marketplace_catalog_items`
2. Utente installa → crea `marketplace_installations` (status: `installed` per skills/agents, `pending_approval` per MCP/hooks)
3. Admin approva → status diventa `installed`, competenza viene scritta nella tabella backend corrispondente
4. `target_id` traccia il collegamento tra installazione e record nel backend
5. `installed_version` traccia la versione al momento dell'installazione — il DiffCalculator segnala quando differisce dalla versione catalogo

## 5. API Endpoints

### Catalogo

| Method | Path | Descrizione | Auth |
|---|---|---|---|
| GET | `/api/marketplace/catalog` | Lista catalogo (filtri: type, tier, category, search) | User |
| GET | `/api/marketplace/catalog/:id` | Dettaglio item | User |
| GET | `/api/marketplace/catalog/search` | Ricerca semantica via Qdrant | User |

### Sync

| Method | Path | Descrizione | Auth |
|---|---|---|---|
| POST | `/api/marketplace/sync` | Trigger sync manuale | Admin |
| GET | `/api/marketplace/sync/status` | Stato ultimo sync | Admin |
| PATCH | `/api/marketplace/sync/resume` | Riattiva sync dopo suspend | Admin |
| GET | `/api/marketplace/sync/notifications` | Nuove competenze disponibili | User |

### Installazioni

| Method | Path | Descrizione | Auth |
|---|---|---|---|
| POST | `/api/marketplace/install/:catalog_id` | Installa competenza | User |
| DELETE | `/api/marketplace/install/:id` | Disinstalla | User |
| GET | `/api/marketplace/installations` | Lista installazioni utente | User |
| PATCH | `/api/marketplace/install/:id/config` | Modifica config | User |

### Approvazioni

| Method | Path | Descrizione | Auth |
|---|---|---|---|
| GET | `/api/marketplace/approvals` | Lista richieste pendenti | Admin |
| POST | `/api/marketplace/approvals/:id/approve` | Approva | Admin |
| POST | `/api/marketplace/approvals/:id/reject` | Rifiuta | Admin |

### Knowledge Base

| Method | Path | Descrizione | Auth |
|---|---|---|---|
| POST | `/api/marketplace/kb/:installation_id/index` | Indicizza docs | User |
| GET | `/api/marketplace/kb/:installation_id` | Lista docs indicizzati | User |
| DELETE | `/api/marketplace/kb/:installation_id/:doc_id` | Rimuovi doc | User |

## 6. CLI Dependency: `claude-code-templates`

### Installazione

```bash
npm install -g claude-code-templates
# Richiede Node.js 18+
```

Il CLI viene installato nel Docker image del marketplace service durante il build. La versione viene pinnata nel `package.json` del marketplace.

### Interfaccia CLI

```bash
# Lista componenti per tipo
claude-code-templates list --type skills --format json
claude-code-templates list --type agents --format json
claude-code-templates list --type mcps --format json
claude-code-templates list --type hooks --format json

# Dettaglio singolo componente
claude-code-templates show <component-id> --format json

# Check versione/disponibilità
claude-code-templates --version
```

### Output Format

Il CLIAdapter parsa l'output JSON del CLI. Se il formato cambia (breaking change), il CLIAdapter fallisce con errore specifico e il sync si sospende.

### Fallback

Se il CLI diventa non disponibile (deprecato, rimosso da npm):
1. L'ultima versione funzionante resta installata nel container
2. Il sync usa il catalogo locale già sincronizzato
3. Il GitHub repo (`davila7/claude-code-templates`) può essere usato come sorgente alternativa via git clone + file parsing
4. Il `CLIAdapter` ha un'interfaccia astratta — si può swappare con un `GitRepoAdapter` senza cambiare il resto del sync engine

## 7. Sync Engine

```
SyncEngine
├── CLIAdapter           — Esegue `claude-code-templates` CLI, parsa output
├── CatalogParser        — Normalizza i componenti in formato catalog_items
├── TierClassifier       — Classifica tier1/2/3 in base a categoria
├── DiffCalculator       — Calcola delta tra catalogo locale e remoto
├── HealthChecker        — Verifica disponibilità aitmpl.com
│                          3 failures consecutive → suspend
│                          Nessun auto-resume (richiede azione admin)
├── NotificationService  — Genera notifiche "X nuove competenze"
└── EmbeddingIndexer     — Indicizza nuovi items in Qdrant competency_catalog
```

### Tier Classification

| Tier | Categorie | Comportamento |
|---|---|---|
| Tier 1 | document-processing, database, security (best practices), development-tools, ai-research (RAG/embeddings/Qdrant), web-data, browser_automation | Import immediato al sync |
| Tier 2 | deep-research-team, data-ai, enterprise-communication, git workflow hooks, monitoring hooks | Import al sync, visibili nel catalogo |
| Tier 3 | game-development, blockchain, sports, pentest avanzato, framework-specific | Visibili nel catalogo, install on-demand |

### Resilienza

- **Cache-first**: dopo primo sync, tutto è locale e autonomo
- **3 failures consecutive** → sync sospeso automaticamente
- **Notifica admin**: "Sorgente catalogo non disponibile — sync sospeso"
- **Competenze installate** continuano a funzionare normalmente
- **Catalogo locale** resta navigabile con ultimo stato sincronizzato
- **Nessun auto-resume** — serve azione admin esplicita
- **UI**: mostra "catalogo offline — ultimo sync: {data}" quando sospeso

## 8. Integrazione Qdrant

### Collection: `competency_catalog`

- **Scopo**: Ricerca semantica per auto-suggest e marketplace search
- **Contenuto**: Embedding di `name + description + category + system_prompt` per ogni catalog item
- **Dimensione vettore**: stessa del modello embedding esistente (EmbeddingService)
- **Aggiornamento**: al sync, indicizza items nuovi/modificati (flag `embedding_indexed`)

### Collection: `competency_kb`

- **Scopo**: Knowledge base per tutte le competenze (singola collection con payload filtering)
- **Contenuto**: Documenti di riferimento, best practices, guide indicizzate per RAG
- **Payload**: ogni punto include `installation_id` per filtraggio — evita proliferazione di collection
- **Gestione**: Admin/utente carica docs dalla pagina marketplace
- **Cleanup**: alla disinstallazione, i punti con quel `installation_id` vengono eliminati via filter delete

### Auto-suggest Flow

```
Utente: "analizza le vulnerabilità di questa API"
    │
    ▼
Backend (before_llm_call hook)
    │
    ├─ Query Qdrant "competency_catalog" con embedding del messaggio
    ├─ Top 3 competenze rilevanti (score > 0.75)
    │   → api-security-audit (0.92)
    │   → webapp-testing (0.85)
    │   → security-best-practices (0.81)
    │
    ├─ Competenze già attive per l'utente? → usa direttamente
    ├─ Competenze installate ma non attive? → suggerisci attivazione
    └─ Competenze nel catalogo ma non installate? → suggerisci installazione
```

### RAG Enhancement

Quando una competenza con KB è attiva nella chat:
1. Il RAG pipeline esistente (HybridSearchService) cerca anche nella collection `competency_kb` filtrando per `installation_id`
2. I risultati vengono mergiati col reranker esistente (RerankerService)
3. Il contesto aggiuntivo viene iniettato nel prompt via hook `agent_prompt_instructions`

## 9. Integrazione Hooks

### Hook Points Utilizzati

| Hook Point | Uso Competenze |
|---|---|
| `before_llm_call` | Auto-suggest competenze, inject system prompt della skill attiva |
| `after_llm_response` | Security scanning, compliance check, bias detection |
| `before_message_send` | Content validation, format enforcement |
| `agent_allowed_tools` | Filtra tools disponibili in base a skill attiva |
| `agent_prompt_instructions` | Inietta istruzioni della skill e contesto KB nel prompt agente |
| `before_tool_execute` | Validazione input, rate limiting per tool |
| `after_tool_execute` | Logging, result transformation |
| `on_document_upload` | Trigger indicizzazione KB per competenza |

### Pipeline Configurabile

- Ogni competenza dichiara nel manifest i suoi hook handlers con priorità default
- Admin può riordinare le priorità, abilitare/disabilitare singoli handler
- Vista grafo nella UI mostra il flusso completo della pipeline per ogni hook point
- Nessun nuovo hook point creato — solo i 25+ esistenti

### Manifest Hook Declaration

```json
{
  "hooks": [
    {
      "hookName": "before_llm_call",
      "handlerName": "security-prompt-inject",
      "priority": 30,
      "description": "Injects security best practices into system prompt"
    },
    {
      "hookName": "after_llm_response",
      "handlerName": "security-scan-response",
      "priority": 20,
      "description": "Scans response for potential security issues"
    }
  ]
}
```

## 10. Frontend

### Nuove Pagine

#### 1. Marketplace Browser (`/admin/marketplace`)
- Griglia/lista navigabile del catalogo
- Filtri: tipo (skill/agent/mcp/hook), tier, categoria, stato (installato/disponibile)
- Ricerca full-text + semantica (via Qdrant)
- Card per item: nome, descrizione, tier badge, pulsante installa/disinstalla
- Indicatore "X nuove competenze" dopo sync
- Banner "catalogo offline" quando sync sospeso

#### 2. User Skills Settings (`/settings/skills`)
- Le mie competenze installate (on/off toggle)
- Catalogo skills/agents disponibili (approvati dall'admin o self-service)
- Pulsante "Richiedi" per MCP/hooks (crea approval request)
- Configurazione per competenza (prompt override, parametri)

#### 3. Pipeline Visualizer (`/admin/hooks/pipeline`)
- Vista grafo dei hook points con handler registrati
- Drag & drop per riordinare priorità
- Enable/disable per handler
- Trace log in real-time

### Routing

| Path | Componente | Guard | Zustand Store |
|---|---|---|---|
| `/admin/marketplace` | MarketplaceBrowserPage | admin | useMarketplaceStore |
| `/admin/hooks/pipeline` | PipelineVisualizerPage | admin | useHookPipelineStore |
| `/settings/skills` | UserSkillsSettingsPage | authenticated | useUserSkillsStore |

Tutte le route admin sono sotto `/admin/*` (già gestito dal router esistente). La route `/settings/skills` segue il pattern della pagina `/settings` esistente.

### Modifiche a Pagine Esistenti

- **SkillsPage** — badge "marketplace" per skill importate, link a dettaglio catalogo
- **PluginsPage** (tab MCP) — stato approvazione per MCP da marketplace
- **Navbar/Sidebar** — notification badge per nuove competenze / approvazioni pendenti

## 11. Sicurezza

### Autenticazione
- **Service-to-service**: JWT firmato con shared secret (`MARKETPLACE_SERVICE_TOKEN`), short-lived (exp: 5 min), rinnovato automaticamente. Il marketplace firma un JWT per ogni chiamata al backend con claim `{ sub: "marketplace-service", iat, exp }`. Il backend verifica la firma con lo stesso secret.
- **User auth**: Le API marketplace condividono lo stesso `JWT_SECRET` del backend per validare i token utente
- Le API admin richiedono ruolo `admin`

### Permessi
- **Skills/Agents**: self-service, nessuna approvazione richiesta (sono prompt templates)
- **MCP/Hooks**: richiedono approvazione admin (possono avere impatto runtime)

### Rate Limiting
- Install/uninstall: max 10 richieste/minuto per utente
- Sync: max 1 richiesta ogni 5 minuti (admin)
- Catalog browse: max 60 richieste/minuto per utente
- KB indexing: max 5 richieste/minuto per utente
- Max installazioni attive per utente: 50 (configurabile da admin)

### Validazione
- Ogni item importato validato contro JSON schema prima dell'inserimento
- Prompt > 10K chars troncati con warning
- Config con campi sconosciuti strippati
- Nessun codice esterno eseguito — le competenze sono dati (prompt, config JSON)
- Sanitizzazione HTML/script in tutti i contenuti importati

### Audit
- Ogni installazione/disinstallazione loggata in `activity_log`
- Approvazioni/rifiuti loggati con admin_notes

## 12. K8s Deployment

```yaml
# k8s/marketplace/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: marketplace
  namespace: enterprise-ai-chat
spec:
  replicas: 1
  selector:
    matchLabels:
      app: marketplace
  template:
    spec:
      containers:
        - name: marketplace
          image: localhost:32000/enterprise-ai-chat/marketplace:1.0.0
          ports:
            - containerPort: 3100
          env:
            - name: PORT
              value: "3100"
            - name: DB_HOST
              valueFrom: { secretKeyRef: { name: app-secrets, key: DB_HOST } }
            - name: DB_PORT
              value: "3306"
            - name: DB_USER
              valueFrom: { secretKeyRef: { name: app-secrets, key: DB_USER } }
            - name: DB_PASSWORD
              valueFrom: { secretKeyRef: { name: app-secrets, key: DB_PASSWORD } }
            - name: DB_NAME
              valueFrom: { secretKeyRef: { name: app-secrets, key: DB_NAME } }
            - name: QDRANT_URL
              value: "http://qdrant:6333"
            - name: MARKETPLACE_SERVICE_TOKEN
              valueFrom: { secretKeyRef: { name: app-secrets, key: MARKETPLACE_SERVICE_TOKEN } }
            - name: BACKEND_INTERNAL_URL
              value: "http://backend:3000"
            - name: JWT_SECRET
              valueFrom: { secretKeyRef: { name: app-secrets, key: JWT_SECRET } }
          livenessProbe:
            httpGet:
              path: /health
              port: 3100
            initialDelaySeconds: 15
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 3100
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: marketplace
  namespace: enterprise-ai-chat
spec:
  selector:
    app: marketplace
  ports:
    - port: 3100
      targetPort: 3100
```

### Ingress / Routing

Il frontend proxy la route `/api/marketplace/*` al marketplace service. Configurazione nel Nginx del frontend container:

```nginx
location /api/marketplace/ {
    proxy_pass http://marketplace:3100/api/marketplace/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

In alternativa, il backend può fungere da reverse proxy per le API marketplace (più semplice, nessuna modifica al frontend Nginx).

### Docker Build

```dockerfile
# marketplace/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g claude-code-templates@latest
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3100
CMD ["node", "dist/index.js"]
```

Build integrato nel `BUILD.sh` del progetto principale.

## 12.1 API Response Format

Tutte le API seguono lo stesso envelope del backend:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

Errori:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "CATALOG_ITEM_NOT_FOUND",
    "message": "Catalog item with id 42 not found"
  }
}
```

Tutte le API di lista supportano paginazione: `?page=1&limit=20`.

## 12.2 Auto-suggest Performance

- **Latency budget**: auto-suggest deve completare in < 100ms, altrimenti viene skippato
- **Cache**: risultati cachati per conversation_id (stesso topic = stesse competenze rilevanti), TTL 5 minuti
- **Toggle**: configurabile da admin (`system_settings.marketplace_autosuggest_enabled`)
- **Opt-out utente**: toggle nelle impostazioni utente per disabilitare suggerimenti

## 13. Vincoli di Build

Ogni fase di implementazione DEVE compilare prima di passare alla successiva. Se una fase termina con errori di build, vanno risolti prima di procedere.
