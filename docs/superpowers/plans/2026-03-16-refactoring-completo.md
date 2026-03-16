# Refactoring Completo enterprise-ai-chat

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare codice morto, dividere file troppo grandi, centralizzare pattern condivisi (error handling, middleware, response envelope), e uniformare l'architettura di backend e frontend.

**Architecture:** Il refactoring procede per fasi incrementali: prima l'infrastruttura condivisa (errori, middleware, tipi), poi lo split dei file critici backend, infine il frontend. Ogni fase produce software funzionante e testabile. Nessuna modifica alle API esterne — solo ristrutturazione interna.

**Tech Stack:** Fastify 5, TypeScript, Zustand, Zod, MariaDB (mysql2), Vitest

---

## Chunk 1: Pulizia Codice Morto + Infrastruttura Condivisa

### Task 1: Rimuovere codice morto

**Files:**
- Modify: `backend/src/services/VectorStoreService.ts:309` (rimuovere `deleteAttachmentVectors`)
- Modify: `backend/src/modules/tools/routes.ts:237` (rimuovere commento morto)

- [ ] **Step 1: Verificare che `deleteAttachmentVectors` non sia usata**

```bash
cd /home/marcello/enterprise-ai-chat
grep -rn "deleteAttachmentVectors" --include="*.ts" | grep -v "VectorStoreService.ts"
```

Expected: nessun risultato (funzione mai importata altrove).

- [ ] **Step 2: Rimuovere la funzione `deleteAttachmentVectors`**

In `backend/src/services/VectorStoreService.ts`, eliminare la funzione esportata `deleteAttachmentVectors` (circa linee 309-333).

- [ ] **Step 3: Rimuovere commento morto in tools/routes.ts**

In `backend/src/modules/tools/routes.ts:237`, rimuovere la riga commentata:
```typescript
// const publicUrl = `http://chat.yourdomain.com/api/tools/download/${filename}`; // Use configured domain
```

- [ ] **Step 4: Verificare che il build funzioni**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run build
```

Expected: BUILD SUCCESS, nessun errore.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/VectorStoreService.ts backend/src/modules/tools/routes.ts
git commit -m "chore: remove dead code (unused deleteAttachmentVectors, stale comment)"
```

---

### Task 2: Creare classi di errore centralizzate

**Files:**
- Create: `backend/src/errors/AppError.ts`
- Create: `backend/src/errors/index.ts`

- [ ] **Step 1: Scrivere il test per AppError**

Create `backend/src/errors/AppError.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, ForbiddenError, ValidationError, UnauthorizedError } from './index.js';

describe('AppError', () => {
  it('should create an error with status code and message', () => {
    const err = new AppError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad request');
    expect(err.details).toBeUndefined();
  });

  it('should include optional details', () => {
    const details = [{ field: 'email', message: 'required' }];
    const err = new AppError(400, 'Validation failed', details);
    expect(err.details).toEqual(details);
  });
});

describe('Specialized errors', () => {
  it('NotFoundError should have 404', () => {
    const err = new NotFoundError('User not found');
    expect(err.statusCode).toBe(404);
  });

  it('ForbiddenError should have 403', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('Access denied');
    expect(err.statusCode).toBe(403);
  });

  it('ValidationError should include Zod details', () => {
    const details = [{ path: ['email'], message: 'Invalid email' }];
    const err = new ValidationError(details);
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual(details);
  });

  it('UnauthorizedError should have 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Eseguire il test — deve FALLIRE**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npx vitest run src/errors/AppError.test.ts
```

Expected: FAIL — moduli non trovati.

- [ ] **Step 3: Implementare AppError**

Create `backend/src/errors/AppError.ts`:
```typescript
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Validation failed') {
    super(400, message, details);
    this.name = 'ValidationError';
  }
}
```

Create `backend/src/errors/index.ts`:
```typescript
export { AppError, NotFoundError, ForbiddenError, UnauthorizedError, ValidationError } from './AppError.js';
```

- [ ] **Step 4: Eseguire il test — deve PASSARE**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npx vitest run src/errors/AppError.test.ts
```

Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/errors/
git commit -m "feat: add centralized error classes (AppError, NotFoundError, ForbiddenError, ValidationError, UnauthorizedError)"
```

---

### Task 3: Creare middleware condivisi

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/middleware/index.ts`

- [ ] **Step 1: Scrivere il test per i middleware**

Create `backend/src/middleware/auth.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { requireAdmin, requireRole } from './auth.js';

function createMockRequest(role: string) {
  return { user: { role, id: 1, email: 'test@test.com' } } as any;
}

function createMockReply() {
  const reply: any = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

describe('requireAdmin', () => {
  it('should pass for admin users', async () => {
    const request = createMockRequest('admin');
    const reply = createMockReply();
    await requireAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should return 403 for non-admin users', async () => {
    const request = createMockRequest('user');
    const reply = createMockReply();
    await requireAdmin(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Admin access required' });
  });
});

describe('requireRole', () => {
  it('should pass for matching role', async () => {
    const middleware = requireRole('editor');
    const request = createMockRequest('editor');
    const reply = createMockReply();
    await middleware(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should pass for admin regardless of required role', async () => {
    const middleware = requireRole('editor');
    const request = createMockRequest('admin');
    const reply = createMockReply();
    await middleware(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should return 403 for non-matching role', async () => {
    const middleware = requireRole('editor');
    const request = createMockRequest('user');
    const reply = createMockReply();
    await middleware(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});
```

- [ ] **Step 2: Eseguire il test — deve FALLIRE**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npx vitest run src/middleware/auth.test.ts
```

- [ ] **Step 3: Implementare i middleware**

Create `backend/src/middleware/auth.ts`:
```typescript
import { FastifyRequest, FastifyReply } from 'fastify';

interface UserPayload {
  id: number;
  email: string;
  role: string;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user as UserPayload;
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user as UserPayload;
    if (user.role === 'admin') return; // admin bypasses all role checks
    if (!roles.includes(user.role)) {
      return reply.status(403).send({ error: `Role ${roles.join(' or ')} required` });
    }
  };
}
```

Create `backend/src/middleware/index.ts`:
```typescript
export { requireAdmin, requireRole } from './auth.js';
```

- [ ] **Step 4: Eseguire il test — deve PASSARE**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npx vitest run src/middleware/auth.test.ts
```

Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/
git commit -m "feat: add shared auth middleware (requireAdmin, requireRole) to replace 13+ duplicates"
```

---

### Task 4: Sostituire tutti i `adminOnly` duplicati con il middleware condiviso

**Files da modificare** (tutti i file con adminOnly inline):
- `backend/src/modules/admin/systemSettings.ts`
- `backend/src/modules/admin/pluginCrud.ts`
- `backend/src/modules/admin/providerCrud.ts`
- `backend/src/modules/admin/skills.ts`
- `backend/src/modules/admin/permissions.ts`
- `backend/src/modules/admin/pluginExecution.ts`
- `backend/src/modules/admin/providerSync.ts`
- `backend/src/modules/compliance/routes.ts`
- `backend/src/modules/forms/routes.ts`
- `backend/src/modules/downloads/routes.ts`
- `backend/src/modules/memory/vectorMemoryRoutes.ts`

Per ogni file:

- [ ] **Step 1: Trovare tutti i file con adminOnly locale**

```bash
cd /home/marcello/enterprise-ai-chat
grep -rn "adminOnly" backend/src/modules/ --include="*.ts" -l
```

- [ ] **Step 2: In ogni file, sostituire la definizione locale di adminOnly con l'import condiviso**

Per ogni file trovato:
1. Aggiungere in cima: `import { requireAdmin } from '../../middleware/index.js';`
   (adattare il path relativo in base alla profondità del modulo)
2. Rimuovere la funzione/const `adminOnly` locale
3. Sostituire tutte le reference `adminOnly` con `requireAdmin`

Esempio per `systemSettings.ts`:
```typescript
// PRIMA:
async function adminOnly(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { role: string };
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

// DOPO:
import { requireAdmin } from '../../middleware/index.js';
// ... rimuovere adminOnly locale, usare requireAdmin dove serve
```

- [ ] **Step 3: Verificare build**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run build
```

- [ ] **Step 4: Eseguire test esistenti**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run test
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/
git commit -m "refactor: replace 13+ duplicate adminOnly middlewares with shared requireAdmin"
```

---

### Task 5: Creare tipi condivisi backend

**Files:**
- Create: `backend/src/types/tool-context.ts`
- Create: `backend/src/types/index.ts`
- Modify: `backend/src/services/ToolService.ts` (rimuovere ToolContext locale)
- Modify: `backend/src/modules/chat/types.ts` (rimuovere ToolContext locale)
- Modify: `backend/src/services/SandboxService.ts` (rimuovere ToolContext locale)

- [ ] **Step 1: Identificare i tipi duplicati**

```bash
cd /home/marcello/enterprise-ai-chat
grep -rn "interface ToolContext" backend/src/ --include="*.ts"
grep -rn "interface ToolDefinition" backend/src/ --include="*.ts"
```

- [ ] **Step 2: Creare tipo canonico ToolContext**

Create `backend/src/types/tool-context.ts`:
```typescript
import { Pool } from 'mysql2/promise';
import { FastifyBaseLogger } from 'fastify';

export interface ToolContext {
  userName: string;
  projectName: string;
  projectId: number;
  userId: number;
  db: Pool;
  log: FastifyBaseLogger;
}
```

Create `backend/src/types/index.ts`:
```typescript
export type { ToolContext } from './tool-context.js';
```

- [ ] **Step 3: Aggiornare tutti i consumer per importare dal tipo condiviso**

In ciascun file che definisce `ToolContext` localmente:
1. Rimuovere la definizione locale
2. Aggiungere `import type { ToolContext } from '../../types/index.js';` (path relativo adattato)

- [ ] **Step 4: Verificare build**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/types/ backend/src/services/ToolService.ts backend/src/modules/chat/types.ts backend/src/services/SandboxService.ts
git commit -m "refactor: consolidate duplicate ToolContext interface into shared types"
```

---

## Chunk 2: Split File Backend Critici

### Task 6: Split MetricsService.ts (966 righe → 6 file)

**Files:**
- Create: `backend/src/services/metrics/GPUMetricsProvider.ts`
- Create: `backend/src/services/metrics/NetworkMetricsProvider.ts`
- Create: `backend/src/services/metrics/ContainerMetricsProvider.ts`
- Create: `backend/src/services/metrics/ProcessMetricsProvider.ts`
- Create: `backend/src/services/metrics/SystemMetricsProvider.ts`
- Create: `backend/src/services/metrics/index.ts`
- Modify: `backend/src/services/MetricsService.ts` → diventa orchestratore (~200 righe)

**Strategia di split:**

| Nuovo file | Contenuto originale (righe approssimative) | Metodi |
|---|---|---|
| `GPUMetricsProvider.ts` | 68-193 | `getGpuMetrics()`, `parseDcgmMetric()`, `getVllmStatus()` |
| `NetworkMetricsProvider.ts` | 312-507 | `getNetworkStatsFallback()`, `getNetworkDetailedStats()`, `getTcpUdpStats()` |
| `ContainerMetricsProvider.ts` | 508-647 | `getCloudflaredHealth()`, `getDockerContainers()` |
| `ProcessMetricsProvider.ts` | 648-773 | `getTopProcesses()`, `getActiveUsers()` |
| `SystemMetricsProvider.ts` | 194-311, 949-966 | `getIoStats()`, `getCpuCoreStats()`, `getThermalStats()`, `getDiskStatsFallback()`, `formatUptime()`, `getAge()` |
| `MetricsService.ts` (ridotto) | 774-948 | `getExhaustiveMetrics()` — orchestra i provider |

- [ ] **Step 1: Creare GPUMetricsProvider.ts**

Estrarre `getGpuMetrics()`, `parseDcgmMetric()`, `getVllmStatus()` dal MetricsService originale. Mantenere le stesse firme delle funzioni. Esportare come funzioni standalone (non classe).

- [ ] **Step 2: Creare NetworkMetricsProvider.ts**

Estrarre `getNetworkStatsFallback()`, `getNetworkDetailedStats()`, `getTcpUdpStats()`. Nota: `getNetworkStatsFallback()` usa una cache interna (`lastNetworkStats`) — mantenerla come stato del modulo.

- [ ] **Step 3: Creare ContainerMetricsProvider.ts**

Estrarre `getCloudflaredHealth()`, `getDockerContainers()`. Nota: `getCloudflaredHealth()` dipende da `queryPrometheus()` — passare come parametro o estrarre anche `queryPrometheus()` in un helper condiviso.

- [ ] **Step 4: Creare ProcessMetricsProvider.ts**

Estrarre `getTopProcesses()`, `getActiveUsers()`.

- [ ] **Step 5: Creare SystemMetricsProvider.ts**

Estrarre `getIoStats()`, `getCpuCoreStats()`, `getThermalStats()`, `getDiskStatsFallback()`, `formatUptime()`, `getAge()`, `formatBytesBackend()`.

- [ ] **Step 6: Creare index.ts che re-esporta tutto**

```typescript
export * from './GPUMetricsProvider.js';
export * from './NetworkMetricsProvider.js';
export * from './ContainerMetricsProvider.js';
export * from './ProcessMetricsProvider.js';
export * from './SystemMetricsProvider.js';
```

- [ ] **Step 7: Ridurre MetricsService.ts a orchestratore**

Il MetricsService diventa ~200 righe: importa tutti i provider e li orchestra in `getExhaustiveMetrics()`.

- [ ] **Step 8: Aggiornare gli import in tutti i consumer**

```bash
grep -rn "MetricsService" backend/src/ --include="*.ts" -l
```

Aggiornare tutti gli import. Se i consumer usano solo `getExhaustiveMetrics()`, non servono modifiche (il MetricsService resta il punto d'ingresso).

- [ ] **Step 9: Verificare build + test**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run build && npm run test
```

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/metrics/ backend/src/services/MetricsService.ts
git commit -m "refactor: split MetricsService (966 lines) into 6 focused provider modules"
```

---

### Task 7: Split context-builder.ts (807 righe → 6 file)

**Files:**
- Create: `backend/src/modules/chat/context/summary-detection.ts`
- Create: `backend/src/modules/chat/context/rag-context.ts`
- Create: `backend/src/modules/chat/context/brainstorm-context.ts`
- Create: `backend/src/modules/chat/context/attachment-processor.ts`
- Create: `backend/src/modules/chat/context/system-prompts.ts`
- Create: `backend/src/modules/chat/context/fallback-chain.ts`
- Create: `backend/src/modules/chat/context/index.ts`
- Modify: `backend/src/modules/chat/context-builder.ts` → diventa re-export o viene eliminato

**Strategia di split:**

| Nuovo file | Contenuto originale | Funzioni esportate |
|---|---|---|
| `summary-detection.ts` | 16-105 | `isSummaryQuery()`, `fetchDocumentChunksForSummary()` |
| `rag-context.ts` | 112-246 | `injectGuardrailPolicy()`, `injectRAGSystemPrompt()` |
| `brainstorm-context.ts` | 251-293 | `injectBrainstormSystemPrompt()` |
| `attachment-processor.ts` | 298-576 | `prepareToolContext()`, `loadOrCreateConversation()`, `injectFormContext()`, `processAttachments()` |
| `system-prompts.ts` | 581-778 | `injectSystemPrompts()`, `ensureItalianSystemPrompt()` |
| `fallback-chain.ts` | 783-807 | `FALLBACK_MAP`, `isRetriableError()` |

- [ ] **Step 1-6: Creare ciascun file estraendo le funzioni corrispondenti**

Per ogni file: copiare le funzioni, aggiustare gli import, esportare.

- [ ] **Step 7: Creare index.ts che re-esporta tutto**

```typescript
export * from './summary-detection.js';
export * from './rag-context.js';
export * from './brainstorm-context.js';
export * from './attachment-processor.js';
export * from './system-prompts.js';
export * from './fallback-chain.js';
```

- [ ] **Step 8: Aggiornare context-builder.ts come re-export**

```typescript
// Backward compatibility
export * from './context/index.js';
```

- [ ] **Step 9: Aggiornare tutti i consumer**

```bash
grep -rn "context-builder" backend/src/ --include="*.ts" -l
```

- [ ] **Step 10: Verificare build + test**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run build && npm run test
```

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/chat/context/ backend/src/modules/chat/context-builder.ts
git commit -m "refactor: split context-builder (807 lines) into 6 focused context modules"
```

---

### Task 8: Split DocumentProcessorService.ts (791 righe → 5 file)

**Files:**
- Create: `backend/src/services/document-processing/OCRService.ts`
- Create: `backend/src/services/document-processing/OfficeExtractionService.ts`
- Create: `backend/src/services/document-processing/DocumentGenerationService.ts`
- Create: `backend/src/services/document-processing/ConversionService.ts`
- Create: `backend/src/services/document-processing/index.ts`
- Modify: `backend/src/services/DocumentProcessorService.ts` → orchestratore (~120 righe)

**Strategia di split:**

| Nuovo file | Contenuto originale | Funzioni |
|---|---|---|
| `OCRService.ts` | 15-110 | `getOCRWorker()`, `extractWithOCR()`, `extractPdfWithOCR()`, `terminateOCRWorker()` |
| `OfficeExtractionService.ts` | 112-227 | `extractDocxContent()`, `extractExcelContent()`, `extractPptxContent()`, `extractOfficeContent()` |
| `DocumentGenerationService.ts` | 229-512 | `generateDocxBuffer()`, `generateExcelBuffer()`, `generatePptxBuffer()`, `parseSlideContent()`, `convertTextToDocx()`, `convertDataToXlsx()`, `convertSlidesToPptx()` |
| `ConversionService.ts` | 689-791 | `convertOfficeToPdf()`, `convertPdfToDocx()` |
| `DocumentProcessorService.ts` (ridotto) | 571-687 | `processDocument()` — dispatcher che usa i servizi sopra |

- [ ] **Steps 1-5: Creare i 4 nuovi file + index.ts**
- [ ] **Step 6: Ridurre DocumentProcessorService.ts a orchestratore**
- [ ] **Step 7: Aggiornare consumer**

```bash
grep -rn "DocumentProcessorService" backend/src/ --include="*.ts" -l
```

- [ ] **Step 8: Verificare build + test**
- [ ] **Step 9: Commit**

```bash
git add backend/src/services/document-processing/ backend/src/services/DocumentProcessorService.ts
git commit -m "refactor: split DocumentProcessorService (791 lines) into 5 focused service modules"
```

---

### Task 9: Split compliance/routes.ts (807 righe → 4 file)

**Files:**
- Create: `backend/src/modules/compliance/consent-routes.ts`
- Create: `backend/src/modules/compliance/data-export-routes.ts`
- Create: `backend/src/modules/compliance/account-deletion-routes.ts`
- Create: `backend/src/modules/compliance/admin-routes.ts`
- Modify: `backend/src/modules/compliance/routes.ts` → router che registra i sotto-moduli (~60 righe)

**Strategia di split:**

| Nuovo file | Contenuto originale | Route |
|---|---|---|
| `consent-routes.ts` | 66-164, 205-235, 438-456 | disclosure, consent CRUD, transparency, models |
| `data-export-routes.ts` | 238-353, 741-807 | export request, download, list, delete + generateDataExport() |
| `account-deletion-routes.ts` | 356-435 | delete-account, confirm, cancel |
| `admin-routes.ts` | 462-735 | dashboard, consent-audit, decision-log, bias-report, etc. |
| `routes.ts` (ridotto) | — | Registra i sotto-moduli come plugin Fastify |

Nota: spostare `safeParseInt()`, `getRealIp()`, gli schemi Zod in un file `compliance/utils.ts`.

- [ ] **Steps 1-4: Creare i 4 file route + utils.ts**
- [ ] **Step 5: Ridurre routes.ts a registratore**

```typescript
import fp from 'fastify-plugin';
import { consentRoutes } from './consent-routes.js';
import { dataExportRoutes } from './data-export-routes.js';
import { accountDeletionRoutes } from './account-deletion-routes.js';
import { adminRoutes } from './admin-routes.js';

export const complianceRoutes = fp(async (fastify) => {
  await fastify.register(consentRoutes);
  await fastify.register(dataExportRoutes);
  await fastify.register(accountDeletionRoutes);
  await fastify.register(adminRoutes);
});
```

- [ ] **Step 6: Verificare build + test**
- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/compliance/
git commit -m "refactor: split compliance/routes (807 lines) into 4 focused route modules"
```

---

## Chunk 3: Split Frontend Stores

### Task 10: Creare directory tipi condivisi frontend

**Files:**
- Create: `frontend/src/types/agent.ts`
- Create: `frontend/src/types/parlant.ts`
- Create: `frontend/src/types/orchestrator.ts`
- Create: `frontend/src/types/index.ts`

- [ ] **Step 1: Estrarre i tipi da useAgentStore.ts**

Da `frontend/src/hooks/useAgentStore.ts` (linee 4-122), estrarre in `frontend/src/types/agent.ts`:
- `AgentSession`, `SessionConfig`, `SessionLog`, `AgentTemplate`, `CreateSessionData`

In `frontend/src/types/orchestrator.ts`:
- `TerminalSlot`, `OrchestratorMetrics`, `WorktreeStatus`, `ConflictContent`

- [ ] **Step 2: Estrarre i tipi da useParlantStore.ts**

Da `frontend/src/hooks/useParlantStore.ts` (linee 4-56), estrarre in `frontend/src/types/parlant.ts`:
- `ParlantAgent`, `ParlantGuideline`, `ParlantSession`, `ParlantEvent`, `ParlantEvaluation`

- [ ] **Step 3: Creare index.ts che re-esporta tutto**

- [ ] **Step 4: Aggiornare useAgentStore.ts e useParlantStore.ts per importare i tipi dal nuovo path**

- [ ] **Step 5: Aggiornare tutti i consumer che importano tipi da questi store**

```bash
grep -rn "import.*from.*useAgentStore" frontend/src/ --include="*.ts" --include="*.tsx" -l
grep -rn "import.*from.*useParlantStore" frontend/src/ --include="*.ts" --include="*.tsx" -l
```

- [ ] **Step 6: Verificare build**

```bash
cd /home/marcello/enterprise-ai-chat/frontend && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/ frontend/src/hooks/useAgentStore.ts frontend/src/hooks/useParlantStore.ts
git commit -m "refactor: extract frontend shared types into types/ directory"
```

---

### Task 11: Split useAgentStore.ts (560 righe → 4 store)

**Files:**
- Create: `frontend/src/hooks/useSessionStore.ts` — sessioni + logs
- Create: `frontend/src/hooks/useTemplateStore.ts` — template agenti
- Create: `frontend/src/hooks/useOrchestratorStore.ts` — terminal slots, metriche, WebSocket
- Create: `frontend/src/hooks/useWorktreeStore.ts` — worktree status, merge, conflitti
- Modify: `frontend/src/hooks/useAgentStore.ts` — backward compat (re-export composto o eliminato)

**Strategia di split per gruppi logici:**

| Nuovo store | State | Metodi | Righe stimate |
|---|---|---|---|
| `useSessionStore` | sessions, activeSessions, selectedSession, sessionLogs | fetch/create/update/delete/start/pause/resume/cancel session, fetchSessionLogs, setSelectedSession | ~180 |
| `useTemplateStore` | templates | fetchTemplates, createTemplate, deleteTemplate | ~80 |
| `useOrchestratorStore` | terminalSlots, orchestratorMetrics, wsConnection | fetchTerminalSlots, fetchOrchestratorMetrics, fetchDashboard, connectWebSocket, disconnectWebSocket | ~160 |
| `useWorktreeStore` | worktreeStatus | fetchWorktreeStatus, mergeWorktree, resolveConflict | ~80 |

- [ ] **Step 1: Creare useSessionStore.ts**

Estrarre sessions state + metodi CRUD + lifecycle. Ogni store mantiene il proprio `isLoading` e `error`.

- [ ] **Step 2: Creare useTemplateStore.ts**

Estrarre templates state + metodi CRUD.

- [ ] **Step 3: Creare useOrchestratorStore.ts**

Estrarre orchestrator state + WebSocket management. Nota: la logica WebSocket (auto-reconnect, exponential backoff) va qui.

- [ ] **Step 4: Creare useWorktreeStore.ts**

Estrarre worktree state + operazioni git.

- [ ] **Step 5: Aggiornare useAgentStore.ts come facade (opzionale)**

Opzione A: eliminare useAgentStore e aggiornare tutti i consumer.
Opzione B: mantenere useAgentStore come facade che compone i 4 store. **Preferire Opzione A** per pulizia.

- [ ] **Step 6: Aggiornare tutti i consumer**

```bash
grep -rn "useAgentStore" frontend/src/ --include="*.ts" --include="*.tsx" -l
```

Per ogni file, sostituire `useAgentStore()` con lo store specifico necessario.

- [ ] **Step 7: Verificare build**

```bash
cd /home/marcello/enterprise-ai-chat/frontend && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/
git commit -m "refactor: split useAgentStore (560 lines) into 4 focused stores (sessions, templates, orchestrator, worktree)"
```

---

### Task 12: Split useParlantStore.ts (312 righe → 3 store)

**Files:**
- Create: `frontend/src/hooks/parlant/useParlantAgentStore.ts`
- Create: `frontend/src/hooks/parlant/useParlantGuidelinesStore.ts`
- Create: `frontend/src/hooks/parlant/useParlantSessionStore.ts`
- Create: `frontend/src/hooks/parlant/index.ts`
- Modify: `frontend/src/hooks/useParlantStore.ts` → re-export o eliminare

**Strategia:**

| Nuovo store | Contenuto |
|---|---|
| `useParlantAgentStore` | agents, currentAgent, checkHealth, fetchAgents, createAgent, deleteAgent, serviceHealth |
| `useParlantGuidelinesStore` | guidelines, fetchGuidelines, createGuideline, updateGuideline, deleteGuideline |
| `useParlantSessionStore` | sessions, currentSession, events, evaluations, fetch/create/delete sessions, fetchEvents, sendMessage, fetchEvaluations |

- [ ] **Steps 1-3: Creare i 3 store**
- [ ] **Step 4: Aggiornare consumer (ParlantPage.tsx e altri)**
- [ ] **Step 5: Verificare build**
- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/parlant/ frontend/src/hooks/useParlantStore.ts frontend/src/pages/ParlantPage.tsx
git commit -m "refactor: split useParlantStore (312 lines) into 3 focused stores (agents, guidelines, sessions)"
```

---

## Chunk 4: Verifica Finale

### Task 13: Build completo + test suite

- [ ] **Step 1: Build backend**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run build
```

- [ ] **Step 2: Test backend**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run test
```

- [ ] **Step 3: Lint backend**

```bash
cd /home/marcello/enterprise-ai-chat/backend && npm run lint
```

- [ ] **Step 4: Build frontend**

```bash
cd /home/marcello/enterprise-ai-chat/frontend && npm run build
```

- [ ] **Step 5: Lint frontend**

```bash
cd /home/marcello/enterprise-ai-chat/frontend && npm run lint
```

- [ ] **Step 6: Verificare che nessun file superi 800 righe**

```bash
find backend/src frontend/src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20
```

- [ ] **Step 7: Commit finale se servono fix**

```bash
git commit -m "fix: resolve build/lint issues from refactoring"
```
