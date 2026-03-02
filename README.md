# Enterprise AI Chat

Enterprise-grade AI chat platform with multi-provider support, intelligent model orchestration, autonomous AI agents, project management, and VS Code extension.

**Current version: 1.9.2**

## Features

- **Intelligent Model Orchestrator**: Automatic model selection based on query complexity — routes to fast/balanced/powerful tiers (Haiku, Sonnet, Opus + OpenAI + Gemini + Ollama). Rule-based + semantic routing with feedback loop.
- **Multi-Provider AI**: OpenAI, Anthropic Claude, Google Gemini, Ollama (local models) with automatic failover and circuit breaker
- **Autonomous AI Agents**: Claude Agent SDK integration with terminal orchestration, task management, and iterative execution
- **Project Management**: Kanban boards with AI-powered cards, agent linking, and real-time collaboration
- **Vector Memory**: RAG pipeline with embeddings, semantic search, HyDE, and 4-tier memory (episodic/declarative/procedural/working)
- **Document Processing**: OCR (Tesseract), PDF parsing, DOCX/XLSX/PPTX generation, chunking with overlap
- **Plugin System**: File-based plugins with EventBus hooks, MCP server support
- **EU AI Act Compliance**: Art. 50.1/50.2 disclosure, consent management, bias monitoring, audit logging
- **VS Code Extension**: Full IDE integration with chat, code actions, agent sessions, inline editing
- **Real-time Chat**: SSE streaming with markdown rendering, file attachments, conversation management
- **Admin Dashboard**: User/group management, provider configuration, orchestrator dashboard, system monitoring
- **Security**: JWT + MFA (TOTP), Zod input validation, rate limiting, OWASP hardening
- **Kubernetes Ready**: Production deployment with MicroK8s, auto-scaling, backup CronJobs

## Architecture

```
                     ┌──────────────────────────────────────────────────────┐
                     │              Frontend (React 18 + Vite)              │
                     │  Chat UI │ Admin Panel │ Projects/Kanban │ Agents    │
                     │  Zustand stores │ Tailwind CSS │ Code splitting      │
                     └───────────────────────┬──────────────────────────────┘
                                             │ Nginx reverse proxy
┌────────────────────────────────────────────▼──────────────────────────────────┐
│                      Backend (Fastify 5 + TypeScript)                         │
│  20+ modules │ JWT/MFA auth │ WebSocket │ SSE streaming │ Zod validation      │
├──────────────────────────────────────────────────────────────────────────────┤
│                         Model Orchestrator (v1.9.2)                           │
│                                                                              │
│  User Query ──▶ ModelRouter ──▶ Tier Selection ──▶ Provider                  │
│                    │                │                  │                      │
│              Rule-based        Semantic          Circuit Breaker              │
│              scoring          embedding           + Fallback                  │
│                    │            similarity              │                     │
│                    ▼                ▼                    ▼                     │
│              ┌─────────┐    ┌───────────┐    ┌──────────────────┐            │
│              │  FAST    │    │ BALANCED  │    │    POWERFUL       │            │
│              │Haiku 4.5 │    │Sonnet 4.6 │    │  Opus 4.6        │            │
│              │GPT-4.1m  │    │GPT-4.1    │    │  o3-mini          │            │
│              │Gem Flash │    │Gem Pro    │    │                   │            │
│              │Ollama    │    │           │    │                   │            │
│              └─────────┘    └───────────┘    └──────────────────┘            │
├──────────┬──────────┬──────────┬──────────┬─────────┬──────────┬─────────────┤
│  Auth    │   Chat   │  Agents  │ Projects │  Admin  │  Tools   │ Compliance  │
│  MFA     │ Complete │ Sessions │  Kanban  │ Users   │ DOCX/PDF │ AI Act      │
│  OAuth   │ Stream   │ Orchestr │  Boards  │ Provid  │ PPTX     │ Consent     │
│  Sessions│ Memory   │ Terminal │  Cards   │ Plugins │ Sandbox  │ Audit       │
└──────────┴────┬─────┴──────────┴──────────┴─────────┴──────────┴─────────────┘
                │
   ┌────────────┼────────────┬──────────────┬──────────────┐
   │            │            │              │              │
 ┌─▼──────┐ ┌──▼─────┐ ┌────▼─────┐ ┌─────▼────┐ ┌──────▼──────┐
 │MariaDB │ │ Redis  │ │  Qdrant  │ │ Parlant  │ │   Ollama    │
 │Users   │ │Sessions│ │ Vectors  │ │ Agents   │ │ Local LLMs  │
 │Chat    │ │Cache   │ │Embeddings│ │Guidelines│ │ GPU Accel.  │
 │Routing │ │Tokens  │ │ RAG      │ │ Sessions │ │             │
 └────────┘ └────────┘ └──────────┘ └──────────┘ └─────────────┘
```

## Model Orchestrator

The Model Orchestrator (v1.9.2) automatically selects the optimal AI model for each query, similar to how Perplexity and Gemini CLI work.

### How It Works

1. **Rule-Based Router** — Analyzes query length, keywords, attachments, conversation depth, and tool usage to compute a complexity score. Routes to fast/balanced/powerful tier.
2. **Semantic Router** — Uses embedding similarity against pre-computed route examples for sub-millisecond task classification (greeting, coding, analysis, complex reasoning, etc.)
3. **Response Quality Checker** — Evaluates response quality without LLM calls (refusal detection, truncation, uncertainty). Supports cascade escalation.
4. **Feedback Loop** — Records all routing decisions with latency, cost, and user overrides. Admin dashboard shows routing distribution, cost savings, and accuracy trends.

### Routing Tiers (configurable via Admin)

| Tier | Models (default) | Use Case |
|------|-----------------|----------|
| **Fast** | Haiku 4.5, GPT-4.1-mini, Gemini Flash | Greetings, simple questions, formatting |
| **Balanced** | Sonnet 4.6, GPT-4.1, Gemini Pro | Coding, analysis, writing, standard work |
| **Powerful** | Opus 4.6, o3-mini | Architecture, complex reasoning, multi-step agents |

### Admin API

| Endpoint | Description |
|----------|-------------|
| `GET /api/admin/orchestrator/stats` | Routing distribution, cost savings, quality metrics |
| `GET /api/admin/orchestrator/tiers` | Current tier configuration |
| `POST /api/admin/orchestrator/tiers` | Add model to a tier |
| `PUT /api/admin/orchestrator/tiers/:id` | Update tier priority/enabled |
| `DELETE /api/admin/orchestrator/tiers/:id` | Remove model from tier |
| `GET /api/admin/orchestrator/settings` | Routing settings |
| `PUT /api/admin/orchestrator/settings` | Update settings (auto_routing_enabled, cascade_enabled, etc.) |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker
- MicroK8s (for Kubernetes deployment)

### Local Development

```bash
# Backend
cd backend
npm install
cp .env.example .env    # Configure API keys, DB, Redis, JWT secrets
npm run dev             # Dev server with hot reload (port 3000)

# Frontend
cd frontend
npm install
npm run dev             # Vite dev server (port 5173, proxies /api to :3000)

# Run tests
cd backend && npm test          # Vitest (backend)
cd frontend && npm test         # Vitest + Testing Library (frontend)
cd frontend && npm run test:e2e # Playwright E2E tests
```

### Kubernetes Deployment

```bash
bash BUILD.sh       # Docker build + MicroK8s import + K8s deploy (requires sudo)
sudo bash DEPLOY.sh # Quick deploy: import pre-built images + restart pods
```

## Project Structure

```
enterprise-ai-chat/
├── backend/                    # Fastify 5 API server (TypeScript)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/           # JWT + MFA (TOTP) + Google OAuth
│   │   │   ├── chat/           # Completions, conversations, models, streaming
│   │   │   ├── admin/          # Users, providers, plugins, settings, orchestrator
│   │   │   ├── agents/         # AI agent sessions + SDK routes
│   │   │   ├── projects/       # Kanban boards, cards, access control
│   │   │   ├── memory/         # Vector memory + observations
│   │   │   ├── tools/          # DOCX/XLSX/PPTX/PDF generation
│   │   │   ├── attachments/    # File upload + processing
│   │   │   ├── compliance/     # EU AI Act (consent, feedback, audit)
│   │   │   ├── orchestrator/   # Terminal slot management
│   │   │   ├── parlant/        # Parlant AI proxy
│   │   │   ├── ingestion/      # URL/text/memory import
│   │   │   ├── forms/          # Conversational forms
│   │   │   ├── scheduler/      # Job scheduling (WhiteRabbit)
│   │   │   └── activity/       # Activity logging
│   │   ├── services/           # Business logic services
│   │   │   ├── ModelRouter.ts        # Intelligent model selection (rule-based)
│   │   │   ├── SemanticRouter.ts     # Embedding-based task classification
│   │   │   ├── ResponseQualityChecker.ts  # Cascade quality assessment
│   │   │   ├── CircuitBreakerService.ts   # Provider health tracking
│   │   │   ├── tools/                # FileTools, DocumentTools, WebTools
│   │   │   ├── agent/                # AgentSessionManager, AgentExecutor
│   │   │   └── ...                   # 20+ services
│   │   └── database/           # Connection pool + auto-migrations
│   └── Dockerfile
├── frontend/                   # React 18 + Vite + Tailwind
│   ├── src/
│   │   ├── pages/              # 11 route pages
│   │   ├── hooks/              # Zustand stores (auth, agents, parlant)
│   │   ├── components/         # Reusable UI components
│   │   └── services/           # API client (axios + SSE with routing events)
│   ├── nginx.conf              # Production config (gzip, cache, CSP)
│   └── Dockerfile
├── vscode-extension/           # VS Code companion extension
│   ├── src/                    # Extension entry + modules
│   └── webview-ui/             # React webview bundles
├── k8s/                        # Kubernetes manifests
│   ├── backend/                # Deployment + Service
│   ├── frontend/               # Deployment + Service (Nginx)
│   ├── mariadb/                # StatefulSet + init ConfigMap
│   ├── redis/                  # StatefulSet
│   ├── parlant/                # Parlant AI service
│   └── kustomization.yaml      # Kustomize overlay
├── ROADMAP.md                  # Development roadmap (Phases 0-8)
├── BUILD.sh                    # Full build pipeline
└── DEPLOY.sh                   # Quick deploy script
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
TRUSTED_IPS=217.198.133.248             # comma-separated trusted IPs

# AI Providers (or configure via Admin Panel)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Ollama (via proxy)
OLLAMA_BASE_URL=http://10.0.1.1:8086/ollama
OLLAMA_AUTH_KEY=your_ollama_key

# Vector Memory (Qdrant)
QDRANT_URL=http://qdrant:6333

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Storage
STORAGE_ROOT=/app/storage
ENCRYPTION_KEY=your_encryption_key
```

## API Documentation

Swagger UI is available at `/docs` when the server is running.

### Key Endpoints

| Module | Prefix | Description |
|--------|--------|-------------|
| Auth | `/api/auth` | Login, register, refresh, MFA setup/verify, Google OAuth |
| Chat | `/api/chat` | Completions (SSE), conversations CRUD, models (with Auto routing) |
| Agents | `/api/agents` | Sessions CRUD, start/pause/resume, templates |
| Projects | `/api/projects` | Projects, boards, columns, cards, agent linking |
| Admin | `/api/admin` | Users, providers, plugins, settings, skills, orchestrator |
| Memory | `/api/memory` | Observations, vector search, working memory |
| Tools | `/api/tools` | DOCX/XLSX/PPTX/PDF generation, downloads |
| Compliance | `/api/compliance` | Consent, feedback, data export, model docs |
| Parlant | `/api/parlant` | Agents, guidelines, sessions, messages |

## Testing

```bash
# Backend unit tests (Vitest)
cd backend
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report (target: 80%)

# Frontend unit tests (Vitest + Testing Library)
cd frontend
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report

# E2E tests (Playwright)
cd frontend
npm run test:e2e
```

## Security

- **Authentication**: JWT with 15m access + 7d refresh tokens, single-session enforcement
- **MFA**: TOTP with QR code setup, mandatory for external access
- **Input Validation**: Zod schemas on all endpoints with strict type checking
- **Rate Limiting**: Global 100/min + strict limits on login (10/min), register (5/5min)
- **Headers**: Helmet security headers, CSP, X-Frame-Options, HSTS
- **SQL**: Parameterized queries via mysql2 (zero raw string concatenation)
- **Encryption**: bcrypt (passwords), AES-256 (sensitive data at rest)
- **Audit**: Full audit logging with IP tracking, session management

## Deployment

### Infrastructure

- **Domain**: Behind Cloudflare Tunnel (cloudflared)
- **K8s**: MicroK8s with 2 backend replicas, 2 frontend replicas
- **Database**: MariaDB StatefulSet with daily backup CronJob (30-day retention)
- **Cache**: Redis StatefulSet for sessions and rate limiting
- **Vector DB**: Qdrant for embeddings and semantic search
- **Registry**: localhost:32000 (MicroK8s built-in)

### Rollout Process

```bash
# 1. Build and push images
bash BUILD.sh

# 2. Scale down, apply, scale up (zero-downtime)
kubectl scale deployment backend frontend --replicas=0 -n enterprise-ai-chat
kubectl apply -f k8s/backend/deployment.yaml -f k8s/frontend/deployment.yaml
kubectl scale deployment backend --replicas=2 frontend --replicas=2 -n enterprise-ai-chat
```

## Changelog

### v1.9.2 (2026-03-02)
- Version bump

### v1.9.1 (2026-03-02)
- **Embedding Model Upgrade**: Switched from nomic-embed-text (768d, EN-only) to qwen3-embedding:0.6b (1024d, 100+ languages, MTEB 70.7)
- EmbeddingService refactored: dynamic dimension probing, Ollama /api/embed batch support, fetch timeouts, race-condition guard
- Qdrant collections migrated from 768d to 1024d (document_chunks, episodic_memory, declarative_memory, procedural_memory)
- Cache key includes model ID to prevent stale hits on model switch
- `clearEmbeddingCache()` wired into admin provider/model update routes
- model-capabilities.ts: added qwen3-embedding, granite-embedding, embeddinggemma patterns

### v1.9.0 (2026-03-01)
- **Model Orchestrator**: Intelligent auto-routing across fast/balanced/powerful tiers
- Rule-based router with complexity scoring (query length, keywords, attachments, conversation depth)
- Semantic router using embedding similarity for task classification
- Response quality checker for cascade escalation
- Admin API for tier configuration and routing statistics
- Frontend "Auto (Smart Routing)" model option with real-time routing info
- Routing decisions tracked in DB for feedback loop and cost analysis
- Fix: Chat scroll no longer locked to bottom during streaming
- Fix: Black-on-black text in code blocks resolved
- Fix: Nginx regex compatibility with pcre2

### v1.8.10
- Version bump, model pricing update (March 2026)

### v1.8.9
- Mobile UX responsive improvements

### v1.8.8
- Disable MFA for test accounts

## License

Apache 2.0
