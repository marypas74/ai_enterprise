# Cheshire Cat Integration Roadmap — enterprise-ai-chat

**Date:** 2026-02-24
**Branch:** `feature/cheshire-cat-integration`
**Base Commit:** `4fa1d8f`
**Reference:** [cheshire-cat-ai/core](https://github.com/cheshire-cat-ai/core)

---

## PART 1 — CRITICAL FIXES (Must-do before current code works)

These are bugs and gaps in the already-committed code that prevent correct functioning.

### 1.1 Frontend-Backend API Mismatches (6 bugs)

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `HooksPage.tsx:48-49` | Reads `data.handlers` / `data.availableHooks` but backend returns `data.registered_handlers` / `data.available_hooks` | Change to `data.registered_handlers` and `data.available_hooks` |
| 2 | `FormsPage.tsx:59` | `setForms(Array.isArray(data) ? data : [])` but backend returns `{ forms: [...] }` | Change to `setForms(data.forms ?? [])` |
| 3 | `VectorMemoryPage.tsx:136` | Sends `?query=...` but backend expects `?text=...` | Change query param to `text` |
| 4 | `VectorMemoryPage.tsx:180` | `setRecallSettings(data)` but backend returns `{ settings, message }` | Change to `setRecallSettings(data.settings)` |
| 5 | `FormsPage.tsx` (create) | POST body may not match backend expected field names | Verify field names match backend `insertOne` columns |
| 6 | `VectorMemoryPage.tsx` (ingest) | Ingestion history fetch may return `{rows:[]}` not flat array | Verify response shape matches frontend expectations |

### 1.2 Missing Hook Emissions (5 hooks defined but never fired)

| Hook | Where it should fire | Impact |
|------|---------------------|--------|
| `after_message_read` | After `before_message_read` in `chat/routes.ts` | Any plugin expecting post-read processing won't trigger |
| `before_tool_execute` | Before tool execution block in chat pipeline (~line 591) | No pre-tool-call interception possible |
| `after_tool_execute` | After tool execution block (~line 616) | No post-tool-call logging/modification |
| `on_document_upload` | In the document upload handler | No notification when documents are uploaded |
| `on_document_chunked` | After chunking in document processing pipeline | No notification after chunking |

### 1.3 ConversationalFormService Not Integrated in Chat Pipeline

**Current state:** Forms can be created/managed via admin UI and REST API, but the chat pipeline NEVER checks for active form sessions, never runs extraction prompts, and never transitions form state during conversation.

**What must be added to `chat/routes.ts`:**
1. Check for active form session at start of message processing
2. If active, inject extraction prompt into LLM call
3. Process extraction results and update form state
4. Return form-specific responses (field prompts, confirmation requests)
5. Handle form completion actions (webhook, email, API)

### 1.4 Frontend Components Not Wired

| Component | Status | What's needed |
|-----------|--------|---------------|
| `MemoryPanel.tsx` | Built but never imported/rendered | Import in ChatPage.tsx, wire to vector memory recall API |
| `ConversationalFormIndicator.tsx` | Built but never imported/rendered | Import in ChatPage.tsx, show during active form sessions |

### 1.5 Missing Environment Configuration

| Variable | Default | Used by | Status |
|----------|---------|---------|--------|
| `QDRANT_URL` | `http://localhost:6333` | VectorMemoryService, VectorStoreService | Not in `.env.example` |

### 1.6 Qdrant Deployment

Qdrant is required for VectorMemoryService (episodic/declarative/procedural memory). Currently NOT deployed in K8s. Options:
- **Docker container on host** (like Ollama) — simplest
- **K8s StatefulSet** with PVC for persistence
- **Qdrant Cloud** (managed service)

The code gracefully degrades without Qdrant (all recall returns empty, no errors), but memory features won't work.

---

## PART 2 — FEATURE ROADMAP (Cheshire Cat features to implement)

### Comparison Matrix: Cheshire Cat vs Current Implementation

| Feature | Cheshire Cat | Current Status | Priority |
|---------|-------------|----------------|----------|
| **EventBus (Hook Pipeline)** | 28 hooks, piped execution, deep-copy tea-cup pattern | 15 hooks, pipe/emit, 9 actively called | P1 |
| **3-Tier Vector Memory** | Episodic/Declarative/Procedural via Qdrant | Implemented, needs Qdrant deploy | P0 |
| **Working Memory** | Per-session volatile state (history, recall results, active form) | Partially via conversation history | P1 |
| **Plugin System (Mad Hatter)** | File-based plugins, @hook/@tool/@form/@endpoint decorators, lifecycle mgmt, settings | Not implemented | P2 |
| **Agent Chain** | MainAgent → ProceduresAgent → FormAgent → MemoryAgent | Single LLM call pipeline | P1 |
| **Tool System** | @tool decorator, procedural memory retrieval, LLM tool selection | Basic tool_choice in chat pipeline | P2 |
| **CatForm** | Pydantic-based forms, LLM extraction, state machine, in-conversation | DB-based forms, no chat integration | P1 |
| **RabbitHole (Doc Ingestion)** | Multi-format parser, chunking hooks, progress WS notifications | WebScraperService (URL only), ChunkingService | P2 |
| **LLM/Embedder Factory** | 13 LLMs, 9 embedders, admin UI selection, hot-swap | AIProviderFactory (multi-provider) | P3 |
| **Prompt Templates** | Hookable prefix/suffix, tool selection prompt, memory context injection | Hardcoded system prompts | P1 |
| **Streaming** | Token-by-token via WebSocket callbacks | Already implemented via SSE | Done |
| **WhiteRabbit (Scheduler)** | Cron/interval/one-shot task scheduling | Not implemented | P3 |
| **Cache System** | In-memory or file-system cache for working memory | Redis-based session cache | Done |
| **Permission System** | Resource-based (11 resources × 5 permissions) | Role-based (admin/user) | P3 |
| **Custom Endpoints** | @endpoint decorator lets plugins add routes | Not implemented | P2 |
| **Plugin Registry** | Download/install from registry.cheshirecat.ai | Not implemented | P4 |

---

### Phase 1 — FOUNDATION FIXES (Estimated: 1-2 sessions)

> Make everything already committed actually work.

- [ ] **Fix all 6 frontend-backend API mismatches** (HooksPage, FormsPage, VectorMemoryPage)
- [ ] **Wire `MemoryPanel.tsx`** into ChatPage as a sidebar toggle
- [ ] **Wire `ConversationalFormIndicator.tsx`** into ChatPage message area
- [ ] **Add missing hook emissions** (after_message_read, before/after_tool_execute, on_document_upload, on_document_chunked)
- [ ] **Add `QDRANT_URL` to `.env.example`** and backend `.env`
- [ ] **Deploy Qdrant** as Docker container on host (like Ollama), accessible via `http://10.0.1.1:6333` or similar proxy
- [ ] **Integrate ConversationalFormService into chat pipeline**:
  - Check for active session on each message
  - Run extraction prompt via LLM
  - Update session state
  - Send form-specific messages back to user
- [ ] **Implement `on_complete_action` execution** (webhook POST, email send, API call) when forms complete

---

### Phase 2 — WORKING MEMORY & AGENT CHAIN (Estimated: 2-3 sessions)

> Port the Cheshire Cat's core conversation architecture.

#### 2A. Working Memory Service
Create a `WorkingMemoryService` that stores per-user, per-conversation volatile state:
- `user_message_json` — current user message
- `recall_query` — the query used for memory retrieval
- `episodic_memories` — recalled episodic results for current turn
- `declarative_memories` — recalled declarative results
- `procedural_memories` — recalled procedural results (tools/forms)
- `agent_input` — formatted input for the agent chain
- `active_form` — reference to currently active CatForm
- `model_interactions` — log of LLM calls with token counts
- Use Redis for persistence across requests (TTL: session duration)

#### 2B. Agent Chain Architecture
Implement the Cheshire Cat's agent chain of responsibility:

```
MainAgent.execute(context)
  ├─ formatAgentInput()          // Prepare memories + chat history
  ├─ hook: before_agent_starts
  ├─ hook: agent_fast_reply      // Short-circuit opportunity
  ├─ ProceduresAgent.execute()
  │   ├─ FormAgent.execute()     // Check active forms first
  │   └─ If procedural memories recalled:
  │       ├─ Build tool selection prompt
  │       ├─ LLM Call #1: tool/form selection (JSON output)
  │       └─ Execute chosen tool/form
  └─ MemoryAgent.execute()       // LLM Call #2: final response
      └─ System prompt + memories + tool outputs + history → response
```

This replaces the current single-LLM-call pattern with a two-stage pipeline:
1. **Tool/Form selection** (when procedural memories match) — non-streaming
2. **Conversational response** (always) — streaming

#### 2C. Hookable Prompt Templates
Replace hardcoded system prompts with a hookable template system:
- `agent_prompt_prefix` — personality/role definition
- `agent_prompt_suffix` — context sections (episodic, declarative, tools output)
- `agent_prompt_instructions` — tool/form selection instructions
- Store default templates in DB (editable via admin UI)
- Inject recalled memories into template placeholders

#### 2D. New Hooks (port from Cheshire Cat)
Add these missing hooks to match the Cheshire Cat's 28 hooks:

| Hook | Type | Purpose |
|------|------|---------|
| `cat_recall_query` | pipe | Edit the semantic search query before recall |
| `before_cat_recalls_memories` | emit | Intercept before any memory search |
| `before_cat_recalls_episodic_memories` | pipe | Configure episodic recall params (k, threshold) |
| `before_cat_recalls_declarative_memories` | pipe | Configure declarative recall params |
| `before_cat_recalls_procedural_memories` | pipe | Configure procedural recall params |
| `after_cat_recalls_memories` | emit | After all memory searches complete |
| `before_agent_starts` | pipe | Edit agent input before execution |
| `agent_fast_reply` | pipe | Short-circuit after recall, before agent |
| `agent_prompt_prefix` | pipe | Edit system prompt personality |
| `agent_prompt_suffix` | pipe | Edit context template |
| `agent_prompt_instructions` | pipe | Edit tool selection instructions |
| `agent_allowed_tools` | pipe | Filter which tools reach the agent prompt |
| `before_cat_stores_episodic_memory` | pipe | Edit document before episodic storage |

---

### Phase 3 — PLUGIN SYSTEM "MAD HATTER" (Estimated: 3-4 sessions)

> Enable extensibility through installable plugins.

#### 3A. Plugin Runtime
- **Plugin folder structure**: `plugins/{plugin-id}/` with `plugin.json` manifest, `index.ts` entry point, optional `settings.json`
- **Plugin discovery**: Scan `plugins/` directory on boot
- **Plugin loading**: Dynamic `import()` of TypeScript/JavaScript modules
- **Plugin lifecycle**: `activate()` → register hooks/tools/forms → `deactivate()` → unregister all
- **Plugin settings**: JSON Schema for per-plugin configuration, stored in DB

#### 3B. Decorators (TypeScript equivalents)

```typescript
// Hook registration
export const hooks = {
  before_cat_reads_message: (data: any, ctx: HookContext) => {
    // modify data
    return data;
  }
};

// Tool registration
export const tools = [
  {
    name: 'search_web',
    description: 'Search the web for information',
    examples: ['search for cats', 'find information about'],
    returnDirect: false,
    execute: async (input: string, ctx: ToolContext) => {
      return 'search results...';
    }
  }
];

// Form registration
export const forms = [
  {
    name: 'PizzaOrder',
    description: 'Order a pizza',
    schema: PizzaOrderSchema,      // JSON Schema
    startExamples: ['order a pizza', 'I want pizza'],
    stopExamples: ['cancel order', 'never mind'],
    askConfirm: true,
    onSubmit: async (data: any, ctx: FormContext) => {
      // process completed form
    }
  }
];
```

#### 3C. Plugin Admin UI
- Plugin list page (installed, active/inactive toggle)
- Plugin settings editor (auto-generated from JSON Schema)
- Plugin upload (zip file)
- Plugin marketplace browser (future)

#### 3D. Custom Endpoint Registration
Allow plugins to register new API routes:
```typescript
export const endpoints = [
  { method: 'GET', path: '/custom/hello', handler: async (req, reply) => ({ hello: 'world' }) }
];
```

---

### Phase 4 — ENHANCED DOCUMENT INGESTION "RABBIT HOLE" (Estimated: 2 sessions)

> Full document ingestion pipeline with hooks.

#### 4A. Multi-Format Parser
Extend WebScraperService into a full RabbitHole:
- PDF (`pdf-parse` — already available)
- Word documents (`mammoth` — already available)
- Excel (`xlsx` — already available)
- PowerPoint (`pptxgenjs` — already available)
- Markdown / plain text (built-in)
- HTML (current scraper, improve extraction)
- CSV (new parser needed)

#### 4B. Hookable Chunking Pipeline
```
Upload/URL → Parse → hook:before_splits_text → Chunk → hook:after_splits_text
  → hook:before_stores_documents → Embed & Store each chunk → hook:after_stored_documents
```

#### 4C. Ingestion Progress via WebSocket
Send real-time progress updates during document ingestion:
- `{ type: 'ingestion_progress', status: 'parsing', file: 'report.pdf' }`
- `{ type: 'ingestion_progress', status: 'chunking', chunks: 45 }`
- `{ type: 'ingestion_progress', status: 'embedding', progress: '23/45' }`
- `{ type: 'ingestion_progress', status: 'completed', total_chunks: 45 }`

#### 4D. Memory Import/Export
- Export all vector memory collections to JSON
- Import from JSON (validate embedder dimensions match)
- Per-collection export/import

---

### Phase 5 — PROCEDURAL MEMORY & TOOL RETRIEVAL (Estimated: 2 sessions)

> LLM-driven tool selection using semantic memory.

#### 5A. Procedural Memory Storage
When plugins register tools/forms:
1. Embed tool descriptions and examples into `procedural_memory` collection
2. Store metadata: `{ type: 'tool'|'form', name, pluginId, triggerType: 'description'|'start_example' }`
3. On plugin deactivation, remove associated procedural memories

#### 5B. Semantic Tool Retrieval
During message processing:
1. Embed user message
2. Search `procedural_memory` for matching tools/forms (k=3, threshold=0.7)
3. If matches found, build tool selection prompt
4. LLM selects the best tool/form (JSON output: `{ action, action_input }`)
5. Execute the selected tool/form
6. Include tool output in the final response context

#### 5C. Tool Selection Prompt Template
Port the Cheshire Cat's `TOOL_PROMPT`:
```
Create a JSON with the correct "action" and "action_input" to help the user.
Available actions:
{tools}
- "no_action": Use this if no relevant action is available.

{examples}

Output JSON: {"action": "...", "action_input": "..."}
```

---

### Phase 6 — TASK SCHEDULER "WHITE RABBIT" (Estimated: 1 session)

> Schedule delayed and recurring tasks.

#### 6A. Scheduler Service
- One-shot tasks: execute after N seconds/minutes/hours
- Interval tasks: repeat every N seconds
- Cron tasks: run on cron schedule
- Job management: list, pause, resume, cancel
- Use `node-cron` or Bull queue (already have Redis)

#### 6B. Scheduled Messages
- Schedule a chat message to be sent to a user at a future time
- Use case: reminders, follow-ups, scheduled reports

#### 6C. Admin UI for Scheduler
- View scheduled jobs
- Create/edit/delete jobs
- Job execution history

---

### Phase 7 — ADVANCED FEATURES (Estimated: 2-3 sessions)

#### 7A. Conversation Classification
Port `StrayCat.classify()` — zero-shot text classification:
```typescript
const label = await classify(
  "I want to order food",
  { "food_order": ["order pizza", "get food"], "general_chat": ["hello", "how are you"] },
  0.5 // score threshold
);
```

#### 7B. HyDE (Hypothetical Document Embeddings)
Implement the `cat_recall_query` hook pattern where the LLM generates a hypothetical answer before embedding for recall (improves retrieval accuracy).

#### 7C. Multi-User Working Memory
Each user gets their own working memory context:
- Conversation history scoped per user
- Episodic memory recall scoped per user
- Active form sessions per user
- Model interaction logging per user

#### 7D. Enhanced Permission System
Port the Cheshire Cat's resource-based permissions:
- 11 resources × 5 permissions matrix
- Per-user permission assignments
- Plugin-level permission requirements
- Auth handler extensibility via plugins

#### 7E. Admin Dashboard Enhancements
- LLM/Embedder configuration UI (select provider, enter API keys, test connection)
- Memory statistics dashboard (points per collection, storage size, query latency)
- Plugin dependency graph visualization
- Hook execution trace viewer (debug mode)

---

## PART 3 — IMPLEMENTATION PRIORITY MATRIX

| Phase | Effort | Impact | Dependencies | Recommended Order |
|-------|--------|--------|-------------|-------------------|
| **Phase 1: Foundation Fixes** | Low (1-2 sessions) | Critical | None | **DO FIRST** |
| **Phase 2: Working Memory + Agent Chain** | Medium (2-3 sessions) | Very High | Phase 1 | **2nd** |
| **Phase 3: Plugin System** | High (3-4 sessions) | Very High | Phase 2 | **3rd** |
| **Phase 4: Enhanced Ingestion** | Medium (2 sessions) | Medium | Phase 1 | Can parallel with Phase 2-3 |
| **Phase 5: Procedural Memory** | Medium (2 sessions) | High | Phase 2 + 3 | **After Phase 3** |
| **Phase 6: Task Scheduler** | Low (1 session) | Medium | Phase 1 | Can do anytime |
| **Phase 7: Advanced Features** | Variable | Variable | Phases 2-5 | **Last** |

---

## PART 4 — INFRASTRUCTURE REQUIREMENTS

### Required Services (not yet deployed)

| Service | Purpose | Deployment Recommendation |
|---------|---------|--------------------------|
| **Qdrant** | Vector database for 3-tier memory | Docker container on host (like Ollama) at port 6333. Proxy via Antigravity at `http://10.0.1.1:8086/qdrant` with auth header. |

### Existing Services (already available)

| Service | Purpose | Status |
|---------|---------|--------|
| MariaDB | Relational data, form definitions, sessions, settings | Running in K8s |
| Redis | Session cache, rate limiting, working memory persistence | Running in K8s |
| Qdrant (VectorStoreService) | Document chunk storage for existing RAG | Already used by VectorStoreService |

### npm Dependencies (may need to add)

| Package | Purpose | Phase |
|---------|---------|-------|
| `node-cron` | Task scheduling | Phase 6 |
| `bull` | Job queue (alternative to node-cron, leverages Redis) | Phase 6 |
| `@qdrant/js-client-rest` | Official Qdrant client (optional, currently using raw fetch) | Phase 1 (optional) |

---

## PART 5 — WHAT THE CHESHIRE CAT HAS THAT WE DON'T NEED

Some Cheshire Cat features are irrelevant or already covered differently:

| CC Feature | Why we don't need it |
|-----------|---------------------|
| TinyDB (JSON file database) | We have MariaDB — far superior |
| Python-specific plugin loading (importlib) | We'll use TypeScript dynamic imports |
| LangChain dependency | We use direct API calls via AIProviderFactory — more flexible |
| DumbEmbedder (character-pair fallback) | We already have multiple embedding providers |
| Core auth handler (bcrypt in TinyDB) | We have JWT + bcrypt in MariaDB + Redis sessions |
| Static file serving / Jinja templates | We have a React frontend |
| Docker-compose deployment | We use K8s with MicroK8s |
