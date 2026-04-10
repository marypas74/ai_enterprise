# Marketplace Competenze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Marketplace microservice that syncs competencies from aitmpl.com, allows installation with approval workflows, integrates with Qdrant for semantic search, and hooks into the EventBus pipeline.

**Architecture:** Separate Fastify microservice (port 3100) communicating with the existing backend via REST. Shares the same MariaDB (prefixed `marketplace_*` tables) and Qdrant instance. Frontend gets 3 new pages + modifications to existing admin pages.

**Tech Stack:** Node.js 20, Fastify 5, TypeScript, mysql2, Qdrant REST API, claude-code-templates CLI, Vitest, React 18, Tailwind CSS, Zustand

**Spec:** `docs/superpowers/specs/2026-03-19-marketplace-competenze-design.md`

**Build Rule:** Every phase MUST compile before moving to the next. Fix build errors before proceeding.

---

## File Structure

### Marketplace Microservice (`enterprise-ai-chat/marketplace/`)

```
marketplace/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
├── src/
│   ├── index.ts                          # Fastify app entry point
│   ├── config.ts                         # Environment config
│   ├── database/
│   │   ├── connection.ts                 # MySQL pool + advisory lock migrations
│   │   ├── helpers.ts                    # findOne, findMany, insertOne, etc.
│   │   └── migrations/
│   │       └── 001-initial-schema.ts     # All marketplace_* tables
│   ├── auth/
│   │   ├── jwtPlugin.ts                  # Verify user JWT (shared secret)
│   │   └── serviceToken.ts              # Generate/verify service-to-service JWT
│   ├── sync/
│   │   ├── SyncEngine.ts                # Orchestrates the full sync process
│   │   ├── CLIAdapter.ts                # Executes claude-code-templates CLI
│   │   ├── CatalogParser.ts             # Normalizes CLI output → catalog items
│   │   ├── TierClassifier.ts            # Assigns tier1/2/3 based on category
│   │   ├── DiffCalculator.ts            # Compares local vs remote catalog
│   │   ├── HealthChecker.ts             # Checks aitmpl.com availability
│   │   └── NotificationService.ts       # Tracks new items since last user visit
│   ├── catalog/
│   │   ├── catalogRoutes.ts             # GET /catalog, /catalog/:id, /catalog/search
│   │   └── CatalogService.ts            # DB queries + Qdrant semantic search
│   ├── install/
│   │   ├── installRoutes.ts             # POST/DELETE/GET/PATCH install endpoints
│   │   ├── InstallService.ts            # Install/uninstall logic + backend REST calls
│   │   └── TypeMapper.ts                # Maps catalog type → target_type + category
│   ├── approval/
│   │   ├── approvalRoutes.ts            # GET/POST approval endpoints
│   │   └── ApprovalService.ts           # Approval workflow logic
│   ├── kb/
│   │   ├── kbRoutes.ts                  # POST/GET/DELETE kb endpoints
│   │   └── KBService.ts                 # Document indexing in Qdrant competency_kb
│   ├── qdrant/
│   │   ├── QdrantClient.ts             # Qdrant REST API wrapper
│   │   └── EmbeddingIndexer.ts          # Index catalog items → competency_catalog
│   └── routes.ts                        # Route aggregator
├── tests/
│   ├── sync/
│   │   ├── CLIAdapter.test.ts
│   │   ├── CatalogParser.test.ts
│   │   ├── TierClassifier.test.ts
│   │   ├── DiffCalculator.test.ts
│   │   └── HealthChecker.test.ts
│   ├── catalog/
│   │   └── CatalogService.test.ts
│   ├── install/
│   │   ├── InstallService.test.ts
│   │   └── TypeMapper.test.ts
│   ├── approval/
│   │   └── ApprovalService.test.ts
│   └── kb/
│       └── KBService.test.ts
```

### Backend Modifications (`enterprise-ai-chat/backend/`)

```
backend/src/
├── modules/admin/
│   └── marketplace-proxy.ts             # NEW: Proxy /api/marketplace/* → marketplace:3100
```

### Frontend Modifications (`enterprise-ai-chat/frontend/`)

```
frontend/src/
├── hooks/
│   ├── useMarketplaceStore.ts           # NEW: Zustand store for marketplace
│   ├── useUserSkillsStore.ts            # NEW: Zustand store for user skills settings
│   └── useHookPipelineStore.ts          # NEW: Zustand store for pipeline visualizer
├── pages/
│   ├── AdminPage.tsx                    # MODIFY: Add marketplace route + nav link
│   ├── SettingsPage.tsx                 # MODIFY: Add skills tab/section
│   └── admin/
│       ├── MarketplacePage.tsx          # NEW: Marketplace browser
│       ├── PipelineVisualizerPage.tsx   # NEW: Hook pipeline visualizer
│       ├── SkillsPage.tsx              # MODIFY: Add marketplace badge
│       └── PluginsPage.tsx             # MODIFY: Add MCP approval status
├── services/
│   └── marketplaceApi.ts               # NEW: API client for marketplace endpoints
```

### K8s Manifests (`enterprise-ai-chat/k8s/`)

```
k8s/marketplace/
├── deployment.yaml
└── service.yaml
```

---

## Phase 1: Microservice Scaffold + DB (build must compile)

### Task 1: Initialize marketplace project

**Files:**
- Create: `marketplace/package.json`
- Create: `marketplace/tsconfig.json`
- Create: `marketplace/.env.example`

- [ ] **Step 1: Create marketplace directory**

```bash
mkdir -p enterprise-ai-chat/marketplace/src
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "enterprise-ai-chat-marketplace",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest --watch"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/jwt": "^9.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "mysql2": "^3.9.0",
    "zod": "^3.22.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.11.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create .env.example**

```
PORT=3100
DB_HOST=localhost
DB_PORT=3306
DB_USER=enterprise_ai
DB_PASSWORD=
DB_NAME=enterprise_ai_chat
QDRANT_URL=http://localhost:6333
BACKEND_INTERNAL_URL=http://backend:3000
MARKETPLACE_SERVICE_TOKEN=change-me
JWT_SECRET=must-match-backend
```

- [ ] **Step 5: Install dependencies**

```bash
cd enterprise-ai-chat/marketplace && npm install
```

- [ ] **Step 6: Verify build compiles**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

Expected: No errors (no source files yet, should pass)

- [ ] **Step 7: Commit**

```bash
git add marketplace/
git commit -m "feat: scaffold marketplace microservice project"
```

### Task 2: Database connection + migration system

**Files:**
- Create: `marketplace/src/config.ts`
- Create: `marketplace/src/database/connection.ts`
- Create: `marketplace/src/database/helpers.ts`
- Create: `marketplace/src/database/migrations/001-initial-schema.ts`
- Test: `marketplace/tests/database/helpers.test.ts`

- [ ] **Step 1: Write test for database helpers**

```typescript
// marketplace/tests/database/helpers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { findOne, findMany, insertOne, execute } from '../../src/database/helpers.js';

describe('Database helpers', () => {
  const mockPool = {
    execute: vi.fn(),
  } as any;

  it('findOne returns first row or null', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ id: 1, name: 'test' }]]);
    const result = await findOne(mockPool, 'SELECT * FROM t WHERE id = ?', [1]);
    expect(result).toEqual({ id: 1, name: 'test' });
  });

  it('findOne returns null when no rows', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const result = await findOne(mockPool, 'SELECT * FROM t WHERE id = ?', [999]);
    expect(result).toBeNull();
  });

  it('findMany returns all rows', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]]);
    const result = await findMany(mockPool, 'SELECT * FROM t');
    expect(result).toHaveLength(2);
  });

  it('insertOne returns insertId', async () => {
    mockPool.execute.mockResolvedValueOnce([{ insertId: 42 }]);
    const id = await insertOne(mockPool, 'INSERT INTO t (name) VALUES (?)', ['test']);
    expect(id).toBe(42);
  });
});
```

- [ ] **Step 2: Run test — should fail**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run tests/database/helpers.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create config.ts**

```typescript
// marketplace/src/config.ts
import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3100'),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'enterprise_ai',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'enterprise_ai_chat',
    connectionLimit: 10,
  },
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  backendUrl: process.env.BACKEND_INTERNAL_URL || 'http://backend:3000',
  serviceToken: process.env.MARKETPLACE_SERVICE_TOKEN || '',
  jwtSecret: process.env.JWT_SECRET || '',
} as const;
```

- [ ] **Step 4: Create database helpers**

```typescript
// marketplace/src/database/helpers.ts
import type mysql from 'mysql2/promise';

export async function findOne<T>(pool: mysql.Pool, sql: string, params: any[] = []): Promise<T | null> {
  const [rows] = await pool.execute(sql, params);
  const results = rows as T[];
  return results.length > 0 ? results[0] : null;
}

export async function findMany<T>(pool: mysql.Pool, sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function insertOne(pool: mysql.Pool, sql: string, params: any[] = []): Promise<number> {
  const [result] = await pool.execute(sql, params);
  return (result as any).insertId;
}

export async function execute(pool: mysql.Pool, sql: string, params: any[] = []): Promise<void> {
  await pool.execute(sql, params);
}
```

- [ ] **Step 5: Create database connection with advisory lock migrations**

Uses `execFile`-style parameterized queries only (no shell execution). All SQL uses parameterized prepared statements.

- [ ] **Step 6: Create initial schema migration**

All 5 `marketplace_*` tables as specified in the design spec (Section 4):
1. `marketplace_catalog_items` — synced catalog from aitmpl.com
2. `marketplace_installations` — what's installed, by whom, target mapping
3. `marketplace_sync_state` — singleton sync status tracker
4. `marketplace_approval_requests` — pending MCP/hook approvals
5. `marketplace_kb_documents` — knowledge base document tracking for Qdrant

- [ ] **Step 7: Run test — should pass**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run tests/database/helpers.test.ts
```

Expected: PASS

- [ ] **Step 8: Verify build compiles**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add marketplace/
git commit -m "feat: marketplace DB connection with advisory lock migrations"
```

### Task 3: Fastify app + health endpoint + JWT auth

**Files:**
- Create: `marketplace/src/auth/jwtPlugin.ts`
- Create: `marketplace/src/auth/serviceToken.ts`
- Create: `marketplace/src/index.ts`

- [ ] **Step 1: Create JWT plugin**

Registers `@fastify/jwt` with shared `JWT_SECRET`. Decorates `authenticate` and `authenticateAdmin` hooks (same pattern as backend).

- [ ] **Step 2: Create service token helper**

Generates short-lived (5min) HS256 JWT with `{ sub: "marketplace-service" }` for backend calls. Uses `crypto.createHmac` (no shell execution).

- [ ] **Step 3: Create Fastify app entry point**

Registers cors, rate-limit, JWT. Creates DB pool. Adds `/health` endpoint. Starts on configured port.

- [ ] **Step 4: Verify build compiles**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add marketplace/
git commit -m "feat: marketplace Fastify app with health endpoint and JWT auth"
```

---

## Phase 2: Sync Engine (build must compile)

### Task 4: TierClassifier + TypeMapper

**Files:**
- Create: `marketplace/src/sync/TierClassifier.ts`
- Create: `marketplace/src/install/TypeMapper.ts`
- Test: `marketplace/tests/sync/TierClassifier.test.ts`
- Test: `marketplace/tests/install/TypeMapper.test.ts`

- [ ] **Step 1: Write TierClassifier test**

Test tier1 (document-processing, database, security), tier2 (deep-research-team, data-ai), tier3 (game-development, unknown).

- [ ] **Step 2: Run test — should fail**

- [ ] **Step 3: Implement TierClassifier**

Set-based lookup for tier1 and tier2 categories. Anything else defaults to tier3.

- [ ] **Step 4: Write TypeMapper test**

Test type mapping (skill→skill, agent→skill, mcp→mcp_server, hook→hook_handler) and category mapping (document-processing→technical, development-tools→coding, ai-research→analysis, unknown→other).

- [ ] **Step 5: Implement TypeMapper**

Includes `mapTargetType()`, `mapCategory()`, `requiresApproval()`.

- [ ] **Step 6: Run tests — should pass**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run tests/sync/TierClassifier.test.ts tests/install/TypeMapper.test.ts
```

- [ ] **Step 7: Verify build compiles**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add marketplace/
git commit -m "feat: TierClassifier and TypeMapper with tests"
```

### Task 5: CLIAdapter + CatalogParser

**Files:**
- Create: `marketplace/src/sync/CLIAdapter.ts`
- Create: `marketplace/src/sync/CatalogParser.ts`
- Test: `marketplace/tests/sync/CLIAdapter.test.ts`
- Test: `marketplace/tests/sync/CatalogParser.test.ts`

- [ ] **Step 1: Write CLIAdapter test**

Mock `execFileSync` (NOT `exec` — use `execFileSync` from `child_process` to avoid shell injection). Test: valid JSON output returns parsed array, CLI failure throws, invalid JSON throws.

- [ ] **Step 2: Implement CLIAdapter**

**IMPORTANT:** Uses `execFileSync('claude-code-templates', ['list', '--type', type, '--format', 'json'])` — NOT `execSync` with string interpolation. This prevents shell injection. Implements `SourceAdapter` interface for swappability with `GitRepoAdapter`.

- [ ] **Step 3: Write CatalogParser test**

Test: builds correct source_id, assigns tier via TierClassifier, truncates long descriptions, sanitizes HTML tags.

- [ ] **Step 4: Implement CatalogParser**

`parseCatalogItem(raw, type)` — builds `CatalogItemInput` with sanitized fields.

- [ ] **Step 5: Run tests — should pass**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run tests/sync/
```

- [ ] **Step 6: Verify build**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add marketplace/
git commit -m "feat: CLIAdapter and CatalogParser with tests"
```

### Task 6: HealthChecker + DiffCalculator + SyncEngine

**Files:**
- Create: `marketplace/src/sync/HealthChecker.ts`
- Create: `marketplace/src/sync/DiffCalculator.ts`
- Create: `marketplace/src/sync/NotificationService.ts`
- Create: `marketplace/src/sync/SyncEngine.ts`
- Test: `marketplace/tests/sync/HealthChecker.test.ts`
- Test: `marketplace/tests/sync/DiffCalculator.test.ts`

- [ ] **Step 1: Write HealthChecker test**

Test: returns true when reachable, false when not, suspends after 3 failures, resets on success.

- [ ] **Step 2: Implement HealthChecker**

HEAD request to aitmpl.com with 5s timeout. Tracks `consecutiveFailures`, suspends at 3. `resume()` resets state.

- [ ] **Step 3: Write DiffCalculator test**

Test: detects new items, updated items (version changed), removed items.

- [ ] **Step 4: Implement DiffCalculator**

Pure function `calculateDiff(remote, localIds, localVersions) → { added, updated, removed }`.

- [ ] **Step 5: Create NotificationService**

Queries `marketplace_catalog_items` for items created after a given timestamp.

- [ ] **Step 6: Create SyncEngine**

Orchestrates: health check → fetch all component types via CLIAdapter → parse → diff → apply (INSERT/UPDATE/DELETE) → update sync state. Uses parameterized SQL only.

- [ ] **Step 7: Run all tests**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run
```

- [ ] **Step 8: Verify build compiles**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add marketplace/
git commit -m "feat: SyncEngine with HealthChecker, DiffCalculator, and NotificationService"
```

---

## Phase 3: API Routes — Catalog, Sync, Install, Approvals (build must compile)

### Task 7: Catalog routes

**Files:**
- Create: `marketplace/src/catalog/CatalogService.ts`
- Create: `marketplace/src/catalog/catalogRoutes.ts`
- Create: `marketplace/src/routes.ts`
- Modify: `marketplace/src/index.ts` — register routes
- Test: `marketplace/tests/catalog/CatalogService.test.ts`

- [ ] **Step 1: Write CatalogService test**

Test `list()` with filters (type, tier, category), pagination, and `getById()`.

- [ ] **Step 2: Implement CatalogService**

`list({ type?, tier?, category?, search?, page, limit })` — builds SQL dynamically with parameterized params. `getById(id)` — single item. `search(query)` — delegates to Qdrant (stub for now, full impl in Phase 4).

- [ ] **Step 3: Implement catalogRoutes**

Fastify routes with Zod schema validation. All responses use standard envelope `{ success, data, error, meta }`.

- [ ] **Step 4: Create routes aggregator and wire into index.ts**

`routes.ts` registers all route modules under `/api/marketplace`. Add to `index.ts`.

- [ ] **Step 5: Run tests + verify build**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add marketplace/
git commit -m "feat: catalog API routes with pagination and filtering"
```

### Task 8: Sync routes

**Files:**
- Create: `marketplace/src/sync/syncRoutes.ts`

- [ ] **Step 1: Implement sync routes**

`POST /sync` — admin only, rate limit 1/5min, triggers SyncEngine.sync(). `GET /sync/status` — admin, returns sync state from DB. `PATCH /sync/resume` — admin, calls engine.resume(). `GET /sync/notifications` — user, returns new items count.

- [ ] **Step 2: Wire into routes.ts and verify build**

```bash
cd enterprise-ai-chat/marketplace && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add marketplace/
git commit -m "feat: sync API routes (trigger, status, resume, notifications)"
```

### Task 9: Install routes + InstallService

**Files:**
- Create: `marketplace/src/install/InstallService.ts`
- Create: `marketplace/src/install/installRoutes.ts`
- Test: `marketplace/tests/install/InstallService.test.ts`

- [ ] **Step 1: Write InstallService test**

Test: install skill → status `installed` + backend REST call. Install MCP → status `pending_approval` + creates approval request. Uninstall → removes record + backend DELETE. Max 50 installations check.

- [ ] **Step 2: Implement InstallService**

`install(catalogItemId, userId)` — checks type via TypeMapper, creates installation row, for skills/agents calls backend `POST /api/skills` via service token, for MCP/hooks creates approval request. `uninstall(installationId, userId)` — deletes from backend + local DB. `listByUser(userId, page, limit)` — paginated.

- [ ] **Step 3: Implement installRoutes**

Rate limited 10/min per user. Zod validation. Standard envelope responses.

- [ ] **Step 4: Run tests + verify build**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add marketplace/
git commit -m "feat: install/uninstall API with backend REST integration"
```

### Task 10: Approval routes

**Files:**
- Create: `marketplace/src/approval/ApprovalService.ts`
- Create: `marketplace/src/approval/approvalRoutes.ts`
- Test: `marketplace/tests/approval/ApprovalService.test.ts`

- [ ] **Step 1: Write test**

Test approve → triggers installation completion, reject → sets status with notes, listPending returns only pending.

- [ ] **Step 2: Implement ApprovalService + routes**

`approve(requestId, adminId, notes?)` — updates status, triggers InstallService for the actual backend creation. `reject(requestId, adminId, notes)` — updates status. `listPending(page, limit)`.

- [ ] **Step 3: Run tests + verify build**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add marketplace/
git commit -m "feat: approval workflow for MCP/hook installations"
```

---

## Phase 4: Qdrant Integration (build must compile)

### Task 11: QdrantClient + EmbeddingIndexer

**Files:**
- Create: `marketplace/src/qdrant/QdrantClient.ts`
- Create: `marketplace/src/qdrant/EmbeddingIndexer.ts`
- Test: `marketplace/tests/qdrant/QdrantClient.test.ts`

- [ ] **Step 1: Write QdrantClient test**

Mock fetch. Test `ensureCollection()`, `upsertPoints()`, `search()`, `deleteByFilter()`.

- [ ] **Step 2: Implement QdrantClient**

Wrapper around Qdrant REST API. Follows same patterns as existing `VectorStoreService.ts` (`backend/src/services/VectorStoreService.ts`). Uses `QDRANT_URL` from config.

- [ ] **Step 3: Implement EmbeddingIndexer**

On sync, indexes catalog items where `embedding_indexed = FALSE` into `competency_catalog` collection. Calls backend embedding endpoint to generate vectors. Sets `embedding_indexed = TRUE`.

- [ ] **Step 4: Wire into SyncEngine (call after successful sync)**

- [ ] **Step 5: Wire semantic search into CatalogService.search()**

- [ ] **Step 6: Run tests + verify build**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add marketplace/
git commit -m "feat: Qdrant integration for competency catalog indexing"
```

### Task 12: Knowledge Base service + routes

**Files:**
- Create: `marketplace/src/kb/KBService.ts`
- Create: `marketplace/src/kb/kbRoutes.ts`
- Test: `marketplace/tests/kb/KBService.test.ts`

- [ ] **Step 1: Write KBService test**

Test: indexDocument chunks and upserts into `competency_kb` with `installation_id` payload. removeDocument deletes by filter. listDocuments returns from DB.

- [ ] **Step 2: Implement KBService**

`indexDocument(installationId, documentName, content)` — chunks content, generates embeddings, upserts into `competency_kb` collection with `{ installation_id }` payload. `removeDocument(docId)` — deletes from Qdrant by `installation_id` filter + DB row. `listDocuments(installationId)`.

- [ ] **Step 3: Implement kbRoutes**

Rate limited 5/min per user.

- [ ] **Step 4: Run tests + verify build**

```bash
cd enterprise-ai-chat/marketplace && npx vitest run && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add marketplace/
git commit -m "feat: knowledge base document indexing and management"
```

---

## Phase 5: Backend Integration (build must compile)

### Task 13: Backend marketplace proxy

**Files:**
- Create: `backend/src/modules/admin/marketplace-proxy.ts`
- Modify: `backend/src/index.ts` — register proxy routes

- [ ] **Step 1: Create proxy module**

Proxies all `/api/marketplace/*` requests to marketplace service at `MARKETPLACE_SERVICE_URL` (env, default `http://marketplace:3100`). Forwards auth headers. Uses `fetch()` (no shell execution).

- [ ] **Step 2: Register in index.ts**

Add import and register after other routes.

- [ ] **Step 3: Verify backend build**

```bash
cd enterprise-ai-chat/backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "feat: backend proxy for marketplace microservice"
```

### Task 14: Backend auto-suggest hook

**Files:**
- Modify: `backend/src/services/EventBusService.ts` — register auto-suggest handler at bootstrap

- [ ] **Step 1: Add auto-suggest hook handler**

Register a `before_llm_call` handler (priority 50) that:
1. Checks `system_settings.marketplace_autosuggest_enabled` (default true)
2. Checks per-user opt-out setting
3. Queries Qdrant `competency_catalog` with message embedding
4. Returns top 3 matches (score > 0.75) as suggestions in the response metadata
5. Caches results per `conversation_id` in Redis (TTL 5min)
6. Times out at 100ms — if Qdrant is slow, skips silently

- [ ] **Step 2: Verify backend build**

```bash
cd enterprise-ai-chat/backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/
git commit -m "feat: auto-suggest competencies via Qdrant before_llm_call hook"
```

---

## Phase 6: Frontend (build must compile)

### Task 15: Marketplace API client + Zustand stores

**Files:**
- Create: `frontend/src/services/marketplaceApi.ts`
- Create: `frontend/src/hooks/useMarketplaceStore.ts`
- Create: `frontend/src/hooks/useUserSkillsStore.ts`
- Create: `frontend/src/hooks/useHookPipelineStore.ts`

- [ ] **Step 1: Create API client**

Uses existing `api` instance from `frontend/src/services/api.ts`. Wraps all marketplace endpoints. All calls go through `/api/marketplace/*`.

- [ ] **Step 2: Create useMarketplaceStore**

State: `catalogItems`, `syncStatus`, `notifications`, `filters`, `pagination`, `loading`. Actions: `fetchCatalog()`, `triggerSync()`, `installItem()`, `uninstallItem()`, `fetchNotifications()`.

- [ ] **Step 3: Create useUserSkillsStore**

State: `installedSkills`, `approvalRequests`, `loading`. Actions: `fetchMySkills()`, `toggleSkill()`, `requestApproval()`.

- [ ] **Step 3b: Create useHookPipelineStore**

State: `hookPoints`, `handlers`, `traceLog`, `loading`. Actions: `fetchHookPoints()`, `reorderHandler()`, `toggleHandler()`, `fetchTraceLog()`.

- [ ] **Step 4: Verify frontend build**

```bash
cd enterprise-ai-chat/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: marketplace API client and Zustand stores"
```

### Task 16: MarketplacePage (admin)

**Files:**
- Create: `frontend/src/pages/admin/MarketplacePage.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx` — add route + nav link

- [ ] **Step 1: Create MarketplacePage**

Grid layout with catalog cards. Each card: name, description, tier badge (tier1=green, tier2=blue, tier3=gray), category, type icon (Brain for skill, Bot for agent, Plug for MCP, Webhook for hook), install/uninstall button. Top bar: type filter dropdown, tier filter, category filter, search input. Admin section: "Sync Now" button with last sync status, "X new items" indicator. Banner: "Catalog offline — last sync: {date}" when sync suspended.

Follow existing admin page patterns (see `frontend/src/pages/admin/SkillsPage.tsx` for reference).

- [ ] **Step 2: Add route to AdminPage**

In `AdminPage.tsx` (line ~680), add `<Route path="/marketplace" element={<MarketplacePage />} />`. Add nav link with `Store` icon from lucide-react in the sidebar section.

- [ ] **Step 3: Verify frontend build**

```bash
cd enterprise-ai-chat/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: marketplace browser admin page"
```

### Task 17: User Skills Settings

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx` — add skills section

- [ ] **Step 1: Add "My Skills" section to SettingsPage**

New section below existing settings content. Shows installed skills with on/off toggle. "Browse more" link opens MarketplacePage (if admin) or shows available skills list (if user). For MCP/hooks: "Request Access" button creates approval request. Status badges: pending (yellow), approved (green), rejected (red).

- [ ] **Step 2: Verify frontend build**

```bash
cd enterprise-ai-chat/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat: user skills settings section"
```

### Task 18: Pipeline Visualizer + SkillsPage badge + PluginsPage MCP status

**Files:**
- Create: `frontend/src/pages/admin/PipelineVisualizerPage.tsx`
- Modify: `frontend/src/pages/admin/SkillsPage.tsx`
- Modify: `frontend/src/pages/admin/PluginsPage.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Create PipelineVisualizerPage**

For each hook point (from `GET /api/hooks`), show a card with registered handlers sorted by priority. Each handler row: priority number, name, source (system/marketplace), enable/disable toggle. Drag-and-drop to reorder priority (calls `PATCH /api/hooks/:id` with new priority). Trace log panel at bottom (from `GET /api/hooks/trace`).

- [ ] **Step 2: Add marketplace badge to SkillsPage**

In `frontend/src/pages/admin/SkillsPage.tsx`, add a small "Marketplace" badge (pill, blue background) next to skills that have a corresponding `marketplace_installations` entry. Add a link to the marketplace detail view.

- [ ] **Step 2b: Add MCP approval status to PluginsPage**

In `frontend/src/pages/admin/PluginsPage.tsx`, in the MCP Servers tab, show approval status badges for MCP servers installed from the marketplace. Badge colors: pending (yellow), approved (green), rejected (red). Query marketplace API for installation status of each MCP server.

- [ ] **Step 3: Add routes to AdminPage**

Add `<Route path="/marketplace" .../>` and `<Route path="/hooks/pipeline" element={<PipelineVisualizerPage />} />` (matching spec route `/admin/hooks/pipeline`).

- [ ] **Step 4: Verify frontend build**

```bash
cd enterprise-ai-chat/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: pipeline visualizer and marketplace badges"
```

### Task 19: Notification badge in sidebar

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Add notification badge**

Poll `/api/marketplace/sync/notifications` every 5 minutes (via useMarketplaceStore). Show red dot with count next to "Marketplace" nav item when new items > 0. Show orange badge next to "Permissions" for pending approval count.

- [ ] **Step 2: Verify frontend build**

```bash
cd enterprise-ai-chat/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat: notification badges for marketplace and approvals"
```

---

## Phase 7: K8s Deployment + Docker (build must compile)

### Task 20: Docker + K8s manifests

**Files:**
- Create: `marketplace/Dockerfile`
- Create: `k8s/marketplace/deployment.yaml`
- Create: `k8s/marketplace/service.yaml`
- Modify: `BUILD.sh` — add marketplace build step

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g claude-code-templates@1.0.0
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3100
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create K8s deployment**

As per spec section 12: 1 replica, liveness/readiness probes on `/health:3100`, env vars from `app-secrets`, resource limits 256Mi-512Mi.

- [ ] **Step 3: Create K8s service**

ClusterIP on port 3100.

- [ ] **Step 4: Add to BUILD.sh**

Add marketplace Docker build, push to `localhost:32000/enterprise-ai-chat/marketplace:1.0.0`, and K8s apply.

- [ ] **Step 5: Commit**

```bash
git add marketplace/Dockerfile k8s/marketplace/ BUILD.sh
git commit -m "feat: marketplace Docker and K8s deployment manifests"
```

### Task 21: Full integration build

- [ ] **Step 1: Build all three components**

```bash
cd enterprise-ai-chat/marketplace && npm run build
cd enterprise-ai-chat/backend && npm run build
cd enterprise-ai-chat/frontend && npm run build
```

All three MUST compile without errors.

- [ ] **Step 2: Run all test suites**

```bash
cd enterprise-ai-chat/marketplace && npm test
cd enterprise-ai-chat/backend && npm test
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: marketplace competenze — complete implementation"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-3 | Microservice scaffold, DB, Fastify app |
| 2 | 4-6 | Sync engine (TierClassifier, CLIAdapter, CatalogParser, HealthChecker, DiffCalculator, SyncEngine) |
| 3 | 7-10 | API routes (catalog, sync, install, approvals) |
| 4 | 11-12 | Qdrant integration (catalog indexing, knowledge base) |
| 5 | 13-14 | Backend integration (proxy, auto-suggest hook) |
| 6 | 15-19 | Frontend (stores, marketplace page, settings, pipeline viz, notifications) |
| 7 | 20-21 | Docker, K8s, full build verification |
