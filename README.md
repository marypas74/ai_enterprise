# Enterprise AI Chat

Enterprise-grade AI chat platform with multi-provider support, intelligent model orchestration, autonomous AI agents, document studio, marketplace, and VS Code extension.

**Current version: 2.1.53**

## Features

- **Intelligent Model Orchestrator** — Automatic model selection via rule-based scoring + semantic embedding routing. Routes queries to Fast/Balanced/Powerful tiers with circuit breaker, cascade escalation, and feedback loop.
- **Multi-Provider AI** — OpenAI, Anthropic Claude, Google Gemini, Ollama (local models) with automatic failover. LiteLLM proxy support.
- **Autonomous AI Agents** — Claude Agent SDK integration with terminal orchestration, worktree isolation, task management, and iterative execution via Auto-Claude dashboard.
- **Document Studio** — PDF editor (pdftohtml + LibreOffice + Ollama Vision OCR), PAdES-B-B digital signatures, DOCX/XLSX/PPTX generation, OnlyOffice integration.
- **Marketplace** — Plugin/skill catalog with approval workflow, catalog service, KB integration, Qdrant vector search, and backend client for automated installs.
- **Vector Memory** — 4-tier RAG pipeline (episodic/declarative/procedural/working) with HyDE, embeddings, semantic search, and memory stats dashboard.
- **Plugin System** — File-based plugins with EventBus hooks, MCP server support, skill management, prompt templates.
- **EU AI Act Compliance** — Art. 50.1/50.2 disclosure, consent management, bias monitoring, audit logging, AI transparency page, DPIA documentation.
- **VS Code Extension** — 19 commands: chat, code explain/fix/improve/document, agent sessions, inline editing, provider switching.
- **Voice Interface** — OpenAI Whisper STT + OpenAI TTS / local Piper TTS fallback with animated Avatar Orb overlay.
- **Image Generation** — OllamaDiffuser integration (FLUX.1 schnell) inline in chat.
- **Admin Dashboard** — User/group management, provider config, orchestrator dashboard, pipeline visualizer, plugin graph, hooks, guides, kanban.
- **Security** — JWT + MFA (TOTP), Google OAuth, Zod input validation, OWASP hardening, rate limiting, network policies.
- **Kubernetes Ready** — Production deployment on MicroK8s with auto-scaling, backup CronJobs, Cloudflare Tunnel, OnlyOffice, Open-WebUI, Parlant.
- **Mobile** — Android APK (Capacitor 6) with native SSE + PWA for iOS (installable from Safari).

## Architecture

```
                     ┌──────────────────────────────────────────────────────┐
                     │              Frontend (React 18 + Vite)              │
                     │  Chat │ Admin │ Projects/Kanban │ Agents │ Documents │
                     │  Zustand stores │ Tailwind CSS │ Playwright E2E      │
                     └───────────────────────┬──────────────────────────────┘
                                             │ Nginx reverse proxy
┌────────────────────────────────────────────▼──────────────────────────────────┐
│                      Backend (Fastify 5 + TypeScript)                         │
│  25 modules │ JWT/MFA/OAuth │ WebSocket │ SSE streaming │ Zod validation      │
├──────────────────────────────────────────────────────────────────────────────┤
│                         Model Orchestrator                                    │
│                                                                               │
│  User Query ──▶ ModelRouter ──▶ Tier Selection ──▶ Provider                   │
│                    │                │                  │                      │
│              Rule-based        Semantic          Circuit Breaker              │
│              scoring          embedding           + Cascade Fallback          │
│                    ▼                ▼                   ▼                     │
│         ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐            │
│         │    FAST      │  │   BALANCED   │  │    POWERFUL      │            │
│         │ Haiku 4.5    │  │ Sonnet 4.6   │  │ Opus 4.6         │            │
│         │ GPT-4.1-mini │  │ GPT-4.1      │  │ o3-mini          │            │
│         │ Gemini Flash │  │ Gemini Pro   │  │                  │            │
│         │ Ollama       │  │              │  │                  │            │
│         └──────────────┘  └──────────────┘  └──────────────────┘            │
├────────┬──────────┬────────┬──────────┬──────────┬──────────┬───────────────┤
│  Auth  │   Chat   │ Agents │ Projects │  Tools   │ Docs     │ Compliance    │
│  MFA   │ Complete │ SDK    │  Kanban  │ PDF/DOCX │ Studio   │ EU AI Act     │
│  OAuth │ Stream   │ Orchst │  Boards  │ PPTX/XLS │ OnlyOff  │ Consent/Audit │
│  Sessi │ Memory   │ Worktr │  Cards   │ Sandbox  │ PAdES-BB │ Bias Monitor  │
└────────┴────┬─────┴────────┴──────────┴──────────┴──────────┴───────────────┘
              │
 ┌────────────┼────────────┬──────────────┬──────────────┬────────────────┐
 │            │            │              │              │                │
┌▼───────┐ ┌──▼─────┐ ┌────▼─────┐ ┌─────▼────┐ ┌──────▼──────┐ ┌──────▼──┐
│MariaDB │ │ Redis  │ │  Qdrant  │ │ Parlant  │ │   Ollama    │ │LiteLLM  │
│Users   │ │Session │ │ Vectors  │ │ Agents   │ │ Local LLMs  │ │ Proxy   │
│Chat    │ │Cache   │ │Embeddings│ │Guidlines │ │ GPU/Docker  │ │ Router  │
│History │ │Tokens  │ │ RAG/KB   │ │ Sessions │ │             │ │         │
└────────┘ └────────┘ └──────────┘ └──────────┘ └─────────────┘ └─────────┘
```

## Model Orchestrator

Automatically selects the optimal AI model for each query without user intervention.

### How It Works

1. **Rule-Based Router** — Analyzes query length, keywords, attachments, conversation depth, and tool usage to compute a complexity score.
2. **Semantic Router** — Uses embedding similarity against pre-computed route examples for sub-millisecond task classification (greeting, coding, analysis, complex reasoning, etc.).
3. **Response Quality Checker** — Evaluates response quality without LLM calls (refusal detection, truncation, uncertainty). Supports cascade escalation to a more powerful model.
4. **Circuit Breaker** — Tracks provider health, opens circuit on consecutive failures, auto-recovers.
5. **Feedback Loop** — Records routing decisions with latency, cost, and user overrides. Admin dashboard shows routing distribution and cost savings.

### Routing Tiers

| Tier | Default Models | Use Case |
|------|---------------|----------|
| **Fast** | Haiku 4.5, GPT-4.1-mini, Gemini Flash, Ollama | Greetings, simple questions, formatting |
| **Balanced** | Sonnet 4.6, GPT-4.1, Gemini Pro | Coding, analysis, writing, standard tasks |
| **Powerful** | Opus 4.6, o3-mini | Architecture, complex reasoning, multi-step agents |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker
- MicroK8s (Kubernetes deployment)

### Local Development

```bash
# Backend
cd backend
npm install
cp .env.example .env    # Configure API keys, DB, Redis, JWT secrets
npm run dev             # Hot reload on port 3000

# Frontend
cd frontend
npm install
npm run dev             # Vite dev server on port 5173 (proxies /api → :3000)

# Tests
cd backend && npm test              # Vitest unit tests
cd frontend && npm test             # Vitest + Testing Library
cd frontend && npm run test:e2e     # Playwright E2E

# VS Code Extension
cd vscode-extension
npm run build:all   # Build webview + compile extension
npm run package     # Create .vsix
```

### Kubernetes Deployment

```bash
bash BUILD.sh       # Full build: npm install + Docker + MicroK8s import + K8s deploy
sudo bash DEPLOY.sh # Quick deploy: import pre-built images + restart pods
```

## Project Structure

```
enterprise-ai-chat/
├── backend/                    # Fastify 5 API server (TypeScript)
│   └── src/
│       ├── modules/            # 25 feature modules
│       │   ├── auth/           # JWT + MFA (TOTP) + Google OAuth
│       │   ├── chat/           # Completions, conversations, models, SSE streaming
│       │   ├── admin/          # Users, providers, plugins, settings, orchestrator, guides
│       │   ├── agents/         # AI agent sessions + Claude Agent SDK routes
│       │   ├── projects/       # Kanban boards, cards, access control
│       │   ├── memory/         # Vector memory + observations (4-tier RAG)
│       │   ├── tools/          # DOCX/XLSX/PPTX/PDF/OnlyOffice generation
│       │   ├── documents/      # Document studio management
│       │   ├── attachments/    # File upload + OCR processing
│       │   ├── compliance/     # EU AI Act (consent, feedback, bias monitor, audit)
│       │   ├── orchestrator/   # Terminal slot management (Auto-Claude)
│       │   ├── parlant/        # Parlant AI agent proxy
│       │   ├── ingestion/      # URL/text/memory import pipeline
│       │   ├── forms/          # Conversational forms engine
│       │   ├── scheduler/      # Job scheduling (WhiteRabbit)
│       │   ├── marketplace/    # Plugin/skill catalog routes (via marketplace service)
│       │   └── activity/       # Activity logging
│       ├── services/           # Business logic (30+ services)
│       │   ├── ModelRouter.ts              # Rule-based model selection
│       │   ├── SemanticRouter.ts           # Embedding task classification
│       │   ├── ResponseQualityChecker.ts   # Cascade quality assessment
│       │   ├── CircuitBreakerService.ts    # Provider health tracking
│       │   ├── HyDEService.ts              # Hypothetical Document Embeddings
│       │   ├── LLMSyncWorker.ts            # Background LLM sync
│       │   ├── MCPClientManager.ts         # MCP protocol manager
│       │   ├── ParlantProvider.ts          # Parlant integration
│       │   ├── VisionService.ts            # Ollama Vision OCR
│       │   ├── WebSearchService.ts         # Web search integration
│       │   └── document-processing/        # PDF edit session manager
│       └── database/                       # Connection pool + auto-migrations
├── frontend/                   # React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── pages/              # Route pages
│       │   ├── ChatPage.tsx            # Main chat interface
│       │   ├── DocumentsPage.tsx       # Document studio
│       │   ├── ProjectsPage.tsx        # Kanban project management
│       │   ├── AutoClaudePage.tsx      # Autonomous agent dashboard
│       │   ├── MarketplacePage.tsx     # Plugin/skill marketplace
│       │   ├── ParlantPage.tsx         # Parlant agent management
│       │   ├── AITransparencyPage.tsx  # EU AI Act transparency
│       │   ├── SettingsPage.tsx        # User settings + voice config
│       │   └── admin/                  # 20+ admin pages
│       ├── components/         # Reusable UI components
│       ├── hooks/              # Zustand stores (auth, agents, parlant, documents)
│       └── services/           # API client (axios + SSE with routing events)
├── marketplace/                # Standalone marketplace service (Fastify + SQLite)
│   └── src/
│       ├── catalog/            # Catalog service + routes
│       ├── install/            # Install service
│       ├── approval/           # Approval workflow
│       ├── backend/            # Backend client for automated installs
│       ├── kb/                 # Knowledge base integration
│       ├── qdrant/             # Vector search
│       └── database/           # SQLite connection + migrations
├── vscode-extension/           # VS Code companion extension
│   ├── src/                    # Extension entry + 19 commands
│   └── webview-ui/             # React webview bundles (webpack + esbuild)
├── doc-processor/              # Document processing microservice
├── k8s/                        # Kubernetes manifests (Kustomize)
│   ├── backend/                # Deployment + Service + HPA
│   ├── frontend/               # Deployment + Service (Nginx)
│   ├── mariadb/                # StatefulSet + init ConfigMap + schema
│   ├── redis/                  # StatefulSet
│   ├── litellm/                # LiteLLM proxy deployment + configmap
│   ├── parlant/                # Parlant AI service
│   ├── qdrant/                 # Qdrant vector DB
│   ├── marketplace/            # Marketplace service deployment
│   ├── onlyoffice/             # OnlyOffice document server
│   ├── open-webui/             # Open-WebUI deployment
│   ├── tls/                    # TLS certificates
│   ├── storage/                # PersistentVolumes
│   └── kustomization.yaml
├── BUILD.sh                    # Full build pipeline
├── DEPLOY.sh                   # Quick deploy script
└── ROADMAP.md                  # Development roadmap
```

## Configuration

### Backend Environment (.env)

```env
# Server
PORT=3000
NODE_ENV=production

# Database (MariaDB)
DB_HOST=mariadb
DB_PORT=3306
DB_USER=enterprise_ai_chat
DB_PASSWORD=your_password
DB_NAME=enterprise_ai_chat
DB_CONNECTION_LIMIT=25

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_refresh_secret

# MFA
MFA_BYPASS_EMAILS=                      # comma-separated emails exempt from MFA
TRUSTED_IPS=                            # comma-separated trusted IPs (bypass rate limit)

# AI Providers (or configure via Admin Panel)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Ollama (Docker host, NOT Kubernetes)
OLLAMA_BASE_URL=http://10.0.1.1:8086/ollama
OLLAMA_AUTH_KEY=your_ollama_auth_key

# Storage
STORAGE_ROOT=/data/projects
EXTENSION_DIR=/data/projects/extensions

# Encryption (for stored secrets)
ENCRYPTION_KEY=your_32_char_hex_key

# CORS
CORS_ORIGIN=https://your-domain.com
```

## Kubernetes Infrastructure

Deployed on MicroK8s in namespace `enterprise-ai-chat`:

| Service | Type | Notes |
|---------|------|-------|
| backend | Deployment (2 replicas) | Fastify API, port 3000 |
| frontend | Deployment (2 replicas) | Nginx, port 80 |
| mariadb | StatefulSet | Port 3306, PVC 20Gi |
| redis | StatefulSet | Port 6379, PVC 5Gi |
| qdrant | Deployment | Vector DB, port 6333 |
| litellm | Deployment | LLM proxy, port 4000 |
| parlant | Deployment | AI agent framework, port 8800 |
| marketplace | Deployment | Plugin catalog, port 3001 |
| onlyoffice | Deployment | Document server, port 80 |
| open-webui | Deployment | Alternative UI |
| doc-processor | Deployment | Document processing microservice |

All external traffic goes through Cloudflare Tunnel. Ingress uses TLS with cert-manager.

## Development Commands

```bash
# Backend
cd backend
npm run dev          # Dev server with tsx watch
npm run build        # TypeScript compilation → dist/
npm run lint         # ESLint
npm run test         # Vitest unit tests
npx vitest run path/to/test.ts  # Single test file

# Frontend
cd frontend
npm run dev          # Vite dev server (port 5173)
npm run build        # tsc + vite build → dist/
npm run lint         # ESLint
npm run test:e2e     # Playwright E2E tests
npm run test:e2e:prod  # E2E against production

# Marketplace
cd marketplace
npm run dev          # Dev server
npm run build        # TypeScript compilation

# VS Code Extension
cd vscode-extension
npm run build:all    # Build webview + compile extension
npm run webpack      # Production webpack build
npm run webpack:dev  # Dev build with watch
npm run package      # Create .vsix with vsce
npm run release      # Bump version + build + package

# Kubernetes
sudo microk8s kubectl get pods -n enterprise-ai-chat
sudo microk8s kubectl logs -l app=backend -n enterprise-ai-chat
sudo microk8s kubectl rollout status deployment/backend -n enterprise-ai-chat
```

## Security

- **Authentication**: JWT (access 15m + refresh 7d) + MFA TOTP + Google OAuth
- **Authorization**: Role-based (admin/user) with per-group permissions
- **Input validation**: Zod schemas on all API endpoints
- **Rate limiting**: Per-IP + per-user limits via @fastify/rate-limit
- **Headers**: Helmet CSP, HSTS, X-Frame-Options
- **Network**: K8s NetworkPolicy restricts pod-to-pod traffic
- **Secrets**: Kubernetes secrets for API keys, never in source
- **Cloudflare**: All traffic via Cloudflare Tunnel, IP restrictions via CF-Connecting-IP header

## EU AI Act Compliance

- **Art. 50.1** — Mandatory AI disclosure banner on all AI-generated content
- **Art. 50.2** — Synthetic media watermarking (images)
- **Consent management** — Granular consent collection and audit trail
- **Bias monitoring** — Automated bias detection on model responses
- **Audit logging** — Immutable log of all AI interactions
- **AI Transparency page** — User-facing explanation of AI system behavior
- **DPIA** — Data Protection Impact Assessment documented in `DPIA.md`
