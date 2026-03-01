# Enterprise AI Chat

Enterprise-grade AI chat platform with multi-provider support, autonomous AI agents, project management, and VS Code extension.

**Current version: 1.8.11**

## Features

- **Multi-Provider AI**: OpenAI, Anthropic Claude, Google Gemini, Ollama (local models) with automatic failover
- **Autonomous AI Agents**: Claude Agent SDK integration with terminal orchestration, task management, and iterative execution
- **Project Management**: Kanban boards with AI-powered cards, agent linking, and real-time collaboration
- **Vector Memory**: RAG pipeline with embeddings, semantic search, HyDE, and 4-tier memory (episodic/declarative/procedural/working)
- **Document Processing**: OCR (Tesseract), PDF parsing, DOCX/XLSX/PPTX generation, chunking with overlap
- **Plugin System**: File-based plugins with EventBus hooks, MCP server support
- **EU AI Act Compliance**: Art. 50.1/50.2 disclosure, consent management, bias monitoring, audit logging
- **VS Code Extension**: Full IDE integration with chat, code actions, agent sessions, inline editing
- **Real-time Chat**: SSE streaming with markdown rendering, file attachments, conversation management
- **Admin Dashboard**: User/group management, provider configuration, system monitoring, prompt templates
- **Security**: JWT + MFA (TOTP), Zod input validation, rate limiting, OWASP hardening
- **Kubernetes Ready**: Production deployment with MicroK8s, auto-scaling, backup CronJobs

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (React 18 + Vite)                    │
│  Chat UI │ Admin Panel │ Projects/Kanban │ Agent Dashboard       │
│  Zustand stores │ Tailwind CSS │ Lazy loading │ Code splitting   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Nginx reverse proxy
┌───────────────────────────▼─────────────────────────────────────┐
│                   Backend (Fastify 5 + TypeScript)               │
│  20+ modules │ JWT/MFA auth │ WebSocket │ SSE streaming          │
│  Zod validation │ Rate limiting │ Swagger/OpenAPI docs           │
├─────────┬──────────┬──────────┬──────────┬─────────┬────────────┤
│  Auth   │   Chat   │  Agents  │ Projects │  Admin  │   Tools    │
│  MFA    │ Complete │ Sessions │  Kanban  │ Users   │ DOCX/XLSX  │
│  OAuth  │ Stream   │ Orchestr │  Boards  │ Provid  │ PDF/PPTX   │
│  Sessions│ Memory  │ Terminal │  Cards   │ Plugins │ Sandbox    │
└─────────┴────┬─────┴──────────┴──────────┴─────────┴────────────┘
               │
  ┌────────────┼────────────┬──────────────┬──────────────┐
  │            │            │              │              │
┌─▼──────┐ ┌──▼─────┐ ┌────▼─────┐ ┌─────▼────┐ ┌──────▼──────┐
│MariaDB │ │ Redis  │ │  Qdrant  │ │ Parlant  │ │   Ollama    │
│Users   │ │Sessions│ │ Vectors  │ │ Agents   │ │ Local LLMs  │
│Chat    │ │Cache   │ │Embeddings│ │Guidelines│ │ GPU Accel.  │
│Projects│ │Tokens  │ │ RAG      │ │ Sessions │ │             │
└────────┘ └────────┘ └──────────┘ └──────────┘ └─────────────┘
```

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
│   │   │   ├── admin/          # Users, providers, plugins, settings, skills
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
│   │   │   ├── tools/          # FileTools, DocumentTools, WebTools, SystemTools
│   │   │   ├── agent/          # AgentSessionManager, AgentExecutor
│   │   │   ├── ModelRouter.ts  # Intelligent model selection
│   │   │   ├── SemanticRouter.ts # Intent classification
│   │   │   └── ...             # 20+ services
│   │   └── database/           # Connection pool + query helpers
│   ├── test/                   # Test setup + helpers
│   ├── vitest.config.ts        # Test configuration
│   └── Dockerfile
├── frontend/                   # React 18 + Vite + Tailwind
│   ├── src/
│   │   ├── pages/              # 11 lazy-loaded route pages
│   │   ├── hooks/              # Zustand stores (auth, agents, parlant)
│   │   ├── components/         # Reusable UI components
│   │   └── services/           # API client (axios + SSE)
│   ├── test/                   # Test setup + helpers
│   ├── vitest.config.ts        # Frontend test config
│   ├── nginx.conf              # Production config (gzip, cache, CSP headers)
│   └── Dockerfile
├── vscode-extension/           # VS Code companion extension
│   ├── src/
│   │   ├── extension.ts        # Entry point (~500 LOC)
│   │   ├── auth/               # AuthService, ClaudeOAuth
│   │   ├── commands/           # CodeActions, RegisterCommands
│   │   ├── messaging/          # MessageHandler (SSE streaming)
│   │   ├── providers/          # ChatViewHtml, Kanban, Messaging
│   │   ├── models/             # ModelFetcher
│   │   └── utils/              # Helpers
│   └── webview-ui/             # React webview bundles
├── k8s/                        # Kubernetes manifests
│   ├── backend/                # Deployment + PDB + startup probe
│   ├── frontend/               # Deployment (Nginx)
│   ├── mariadb/                # StatefulSet + backup CronJob
│   ├── redis/                  # StatefulSet
│   ├── parlant/                # Parlant AI service
│   └── kustomization.yaml      # Kustomize overlay
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
| Chat | `/api/chat` | Completions (SSE), conversations CRUD, models |
| Agents | `/api/agents` | Sessions CRUD, start/pause/resume, templates |
| Projects | `/api/projects` | Projects, boards, columns, cards, agent linking |
| Admin | `/api/admin` | Users, providers, plugins, settings, skills, audit |
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
- **Input Validation**: Zod schemas on all 79+ endpoints (zero unsafe `request.body as` casts)
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
- **Registry**: localhost:32000 (MicroK8s built-in)

### Rollout Process

```bash
# 1. Build and push images
bash BUILD.sh

# 2. Scale down, apply, scale up
kubectl scale deployment backend --replicas=0 -n enterprise-ai-chat
kubectl apply -f k8s/backend/deployment.yaml
kubectl scale deployment backend --replicas=2 -n enterprise-ai-chat
```

## License

Apache 2.0
