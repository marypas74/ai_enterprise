# COMPREHENSIVE ACTION PLAN - ENTERPRISE AI CHAT FULL ROADMAP IMPLEMENTATION

> Generato il 2026-02-26 | Esecuzione autonoma senza interazione utente

## Table of Contents
1. [Block A: Qdrant Infrastructure + Embedding Model (Phase 1)](#block-a)
2. [Block B: Backend Fixes + DB Seeding (Phase 1)](#block-b)
3. [Block C: Activate RAG + HyDE (Phases 1-2)](#block-c)
4. [Block D: Retrieval Optimization (Phase 2)](#block-d)
5. [Block E: Model Performance Tuning (Phase 3)](#block-e)
6. [Block F: Agent Chain + Tool Activation (Phase 4)](#block-f)
7. [Block G: Browser Integration (Phase 5)](#block-g)
8. [Block H: MCP Client Manager (Phase 6)](#block-h)
9. [Block I: Knowledge Base UI (Phase 7)](#block-i)
10. [Block J: Monitoring + Analytics (Phase 8)](#block-j)
11. [Block K: Build + Deploy](#block-k)

---

## BLOCK A: QDRANT INFRASTRUCTURE (Phase 1.1) {#block-a}

**Dependencies**: None (first thing to do)

### A.1 Create Qdrant K8s manifests

**File to create**: `/home/marcello/enterprise-ai-chat/k8s/qdrant/statefulset.yaml`

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: qdrant-data-pvc
  namespace: enterprise-ai-chat
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi

---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: qdrant
  namespace: enterprise-ai-chat
  labels:
    app: qdrant
spec:
  serviceName: qdrant
  replicas: 1
  selector:
    matchLabels:
      app: qdrant
  template:
    metadata:
      labels:
        app: qdrant
    spec:
      containers:
        - name: qdrant
          image: qdrant/qdrant:v1.12.1
          ports:
            - containerPort: 6333
              name: rest
            - containerPort: 6334
              name: grpc
          volumeMounts:
            - name: qdrant-data
              mountPath: /qdrant/storage
          resources:
            requests:
              memory: "256Mi"
              cpu: "200m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /healthz
              port: 6333
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /healthz
              port: 6333
            initialDelaySeconds: 5
            periodSeconds: 5
      volumes:
        - name: qdrant-data
          persistentVolumeClaim:
            claimName: qdrant-data-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: qdrant
  namespace: enterprise-ai-chat
spec:
  selector:
    app: qdrant
  ports:
    - name: rest
      port: 6333
      targetPort: 6333
    - name: grpc
      port: 6334
      targetPort: 6334
  type: ClusterIP
```

### A.2 Deploy Qdrant

**Shell commands** (sequential):
```bash
# Deploy Qdrant
sudo /snap/bin/microk8s kubectl apply -f /home/marcello/enterprise-ai-chat/k8s/qdrant/statefulset.yaml

# Wait for it to be ready
sudo /snap/bin/microk8s kubectl wait --for=condition=ready pod -l app=qdrant -n enterprise-ai-chat --timeout=120s

# Verify health
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat $(sudo /snap/bin/microk8s kubectl get pod -l app=qdrant -n enterprise-ai-chat -o jsonpath='{.items[0].metadata.name}') -- curl -s http://localhost:6333/healthz
```

**Verification**: `curl` to healthz returns `{"title":"qdrant - vectorass engine","version":"1.12.1"...}` or similar OK response.

### A.3 Add Qdrant to kustomization.yaml

**File to modify**: `/home/marcello/enterprise-ai-chat/k8s/kustomization.yaml`

Add `- qdrant/statefulset.yaml` to the `resources` list after the redis entry:
```yaml
resources:
  - namespace.yaml
  - configmap.yaml
  - secrets.yaml
  - mariadb/statefulset.yaml
  - redis/statefulset.yaml
  - qdrant/statefulset.yaml       # <-- ADD THIS
  - backend/deployment.yaml
  - frontend/deployment.yaml
  - ingress.yaml
```

### A.4 Pull embedding model on Ollama

**Shell command**:
```bash
docker exec ollama ollama pull nomic-embed-text
```

**Verification**: `docker exec ollama ollama list` should show `nomic-embed-text` in the list.

---

## BLOCK B: BACKEND FIXES + DB SEEDING (Phase 1.2-1.5) {#block-b}

**Dependencies**: Block A (Qdrant running, embedding model pulled)

### B.1 Add QDRANT_URL to backend deployment

**File to modify**: `/home/marcello/enterprise-ai-chat/k8s/backend/deployment.yaml`

Add to the `env` section of the backend container (after the DOC_PROCESSOR_URL env):
```yaml
            - name: QDRANT_URL
              value: "http://qdrant:6333"
```

### B.2 Fix Ollama auth header in EmbeddingService

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/EmbeddingService.ts`

The `generateOllamaEmbedding()` function at line 250-278 currently does NOT send the `X-Ollama-Key` header. The fix is to add the auth header to the fetch call. Replace the function:

```typescript
async function generateOllamaEmbedding(
    provider: EmbeddingProvider,
    text: string
): Promise<EmbeddingResult> {
    const ollamaAuthKey = process.env.OLLAMA_AUTH_KEY;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ollamaAuthKey) {
        headers['X-Ollama-Key'] = ollamaAuthKey;
    }

    const response = await fetch(`${provider.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: provider.modelId,
            prompt: text,
        }),
    });

    if (!response.ok) {
        throw new Error(`Ollama embedding API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const embedding = data.embedding;

    if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from Ollama');
    }

    return {
        embedding,
        model: provider.modelId,
        dimensions: embedding.length,
    };
}
```

### B.3 Seed embedding model in database

**SQL statement** (connect to MariaDB from a backend pod or kubectl exec into mariadb):

```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
INSERT INTO ai_models (provider_id, model_id, display_name, description, model_type, is_enabled, supports_streaming, sort_order, context_window)
SELECT id, 'nomic-embed-text', 'Nomic Embed Text', 'Embedding model for semantic search (768d)', 'embedding', TRUE, FALSE, 1, 8192
FROM ai_providers WHERE name = 'ollama'
ON DUPLICATE KEY UPDATE is_enabled = TRUE, model_type = 'embedding';
"
```

**Verification**:
```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
SELECT m.model_id, m.model_type, m.is_enabled, p.name as provider
FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
WHERE m.model_type = 'embedding';
"
```

Should show `nomic-embed-text | embedding | 1 | ollama`.

### B.4 Ensure Ollama provider base_url is set correctly

**SQL statement**:
```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
SELECT id, 'base_url', 'http://10.0.1.1:8086/ollama', FALSE
FROM ai_providers WHERE name = 'ollama'
ON DUPLICATE KEY UPDATE setting_value = 'http://10.0.1.1:8086/ollama';
"
```

---

## BLOCK C: ACTIVATE RAG + HyDE (Phases 1.6-2.1) {#block-c}

**Dependencies**: Block B (embedding working, Qdrant accessible)

### C.1 Enable Auto-RAG for all users

**SQL statement**:
```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
-- First ensure all users have a memory_settings row
INSERT IGNORE INTO memory_settings (user_id)
SELECT id FROM users;

-- Enable auto RAG for all users
UPDATE memory_settings SET auto_rag_enabled = 1;
"
```

### C.2 Enable HyDE

**SQL statement**:
```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, is_public)
VALUES ('hyde_config', '{\"enabled\":true,\"maxTokens\":150,\"maxQueryLength\":500}', 'json', 'HyDE (Hypothetical Document Embeddings) configuration', FALSE)
ON DUPLICATE KEY UPDATE setting_value = '{\"enabled\":true,\"maxTokens\":150,\"maxQueryLength\":500}';
"
```

**Verification**: After backend restart, the HyDE service log should show `[HyDE] Registered cat_recall_query hook` and `[Startup] HyDE service initialized` (already in `index.ts` lines 524-532).

### C.3 Tune recall parameters

**SQL statement**:
```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
UPDATE memory_settings SET
  episodic_recall_k = 5,
  episodic_recall_threshold = 0.65,
  declarative_recall_k = 5,
  declarative_recall_threshold = 0.60,
  procedural_recall_k = 3,
  procedural_recall_threshold = 0.80;
"
```

---

## BLOCK D: RETRIEVAL OPTIMIZATION (Phase 2.2-2.5) {#block-d}

**Dependencies**: Block C (RAG active and working)

### D.1 Create RerankerService

**File to create**: `/home/marcello/enterprise-ai-chat/backend/src/services/RerankerService.ts`

```typescript
/**
 * Reranker Service — Post-retrieval reranking with LLM
 *
 * After Qdrant recall returns top K results by cosine similarity,
 * this service uses a lightweight LLM to rerank by actual relevance.
 * Pattern: retrieve 10 → rerank → keep top 3
 */

import type { FastifyInstance } from 'fastify';
import type mysql from 'mysql2/promise';
import { findOne } from '../database/index.js';
import type { MemoryPoint } from './VectorMemoryService.js';

export class RerankerService {
  constructor(
    private fastify: FastifyInstance,
    private db: mysql.Pool,
  ) {}

  /**
   * Rerank memory points by asking a lightweight LLM to score relevance.
   * Falls back to original order if LLM call fails.
   */
  async rerank(
    query: string,
    points: MemoryPoint[],
    topK: number = 3,
  ): Promise<MemoryPoint[]> {
    if (points.length <= topK) return points;

    try {
      // Find a lightweight Ollama model for reranking
      const model = await findOne<{ model_id: string }>(
        this.db,
        `SELECT m.model_id FROM ai_models m
         JOIN ai_providers p ON m.provider_id = p.id
         WHERE p.provider_type = 'ollama' AND m.is_enabled = TRUE
         AND m.model_type = 'chat'
         ORDER BY m.context_window ASC LIMIT 1`,
        [],
      );

      if (!model) return points.slice(0, topK);

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://10.0.1.1:8086/ollama';
      const ollamaAuthKey = process.env.OLLAMA_AUTH_KEY;

      // Build prompt with numbered passages
      const passages = points.map((p, i) =>
        `[${i + 1}] ${p.content.substring(0, 300)}`
      ).join('\n\n');

      const prompt = `Given the query: "${query}"

Rank these passages by relevance. Return ONLY a JSON array of passage numbers in order of relevance, most relevant first.

${passages}

Response (JSON array only):`;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ollamaAuthKey) headers['X-Ollama-Key'] = ollamaAuthKey;

      const resp = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.model_id,
          prompt,
          stream: false,
          options: { temperature: 0.0, num_predict: 100 },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) return points.slice(0, topK);

      const data = await resp.json() as any;
      const match = data.response?.match(/\[[\d,\s]+\]/);
      if (!match) return points.slice(0, topK);

      const ranking: number[] = JSON.parse(match[0]);
      const reranked = ranking
        .filter(i => i >= 1 && i <= points.length)
        .map(i => points[i - 1])
        .slice(0, topK);

      if (reranked.length === 0) return points.slice(0, topK);
      return reranked;
    } catch (err: any) {
      this.fastify.log.warn(`[Reranker] Reranking failed, using original order: ${err.message}`);
      return points.slice(0, topK);
    }
  }
}
```

### D.2 Integrate reranker into AgentChainService

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/AgentChainService.ts`

At the top, add import:
```typescript
import { RerankerService } from './RerankerService.js';
```

In the constructor, add:
```typescript
private reranker: RerankerService;
// in constructor body:
this.reranker = new RerankerService(fastify, db);
```

After the `recall()` call in `runMemoryRecall()` (around line 166), add reranking step before returning:
```typescript
// Rerank each collection's results
recalled.episodic = await this.reranker.rerank(recallQuery, recalled.episodic, episodicConfig?.k ?? recallSettings.episodicK);
recalled.declarative = await this.reranker.rerank(recallQuery, recalled.declarative, declarativeConfig?.k ?? recallSettings.declarativeK);
// Procedural: skip reranking (high threshold already ensures precision)
```

### D.3 Implement Hybrid Search (BM25 + Vector)

**File to create**: `/home/marcello/enterprise-ai-chat/backend/src/services/HybridSearchService.ts`

```typescript
/**
 * Hybrid Search Service — Combines MySQL FULLTEXT (BM25-like keyword search)
 * with Qdrant vector search using Reciprocal Rank Fusion (RRF).
 */

import type mysql from 'mysql2/promise';
import { findMany } from '../database/index.js';
import { recall, type MemoryPoint, type RecallOptions } from './VectorMemoryService.js';

interface HybridResult extends MemoryPoint {
  rrfScore: number;
  sources: ('keyword' | 'vector')[];
}

export class HybridSearchService {
  constructor(private db: mysql.Pool) {}

  /**
   * Perform hybrid search combining keyword (MySQL FULLTEXT) and vector (Qdrant) results.
   * Uses Reciprocal Rank Fusion to merge rankings.
   */
  async search(
    userId: number,
    query: string,
    options: Partial<RecallOptions> = {},
  ): Promise<{ episodic: HybridResult[]; declarative: HybridResult[] }> {
    const k = 60; // RRF constant

    // 1. Vector search via Qdrant
    const vectorResults = await recall(this.db, {
      userId,
      query,
      episodicK: 10,
      episodicThreshold: 0.5,
      declarativeK: 10,
      declarativeThreshold: 0.5,
      proceduralK: 0,
      proceduralThreshold: 1.0,
      ...options,
    });

    // 2. Keyword search via MySQL FULLTEXT on memory_observations
    let keywordObservations: { id: number; content: string; score: number }[] = [];
    try {
      keywordObservations = await findMany<any>(this.db,
        `SELECT id, content, MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) as score
         FROM memory_observations
         WHERE user_id = ? AND MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) > 0
         ORDER BY score DESC LIMIT 10`,
        [query, userId, query],
      );
    } catch { /* FULLTEXT not available or no results */ }

    // 3. RRF fusion for episodic
    const episodicFused = this.rrfFuse(vectorResults.episodic, [], k);

    // 4. RRF fusion for declarative (vector + keyword observations)
    const keywordAsMemoryPoints: MemoryPoint[] = keywordObservations.map((obs, i) => ({
      id: `kw_${obs.id}`,
      collection: 'declarative_memory' as const,
      content: obs.content,
      score: obs.score,
      metadata: { source: 'keyword_search', observation_id: obs.id },
    }));
    const declarativeFused = this.rrfFuse(vectorResults.declarative, keywordAsMemoryPoints, k);

    return { episodic: episodicFused, declarative: declarativeFused };
  }

  /**
   * Reciprocal Rank Fusion: merges two ranked lists into one.
   * RRF score = sum(1 / (k + rank_in_list)) for each list the document appears in.
   */
  private rrfFuse(
    vectorList: MemoryPoint[],
    keywordList: MemoryPoint[],
    k: number = 60,
  ): HybridResult[] {
    const scoreMap = new Map<string, HybridResult>();

    // Score from vector list
    vectorList.forEach((point, rank) => {
      const key = String(point.id);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.rrfScore += 1 / (k + rank + 1);
        existing.sources.push('vector');
      } else {
        scoreMap.set(key, {
          ...point,
          rrfScore: 1 / (k + rank + 1),
          sources: ['vector'],
        });
      }
    });

    // Score from keyword list
    keywordList.forEach((point, rank) => {
      const key = String(point.id);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.rrfScore += 1 / (k + rank + 1);
        existing.sources.push('keyword');
      } else {
        scoreMap.set(key, {
          ...point,
          rrfScore: 1 / (k + rank + 1),
          sources: ['keyword'],
        });
      }
    });

    // Sort by RRF score descending
    return Array.from(scoreMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  }
}
```

### D.4 Improve chunking with sentence-boundary splitting

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/ChunkingService.ts`

Currently the `chunkDocument()` function uses static 200-char overlap. The modification:
- Change `overlap` default from `200` to a computed `Math.round(chunkSize * 0.17)` (17% of chunk size)
- After identifying a split position, search backward for the nearest sentence-ending character (`.`, `!`, `?`, `\n`) within 100 chars to avoid splitting mid-sentence
- Preserve section headers by detecting lines starting with `#` or `##` and keeping them with the chunk that follows

The key modification is in the main loop of `chunkDocument()` (starting around line 60). Replace the chunk boundary detection with a sentence-aware version that:
1. Computes `dynamicOverlap = Math.round(chunkSize * 0.17)`
2. When finding the split point at position `currentPos + chunkSize`, searches backward up to 100 chars for a sentence boundary (`.`, `!`, `?`, `\n\n`)
3. If a section header (`# ` or `## `) is detected within the overlap region, includes it in the next chunk

---

## BLOCK E: MODEL PERFORMANCE TUNING (Phase 3) {#block-e}

**Dependencies**: Block B (database accessible)

### E.1 Add model family + optimal parameters columns to ai_models

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/database/index.ts`

Add a new migration entry in the `migrations` array (after the existing entries):

```typescript
{
  name: 'ai_models_family_params',
  sql: `ALTER TABLE ai_models
    ADD COLUMN IF NOT EXISTS model_family VARCHAR(50) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS optimal_temperature DECIMAL(3,2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS optimal_top_p DECIMAL(3,2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS optimal_repeat_penalty DECIMAL(3,2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS optimal_num_predict INT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS timeout_seconds INT DEFAULT 120,
    ADD COLUMN IF NOT EXISTS light_mode BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS system_prompt_override TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS fallback_model_id VARCHAR(100) DEFAULT NULL`
},
```

### E.2 Seed model families and parameters

**SQL statement** (after backend restarts and auto-migrates):
```bash
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "
-- Qwen family
UPDATE ai_models SET model_family = 'qwen', optimal_temperature = 0.7, optimal_top_p = 0.9, timeout_seconds = 120
WHERE model_id LIKE 'qwen%';

-- Gemma family
UPDATE ai_models SET model_family = 'gemma', optimal_temperature = 0.5, optimal_top_p = 0.8, timeout_seconds = 60, light_mode = TRUE
WHERE model_id LIKE 'gemma%';

-- Phi family
UPDATE ai_models SET model_family = 'phi', optimal_temperature = 0.6, optimal_top_p = 0.85, timeout_seconds = 60, light_mode = TRUE
WHERE model_id LIKE 'phi%';

-- Mixtral
UPDATE ai_models SET model_family = 'mixtral', optimal_temperature = 0.7, timeout_seconds = 300
WHERE model_id LIKE 'mixtral%';

-- Mistral
UPDATE ai_models SET model_family = 'mistral', optimal_temperature = 0.7, timeout_seconds = 120
WHERE model_id LIKE 'mistral%' AND model_id NOT LIKE 'mixtral%';

-- CodeLlama
UPDATE ai_models SET model_family = 'codellama', optimal_temperature = 0.3, timeout_seconds = 120
WHERE model_id LIKE 'codellama%';

-- LLaVA
UPDATE ai_models SET model_family = 'llava', optimal_temperature = 0.5, timeout_seconds = 120
WHERE model_id LIKE 'llava%';

-- DeepSeek
UPDATE ai_models SET model_family = 'deepseek', optimal_temperature = 0.5, timeout_seconds = 180
WHERE model_id LIKE 'deepseek%';

-- Llama
UPDATE ai_models SET model_family = 'llama', optimal_temperature = 0.7, timeout_seconds = 120
WHERE model_id LIKE 'llama%' AND model_id NOT LIKE 'codellama%';

-- GLM (no function calling)
UPDATE ai_models SET model_family = 'glm', optimal_temperature = 0.7, supports_functions = FALSE, timeout_seconds = 120
WHERE model_id LIKE 'glm%';

-- OpenAI (already good defaults)
UPDATE ai_models SET model_family = 'openai', timeout_seconds = 120
WHERE model_id LIKE 'gpt%' OR model_id LIKE 'o1%' OR model_id LIKE 'o3%';

-- Anthropic
UPDATE ai_models SET model_family = 'anthropic', timeout_seconds = 120
WHERE model_id LIKE 'claude%';

-- Google
UPDATE ai_models SET model_family = 'google', timeout_seconds = 120
WHERE model_id LIKE 'gemini%';
"
```

### E.3 Create ModelConfigService for adaptive context/params

**File to create**: `/home/marcello/enterprise-ai-chat/backend/src/services/ModelConfigService.ts`

```typescript
/**
 * Model Configuration Service — Adapts chat parameters per model
 *
 * Reads model_family, context_window, light_mode, optimal params from DB.
 * Provides adaptive context sizing, system prompt selection, and timeout.
 */

import type mysql from 'mysql2/promise';
import { findOne } from '../database/index.js';

export interface ModelConfig {
  modelId: string;
  family: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number | null;
  repeatPenalty: number | null;
  timeout: number;
  lightMode: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  systemPromptOverride: string | null;
  fallbackModelId: string | null;
  // Computed adaptive settings
  maxHistoryMessages: number;
  maxChunkContext: number;
  recallK: number;
}

export class ModelConfigService {
  constructor(private db: mysql.Pool) {}

  async getConfig(modelId: string): Promise<ModelConfig> {
    const model = await findOne<any>(this.db,
      `SELECT model_id, model_family, context_window, max_output_tokens,
              optimal_temperature, optimal_top_p, optimal_repeat_penalty, optimal_num_predict,
              timeout_seconds, light_mode, supports_functions, supports_vision,
              system_prompt_override, fallback_model_id
       FROM ai_models WHERE model_id = ?`,
      [modelId],
    );

    const contextWindow = model?.context_window || 4096;
    const lightMode = model?.light_mode || false;

    // Adaptive settings based on context window size
    let maxHistoryMessages: number;
    let maxChunkContext: number;
    let recallK: number;

    if (contextWindow < 4096) {
      // Very small models
      maxHistoryMessages = 3;
      maxChunkContext = 300;
      recallK = 2;
    } else if (contextWindow <= 8192) {
      // Small models
      maxHistoryMessages = 5;
      maxChunkContext = 500;
      recallK = 2;
    } else if (contextWindow <= 32768) {
      // Medium models
      maxHistoryMessages = 10;
      maxChunkContext = 1000;
      recallK = 3;
    } else {
      // Large context models
      maxHistoryMessages = 20;
      maxChunkContext = 2000;
      recallK = 5;
    }

    // Light mode overrides: reduce memory injection
    if (lightMode) {
      maxHistoryMessages = Math.min(maxHistoryMessages, 5);
      maxChunkContext = Math.min(maxChunkContext, 500);
      recallK = Math.min(recallK, 2);
    }

    return {
      modelId: model?.model_id || modelId,
      family: model?.model_family || null,
      contextWindow,
      maxOutputTokens: model?.max_output_tokens || 4096,
      temperature: model?.optimal_temperature ? parseFloat(model.optimal_temperature) : 0.7,
      topP: model?.optimal_top_p ? parseFloat(model.optimal_top_p) : null,
      repeatPenalty: model?.optimal_repeat_penalty ? parseFloat(model.optimal_repeat_penalty) : null,
      timeout: (model?.timeout_seconds || 120) * 1000,
      lightMode,
      supportsTools: model?.supports_functions === 1,
      supportsVision: model?.supports_vision === 1,
      systemPromptOverride: model?.system_prompt_override || null,
      fallbackModelId: model?.fallback_model_id || null,
      maxHistoryMessages,
      maxChunkContext,
      recallK,
    };
  }

  /**
   * Get model family system prompt hint
   */
  getModelFamilyHint(family: string | null): string {
    switch (family) {
      case 'qwen':
        return 'Respond in a direct, structured manner. You support tool calling.';
      case 'gemma':
        return 'Be concise. Avoid heavy markdown formatting. Keep responses brief.';
      case 'phi':
        return 'Provide clear step-by-step explanations when solving problems.';
      case 'codellama':
        return 'Focus on code. Minimize prose. Write clean, documented code.';
      case 'glm':
        return 'Respond naturally. Do not attempt function calling.';
      case 'mixtral':
        return 'Provide detailed, comprehensive responses. Multilingual support available.';
      case 'deepseek':
        return 'Focus on code and technical reasoning. Excellent for debugging.';
      default:
        return '';
    }
  }
}
```

### E.4 Integrate ModelConfigService into chat pipeline

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/modules/chat/routes.ts`

At the top, add import:
```typescript
import { ModelConfigService } from '../../services/ModelConfigService.js';
```

Inside the `/completions` handler, after determining `providerName` (around line 107), add:
```typescript
// Load adaptive model configuration
const modelConfigService = new ModelConfigService(fastify.db);
const modelConfig = await modelConfigService.getConfig(body.model);
```

Then use `modelConfig.temperature` and `modelConfig.timeout` in the `provider.streamComplete()` call (around line 605):
```typescript
const stream = provider.streamComplete({
  model: body.model,
  messages,
  maxTokens: modelConfig.maxOutputTokens,
  temperature: modelConfig.temperature,
  stream: true,
  tools: toolContext && modelConfig.supportsTools ? getToolDefinitions() : undefined
});
```

### E.5 Implement fallback chain

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/modules/chat/routes.ts`

Wrap the streaming section (starting around line 604) in a retry loop:
```typescript
let currentModel = body.model;
let retryCount = 0;
const maxRetries = 2;

while (retryCount <= maxRetries) {
  try {
    const stream = provider.streamComplete({
      model: currentModel,
      messages,
      maxTokens: modelConfig.maxOutputTokens,
      temperature: modelConfig.temperature,
      stream: true,
      tools: toolContext && modelConfig.supportsTools ? getToolDefinitions() : undefined
    });
    // ... existing streaming code ...
    break; // Success, exit retry loop
  } catch (streamError: any) {
    if (retryCount < maxRetries && modelConfig.fallbackModelId) {
      fastify.log.warn(`[Chat] Model ${currentModel} failed, falling back to ${modelConfig.fallbackModelId}`);
      currentModel = modelConfig.fallbackModelId;
      provider = AIProviderFactory.getProvider(currentModel);
      const fallbackConfig = await modelConfigService.getConfig(currentModel);
      modelConfig.temperature = fallbackConfig.temperature;
      retryCount++;

      // Notify user of fallback
      reply.raw.write(`data: ${JSON.stringify({
        content: `\n\n> *Modello ${body.model} non disponibile, utilizzando ${currentModel}*\n\n`,
        done: false
      })}\n\n`);
      continue;
    }
    // Handle final error (existing error handling code)
    // ...
  }
}
```

---

## BLOCK F: AGENT CHAIN + TOOL ACTIVATION (Phase 4) {#block-f}

**Dependencies**: Block C (RAG working), Block E (model config)

### F.1 Register built-in tools as procedural memory at boot

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/index.ts`

After the PluginLoader initialization (around line 500), add:

```typescript
// Register built-in tools as procedural memory
try {
  const { ProceduralMemoryService } = await import('./services/ProceduralMemoryService.js');
  const { getToolDefinitions } = await import('./services/ToolService.js');
  const procMemory = new ProceduralMemoryService(fastify, fastify.db);
  const tools = getToolDefinitions();
  for (const tool of tools) {
    await procMemory.registerProcedural({
      name: tool.name,
      description: tool.description,
      type: 'tool',
      triggerType: 'description',
    });
  }
  if (tools.length > 0) {
    fastify.log.info(`[ProceduralMemory] Registered ${tools.length} built-in tools`);
  }
} catch (err) {
  fastify.log.warn('Could not register procedural memory: ' + String(err));
}
```

### F.2 Conversational Form auto-trigger from chat

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/ConversationalFormService.ts`

Add a new method `detectFormTrigger()` that:
1. Loads all active forms with `start_examples` from DB
2. Uses `ClassificationService` to compare user message against each form's start_examples
3. If similarity above threshold (0.75), auto-starts a form session

Then in `/home/marcello/enterprise-ai-chat/backend/src/modules/chat/routes.ts`, in the form checking section (around line 243), before the existing `getActiveSession()` call, add a check for new form triggers if no active session exists:

```typescript
// If no active form session, check if user message triggers a new form
if (!activeFormSession || activeFormSession.state === 'closed') {
  try {
    const triggered = await formService.detectFormTrigger(user.id, body.message);
    if (triggered) {
      activeFormSession = await formService.startSession(user.id, conversationId!, triggered.formId);
      fastify.log.info(`[Form] Auto-triggered form ${triggered.formId} from message`);
    }
  } catch (triggerErr: any) {
    fastify.log.warn(`[Form] Trigger detection failed: ${triggerErr.message}`);
  }
}
```

### F.3 Complete White Rabbit scheduler with DB persistence

The `WhiteRabbitService` at `/home/marcello/enterprise-ai-chat/backend/src/services/WhiteRabbitService.ts` is already fully implemented with DB persistence (it uses `scheduled_jobs` and `job_executions` tables, which are auto-migrated). The scheduler is already started in the scheduler routes (`/home/marcello/enterprise-ai-chat/backend/src/modules/scheduler/routes.ts` line 14-18).

**No code changes needed** -- this is already working once the backend is running and DB tables are auto-created.

### F.4 Complete Ralph Loop with UI integration

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/RalphLoopService.ts`

The service exists and is functional. What's needed is better completion detection. Add after the existing `detectCompletion` logic a more robust check:

```typescript
private detectCompletion(output: string, promise: string | null): boolean {
  // Check for explicit completion promise text
  if (promise && output.toLowerCase().includes(promise.toLowerCase())) {
    return true;
  }

  // Check for common completion signals
  const completionSignals = [
    /\b(task complete|complet[oe]d?|done|finito|terminato|concluso)\b/i,
    /\bno (?:more|further) (?:changes|work|tasks)\b/i,
    /\beverything (?:is|looks) (?:good|ready|done)\b/i,
  ];

  return completionSignals.some(pattern => pattern.test(output));
}
```

---

## BLOCK G: BROWSER INTEGRATION (Phase 5) {#block-g}

**Dependencies**: Block B (backend working), Block A (K8s accessible)

### G.1 Deploy Browserless in Kubernetes

**File to create**: `/home/marcello/enterprise-ai-chat/k8s/browserless/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: browserless
  namespace: enterprise-ai-chat
  labels:
    app: browserless
spec:
  replicas: 1
  selector:
    matchLabels:
      app: browserless
  template:
    metadata:
      labels:
        app: browserless
    spec:
      containers:
        - name: browserless
          image: browserless/chromium:latest
          ports:
            - containerPort: 3000
              name: http
          env:
            - name: MAX_CONCURRENT_SESSIONS
              value: "5"
            - name: CONNECTION_TIMEOUT
              value: "30000"
            - name: MAX_QUEUE_LENGTH
              value: "10"
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10

---
apiVersion: v1
kind: Service
metadata:
  name: browserless
  namespace: enterprise-ai-chat
spec:
  selector:
    app: browserless
  ports:
    - port: 3100
      targetPort: 3000
  type: ClusterIP
```

**Shell commands**:
```bash
sudo /snap/bin/microk8s kubectl apply -f /home/marcello/enterprise-ai-chat/k8s/browserless/deployment.yaml
```

### G.2 Create BrowserService

**File to create**: `/home/marcello/enterprise-ai-chat/backend/src/services/BrowserService.ts`

```typescript
/**
 * Browser Service — Headless Chrome integration via Browserless
 * Provides web navigation, screenshot, content extraction, and form filling.
 */

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'http://browserless:3100';

interface PageContent {
  title: string;
  url: string;
  text: string;
  html?: string;
}

// SSRF protection
const BLOCKED_PATTERNS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^127\./,
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
];

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return !BLOCKED_PATTERNS.some(p => p.test(parsed.hostname));
  } catch {
    return false;
  }
}

export class BrowserService {
  async navigateTo(url: string): Promise<PageContent> {
    if (!isUrlAllowed(url)) throw new Error('URL not allowed (private/internal network)');

    const resp = await fetch(`${BROWSERLESS_URL}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        waitFor: 2000,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!resp.ok) throw new Error(`Browser navigation failed: ${resp.status}`);

    const html = await resp.text();
    // Strip HTML tags for text content
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000);

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);

    return {
      title: titleMatch?.[1] || url,
      url,
      text,
      html: html.substring(0, 100000),
    };
  }

  async takeScreenshot(url: string): Promise<Buffer> {
    if (!isUrlAllowed(url)) throw new Error('URL not allowed');

    const resp = await fetch(`${BROWSERLESS_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: { type: 'png', fullPage: false },
        gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!resp.ok) throw new Error(`Screenshot failed: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    return Buffer.from(buffer);
  }

  async extractContent(url: string, selector?: string): Promise<string> {
    const page = await this.navigateTo(url);
    if (!selector) return page.text;

    // If a selector is provided, use the function endpoint
    const resp = await fetch(`${BROWSERLESS_URL}/function`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `module.exports = async ({ page }) => {
          await page.goto('${url}', { waitUntil: 'networkidle2', timeout: 30000 });
          const elements = await page.$$eval('${selector}', els => els.map(e => e.textContent));
          return elements.join('\\n');
        }`,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!resp.ok) throw new Error(`Content extraction failed: ${resp.status}`);
    return await resp.text();
  }
}
```

### G.3 Register browser tools in ToolService

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/ToolService.ts`

Add new tool definitions to the `getToolDefinitions()` array:

```typescript
{
  name: 'browse_url',
  description: 'Navigate to a URL and extract the text content of the web page. Returns the page title and text content.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to navigate to' },
      selector: { type: 'string', description: 'Optional CSS selector to extract specific content' },
    },
    required: ['url'],
  },
},
{
  name: 'take_screenshot',
  description: 'Take a screenshot of a web page. Returns a PNG image.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to screenshot' },
    },
    required: ['url'],
  },
},
{
  name: 'extract_table',
  description: 'Extract HTML tables from a web page as structured text.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL containing the table' },
      tableIndex: { type: 'number', description: 'Index of the table to extract (0-based, default 0)' },
    },
    required: ['url'],
  },
},
```

And add handlers in the `executeTool()` function:

```typescript
case 'browse_url': {
  const { BrowserService } = await import('./BrowserService.js');
  const browser = new BrowserService();
  const page = await browser.navigateTo(args.url);
  return { success: true, output: { title: page.title, content: page.text.substring(0, 10000) } };
}
case 'take_screenshot': {
  const { BrowserService } = await import('./BrowserService.js');
  const browser = new BrowserService();
  const screenshot = await browser.takeScreenshot(args.url);
  // Save screenshot and return download link
  const fs = await import('fs');
  const path = await import('path');
  const filename = `screenshot_${Date.now()}.png`;
  const dir = path.default.join(process.env.STORAGE_ROOT || process.cwd(), 'generated');
  if (!fs.default.existsSync(dir)) fs.default.mkdirSync(dir, { recursive: true });
  fs.default.writeFileSync(path.default.join(dir, filename), screenshot);
  return { success: true, output: { path: filename, downloadUrl: `/api/tools/download/${filename}` } };
}
case 'extract_table': {
  const { BrowserService } = await import('./BrowserService.js');
  const browser = new BrowserService();
  const content = await browser.extractContent(args.url, 'table');
  return { success: true, output: { content } };
}
```

### G.4 Add BROWSERLESS_URL env to backend deployment

**File to modify**: `/home/marcello/enterprise-ai-chat/k8s/backend/deployment.yaml`

Add to env section:
```yaml
            - name: BROWSERLESS_URL
              value: "http://browserless:3100"
```

---

## BLOCK H: MCP CLIENT MANAGER (Phase 6) {#block-h}

**Dependencies**: Block B (backend working)

### H.1 Create MCPClientManager service

**File to create**: `/home/marcello/enterprise-ai-chat/backend/src/services/MCPClientManager.ts`

```typescript
/**
 * MCP Client Manager — Manages connections to MCP (Model Context Protocol) servers
 *
 * Supports stdio, SSE, and WebSocket transports.
 * Discovers tools and resources from connected servers.
 * Executes tool calls and reads resources.
 */

import { spawn, type ChildProcess } from 'child_process';
import { findOne, findMany } from '../database/index.js';
import type mysql from 'mysql2/promise';

interface MCPConnection {
  serverId: number;
  serverName: string;
  transport: 'stdio' | 'sse' | 'websocket';
  process?: ChildProcess;
  tools: MCPTool[];
  resources: MCPResource[];
  healthy: boolean;
  requestId: number;
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverId: number;
  serverName: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: number;
}

export class MCPClientManager {
  private connections = new Map<number, MCPConnection>();

  constructor(private db: mysql.Pool) {}

  async connectServer(serverId: number): Promise<void> {
    if (this.connections.has(serverId)) return;

    const server = await findOne<any>(this.db,
      'SELECT * FROM mcp_servers WHERE id = ? AND is_enabled = TRUE', [serverId]);
    if (!server) throw new Error(`MCP server ${serverId} not found or disabled`);

    const conn: MCPConnection = {
      serverId,
      serverName: server.name,
      transport: server.transport_type,
      tools: [],
      resources: [],
      healthy: false,
      requestId: 0,
      pendingRequests: new Map(),
    };

    if (server.transport_type === 'stdio' && server.command) {
      await this.connectStdio(conn, server.command, JSON.parse(server.env_vars || '{}'));
    } else if (server.transport_type === 'sse' && server.url) {
      await this.connectSSE(conn, server.url);
    }

    this.connections.set(serverId, conn);
  }

  private async connectStdio(conn: MCPConnection, command: string, envVars: Record<string, string>): Promise<void> {
    const parts = command.split(' ');
    const proc = spawn(parts[0], parts.slice(1), {
      env: { ...process.env, ...envVars },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    conn.process = proc;

    // JSON-RPC over stdio
    let buffer = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      // Parse JSON-RPC messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this.handleMessage(conn, msg);
        } catch { /* skip non-JSON lines */ }
      }
    });

    proc.on('exit', () => { conn.healthy = false; });

    // Send initialize
    await this.sendRequest(conn, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'enterprise-ai-chat', version: '1.6.1' },
    });

    conn.healthy = true;

    // Discover tools
    try {
      const toolsResult = await this.sendRequest(conn, 'tools/list', {});
      conn.tools = (toolsResult?.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {},
        serverId: conn.serverId,
        serverName: conn.serverName,
      }));
    } catch { /* Server may not support tools */ }

    // Discover resources
    try {
      const resourcesResult = await this.sendRequest(conn, 'resources/list', {});
      conn.resources = (resourcesResult?.resources || []).map((r: any) => ({
        uri: r.uri,
        name: r.name || r.uri,
        description: r.description,
        mimeType: r.mimeType,
        serverId: conn.serverId,
      }));
    } catch { /* Server may not support resources */ }
  }

  private async connectSSE(_conn: MCPConnection, _url: string): Promise<void> {
    // SSE transport implementation — connect to remote server
    // Uses EventSource to receive server-sent events
    // Sends requests via POST to the server URL
    // (Implementation skeleton — full SSE protocol handling)
  }

  private sendRequest(conn: MCPConnection, method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++conn.requestId;
      const timeout = setTimeout(() => {
        conn.pendingRequests.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 30000);

      conn.pendingRequests.set(id, { resolve, reject, timeout });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      if (conn.process?.stdin) {
        conn.process.stdin.write(msg);
      }
    });
  }

  private handleMessage(conn: MCPConnection, msg: any): void {
    if (msg.id && conn.pendingRequests.has(msg.id)) {
      const pending = conn.pendingRequests.get(msg.id)!;
      clearTimeout(pending.timeout);
      conn.pendingRequests.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || 'MCP error'));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  async disconnectServer(serverId: number): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    conn.process?.kill();
    conn.pendingRequests.forEach(p => {
      clearTimeout(p.timeout);
      p.reject(new Error('Disconnected'));
    });
    this.connections.delete(serverId);
  }

  async disconnectAll(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnectServer(id);
    }
  }

  async listTools(serverId?: number): Promise<MCPTool[]> {
    if (serverId) {
      return this.connections.get(serverId)?.tools || [];
    }
    const allTools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      allTools.push(...conn.tools);
    }
    return allTools;
  }

  async callTool(serverId: number, toolName: string, args: any): Promise<any> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`MCP server ${serverId} not connected`);
    return this.sendRequest(conn, 'tools/call', { name: toolName, arguments: args });
  }

  async readResource(serverId: number, uri: string): Promise<any> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`MCP server ${serverId} not connected`);
    return this.sendRequest(conn, 'resources/read', { uri });
  }

  async healthCheck(serverId: number): Promise<boolean> {
    return this.connections.get(serverId)?.healthy ?? false;
  }
}
```

### H.2 Integrate MCP tools into chat pipeline

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/modules/chat/routes.ts`

In the tool execution section (around line 644), after executing built-in tools, add MCP tool execution:

```typescript
// Check if the tool is an MCP tool
if (!result.success && tc.name.includes(':')) {
  // MCP tool format: "servername:toolname"
  const [serverName, mcpToolName] = tc.name.split(':', 2);
  try {
    const { MCPClientManager } = await import('../../services/MCPClientManager.js');
    const mcpManager = new MCPClientManager(fastify.db);
    // Look up server ID by name
    const server = await findOne<any>(fastify.db,
      'SELECT id FROM mcp_servers WHERE name = ?', [serverName]);
    if (server) {
      await mcpManager.connectServer(server.id);
      const mcpResult = await mcpManager.callTool(server.id, mcpToolName, args);
      result = { success: true, output: mcpResult };
    }
  } catch (mcpErr: any) {
    fastify.log.warn(`[MCP] Tool call failed: ${mcpErr.message}`);
  }
}
```

---

## BLOCK I: KNOWLEDGE BASE UI (Phase 7) {#block-i}

**Dependencies**: Block C (RAG working), Block D (chunking improved)

### I.1 Create Knowledge Base upload page

**File to create**: `/home/marcello/enterprise-ai-chat/frontend/src/pages/admin/KnowledgeBasePage.tsx`

This is a new React component that provides:
1. File upload dropzone (PDF, DOCX, TXT, MD, XLSX)
2. URL ingestion form (leverages existing `/api/ingestion/url` endpoint)
3. Text paste ingestion (leverages existing `/api/ingestion/text` endpoint)
4. Progress bar showing ingestion status via polling
5. List of ingested documents with chunk counts
6. Collection management (view/wipe/export) using existing `/api/memory/vector/collections` endpoints

The page reuses the existing API endpoints:
- `POST /api/ingestion/url` -- already implemented in `ingestionRoutes`
- `POST /api/ingestion/text` -- already implemented in `ingestionRoutes`
- `GET /api/memory/vector/collections` -- already implemented
- `DELETE /api/memory/vector/collections/:name` -- already implemented
- `GET /api/memory/vector/recall` -- already implemented (for testing)

### I.2 Add file upload ingestion endpoint

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/modules/ingestion/routes.ts`

Add a new multipart file upload route:
```typescript
// Ingest an uploaded file
fastify.post('/file', {
  onRequest: [(fastify as any).authenticate],
}, async (request: FastifyRequest, reply: FastifyReply) => {
  const user = request.user as { id: number };
  const data = await request.file();
  if (!data) return reply.status(400).send({ error: 'No file uploaded' });

  const buffer = await data.toBuffer();
  const filename = data.filename;
  const mimeType = data.mimetype;

  // Parse file content based on type
  let content = '';
  let title = filename;

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    content = buffer.toString('utf-8');
  } else if (mimeType === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    content = parsed.text;
    title = parsed.info?.Title || filename;
  } else if (mimeType.includes('word') || mimeType.includes('docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    content = result.value;
  } else {
    return reply.status(400).send({ error: 'Unsupported file type. Supported: PDF, DOCX, TXT, MD' });
  }

  if (content.length < 30) {
    return reply.status(400).send({ error: 'File content too short' });
  }

  const rabbitHole = new RabbitHoleService(fastify, fastify.db);
  const result = await rabbitHole.ingest(content, title, {
    userId: user.id,
    source: filename,
    sourceType: 'file',
    contentType: mimeType,
    metadata: { filename, mime_type: mimeType },
  });

  return result;
});
```

### I.3 Register Knowledge Base page in admin router

**File to modify**: `/home/marcello/enterprise-ai-chat/frontend/src/pages/AdminPage.tsx`

1. Add import: `import KnowledgeBasePage from './admin/KnowledgeBasePage';`
2. Add to `NAV_ITEMS` array: `{ path: '/admin/knowledge-base', icon: BookMarked, label: 'Knowledge Base' }`
3. Add route: `<Route path="knowledge-base" element={<KnowledgeBasePage />} />`

### I.4 Implement semantic deduplication

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/VectorMemoryService.ts`

Before inserting a new point in `storeDeclarative()` and `storeEpisodic()`, check for near-duplicates:

```typescript
// Check for near-duplicate before storing
async function checkDuplicate(
  collection: MemoryCollection,
  embedding: number[],
  threshold: number = 0.95,
): Promise<boolean> {
  try {
    const resp = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: embedding,
        limit: 1,
        score_threshold: threshold,
        with_payload: false,
      }),
    });
    if (!resp.ok) return false;
    const data = await resp.json() as any;
    return (data.result || []).length > 0;
  } catch {
    return false;
  }
}
```

Call this function in both `storeEpisodic()` and `storeDeclarative()` before the insert, and skip insertion if a duplicate is found.

### I.5 Implement memory decay

**File to create**: `/home/marcello/enterprise-ai-chat/backend/src/services/MemoryDecayService.ts`

```typescript
/**
 * Memory Decay Service — Gradually reduce importance of old episodic memories
 *
 * Runs periodically (via WhiteRabbit or at boot) to:
 * 1. Apply exponential decay to episodic memory importance scores
 * 2. Delete memories below a minimum threshold
 */

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

export class MemoryDecayService {
  /**
   * Apply decay to all episodic memories older than `daysThreshold` days.
   * Decay factor: importance *= 0.95 per day past threshold.
   * Delete if importance < minImportance.
   */
  async applyDecay(
    daysThreshold: number = 30,
    minImportance: number = 0.1,
  ): Promise<{ decayed: number; deleted: number }> {
    let decayed = 0;
    let deleted = 0;

    try {
      // Scroll through all episodic memories
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

      const resp = await fetch(`${QDRANT_URL}/collections/episodic_memory/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 1000,
          with_payload: true,
          filter: {
            must: [{
              key: 'when',
              range: { lt: cutoffDate.toISOString() },
            }],
          },
        }),
      });

      if (!resp.ok) return { decayed, deleted };
      const data = await resp.json() as any;
      const points = data.result?.points || [];

      const toDelete: number[] = [];

      for (const point of points) {
        const when = new Date(point.payload?.when || 0);
        const daysOld = (Date.now() - when.getTime()) / (1000 * 60 * 60 * 24);
        const decayDays = daysOld - daysThreshold;
        const decayFactor = Math.pow(0.95, decayDays);

        if (decayFactor < minImportance) {
          toDelete.push(point.id);
          deleted++;
        } else {
          decayed++;
        }
      }

      // Delete old memories below threshold
      if (toDelete.length > 0) {
        await fetch(`${QDRANT_URL}/collections/episodic_memory/points/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: toDelete }),
        });
      }
    } catch (err: any) {
      console.error(`[MemoryDecay] Error: ${err.message}`);
    }

    return { decayed, deleted };
  }
}
```

---

## BLOCK J: MONITORING + ANALYTICS (Phase 8) {#block-j}

**Dependencies**: Block C (RAG active)

### J.1 Add vector memory stats to metrics

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/MetricsService.ts`

Add a method that queries Qdrant collection stats and returns them as metrics data:

```typescript
import { getAllCollectionsInfo } from './VectorMemoryService.js';

async function getVectorMemoryMetrics(): Promise<{
  collections: { name: string; points_count: number; status: string }[];
  totalVectors: number;
}> {
  const collections = await getAllCollectionsInfo();
  const totalVectors = collections.reduce((sum, c) => sum + c.points_count, 0);
  return { collections, totalVectors };
}
```

### J.2 Create recall quality tracking table

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/database/index.ts`

Add migration:
```typescript
{
  name: 'recall_log',
  sql: `CREATE TABLE IF NOT EXISTS recall_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    query TEXT NOT NULL,
    episodic_count INT UNSIGNED DEFAULT 0,
    declarative_count INT UNSIGNED DEFAULT 0,
    procedural_count INT UNSIGNED DEFAULT 0,
    avg_score DECIMAL(5,4) DEFAULT 0,
    hyde_used BOOLEAN DEFAULT FALSE,
    recall_time_ms INT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
},
```

### J.3 Add recall logging to AgentChainService

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/services/AgentChainService.ts`

After the `recall()` call in `runMemoryRecall()`, log the recall:

```typescript
// Log recall for analytics
try {
  const allResults = [...recalled.episodic, ...recalled.declarative, ...recalled.procedural];
  const avgScore = allResults.length > 0
    ? allResults.reduce((sum, r) => sum + r.score, 0) / allResults.length
    : 0;

  await insertOne(this.db,
    `INSERT INTO recall_log (user_id, query, episodic_count, declarative_count, procedural_count, avg_score, recall_time_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, userMessage.substring(0, 500), recalled.episodic.length, recalled.declarative.length, recalled.procedural.length, avgScore, Date.now() - startTime],
  );
} catch { /* non-critical */ }
```

### J.4 Token usage per component tracking

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/modules/chat/routes.ts`

After the streaming completes, calculate token usage breakdown:

```typescript
// Track token usage by component
const breakdown = {
  system_prompt: messages.filter(m => m.role === 'system').reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
  context: 0, // memory injection
  hyde: 0,     // HyDE hypothetical tokens
  user_message: Math.ceil(body.message.length / 4),
  response: tokensOutput,
};

// Store breakdown (fire and forget)
fastify.db.execute(
  `INSERT INTO token_usage (user_id, conversation_id, provider, model, tokens_input, tokens_output, cost_usd)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [user.id, conversationId, providerName, body.model, tokensInput, tokensOutput, cost]
).catch(() => {});
```

### J.5 Add Memory Stats to admin dashboard

**File to modify**: `/home/marcello/enterprise-ai-chat/frontend/src/pages/admin/MemoryStatsPage.tsx`

The page already exists. Enhance it by adding sections for:
1. Vector collection counts (fetched from `/api/memory/vector/collections`)
2. Recall quality chart (fetch from a new endpoint `/api/admin/recall-stats`)
3. Average similarity scores per collection over time

### J.6 Create recall stats API endpoint

**File to modify**: `/home/marcello/enterprise-ai-chat/backend/src/modules/admin/settings.ts` (or create a new analytics route)

Add an endpoint that queries `recall_log` aggregations:

```typescript
fastify.get('/recall-stats', {
  onRequest: [(fastify as any).authenticate],
}, async (request: FastifyRequest) => {
  const user = request.user as { role: string };
  if (user.role !== 'admin') return { error: 'Admin only' };

  const stats = await findMany<any>(fastify.db,
    `SELECT
       DATE(created_at) as date,
       COUNT(*) as total_recalls,
       AVG(avg_score) as avg_similarity,
       AVG(episodic_count + declarative_count + procedural_count) as avg_results,
       AVG(recall_time_ms) as avg_time_ms,
       SUM(CASE WHEN hyde_used THEN 1 ELSE 0 END) as hyde_count
     FROM recall_log
     WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    []
  );

  return { stats };
});
```

---

## BLOCK K: BUILD + DEPLOY {#block-k}

**Dependencies**: ALL previous blocks

### K.1 Version Bump (if releasing as new version)

If bumping from 1.6.1 to 1.7.0, update ALL 12 files per the MEMORY.md checklist:

1. `/home/marcello/enterprise-ai-chat/backend/package.json` -- `"version": "1.7.0"`
2. `/home/marcello/enterprise-ai-chat/frontend/package.json` -- `"version": "1.7.0"`
3. `/home/marcello/enterprise-ai-chat/frontend/src/version.ts` -- `export const APP_VERSION = '1.7.0'`
4. `/home/marcello/enterprise-ai-chat/frontend/src/pages/PublicMonitorPage.tsx` -- version string
5. `/home/marcello/enterprise-ai-chat/vscode-extension/package.json` -- `"version": "1.7.0"`
6. `/home/marcello/enterprise-ai-chat/vscode-extension/src/extension.ts` -- `extensionVersion = '1.7.0'`
7. `/home/marcello/enterprise-ai-chat/vscode-extension/webview-ui/src/claude-code/MainLayout.tsx` -- TWO occurrences
8. `/home/marcello/enterprise-ai-chat/k8s/backend/deployment.yaml` -- image tag
9. `/home/marcello/enterprise-ai-chat/k8s/frontend/deployment.yaml` -- image tag
10. `/home/marcello/enterprise-ai-chat/k8s/kustomization.yaml` -- version annotation
11. `/home/marcello/enterprise-ai-chat/k8s/mariadb/init-configmap.yaml` -- `app_version` seed
12. `/home/marcello/enterprise-ai-chat/backend-deploy.yaml` -- image tag

Then verify: `grep -rn "1.6.1" . --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.html" | grep -v node_modules | grep -v dist | grep -v package-lock`

### K.2 Build + Deploy

```bash
cd /home/marcello/enterprise-ai-chat

# Full build (Docker images + K8s deploy)
echo "marcello-37-QS" | sudo -S bash BUILD.sh

# Or manual step-by-step:
# 1. Build backend
cd backend && npm install --legacy-peer-deps && npm run build && cd ..
# 2. Build frontend
cd frontend && npm install --legacy-peer-deps && npm run build && cd ..
# 3. Docker build
sudo docker build -t localhost:32000/enterprise-ai-chat-backend:1.7.0 ./backend
sudo docker build -t localhost:32000/enterprise-ai-chat-frontend:1.7.0 ./frontend
# 4. Push to MicroK8s registry
sudo docker push localhost:32000/enterprise-ai-chat-backend:1.7.0
sudo docker push localhost:32000/enterprise-ai-chat-frontend:1.7.0
# 5. Rollout (scale down first, then up)
sudo /snap/bin/microk8s kubectl scale deployment backend --replicas=0 -n enterprise-ai-chat
sudo /snap/bin/microk8s kubectl scale deployment frontend --replicas=0 -n enterprise-ai-chat
sleep 5
sudo /snap/bin/microk8s kubectl apply -f k8s/qdrant/statefulset.yaml
sudo /snap/bin/microk8s kubectl apply -f k8s/browserless/deployment.yaml
sudo /snap/bin/microk8s kubectl apply -f k8s/backend/deployment.yaml
sudo /snap/bin/microk8s kubectl apply -f k8s/frontend/deployment.yaml
sudo /snap/bin/microk8s kubectl scale deployment backend --replicas=2 -n enterprise-ai-chat
sudo /snap/bin/microk8s kubectl scale deployment frontend --replicas=2 -n enterprise-ai-chat
```

### K.3 Post-deploy verification

```bash
# 1. Check all pods running
sudo /snap/bin/microk8s kubectl get pods -n enterprise-ai-chat

# 2. Verify Qdrant is healthy
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat $(sudo /snap/bin/microk8s kubectl get pod -l app=qdrant -n enterprise-ai-chat -o jsonpath='{.items[0].metadata.name}') -- curl -s http://localhost:6333/healthz

# 3. Verify embedding works (from a backend pod)
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat deployment/backend -- curl -s 'http://10.0.1.1:8086/ollama/api/embeddings' -H 'X-Ollama-Key: mTLS-k8s-backend-2026' -d '{"model":"nomic-embed-text","prompt":"test"}'

# 4. Verify Auto-RAG is enabled
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat statefulset/mariadb -- mysql -u enterprise_ai -p'change-me-in-production' enterprise_ai_chat -e "SELECT user_id, auto_rag_enabled FROM memory_settings;"

# 5. Check backend logs for HyDE initialization
sudo /snap/bin/microk8s kubectl logs deployment/backend -n enterprise-ai-chat | grep -i "hyde\|qdrant\|embedding\|procedural"

# 6. Test recall endpoint
# (from browser or curl with valid JWT token)
curl -H "Authorization: Bearer <token>" "https://plane.lushlolli.com/api/memory/vector/recall?text=test+query"

# 7. Test chat with RAG (via frontend)
# Send a message and check backend logs for "[AgentChain] Injected X memory results"
```

---

## EXECUTION ORDER SUMMARY

```
WEEK 1 (Critical Infrastructure):
  Block A  → Qdrant deploy + Ollama embedding model pull
  Block B  → Backend fixes (auth header, DB seeding, env vars)
  Block C  → Activate RAG + HyDE + tune recall params
  ⮕ CHECKPOINT: Verify vector memory works end-to-end

WEEK 2 (Retrieval + Performance):
  Block D  → Reranker, Hybrid Search, Chunking improvements
  Block E  → Model family params, adaptive context, fallback chain
  ⮕ CHECKPOINT: Test chat quality improvement with RAG

WEEK 3 (Agent Activation):
  Block F  → Procedural memory registration, form triggers, Ralph Loop
  ⮕ CHECKPOINT: Tools discovered semantically, forms auto-triggered

WEEK 4 (Browser + MCP):
  Block G  → Browserless deploy, BrowserService, browser tools
  Block H  → MCPClientManager, MCP integration in chat
  ⮕ CHECKPOINT: browse_url and MCP tools working in chat

WEEK 5 (Knowledge + Monitoring + Ship):
  Block I  → Knowledge Base UI, file upload, dedup, decay
  Block J  → Recall logging, token breakdown, admin dashboards
  Block K  → Version bump, build, deploy, verify
  ⮕ FINAL CHECKPOINT: Full integration test
```

---

## FILES SUMMARY

### New files to create (14):
| File | Purpose |
|---|---|
| `k8s/qdrant/statefulset.yaml` | Qdrant StatefulSet + Service + PVC |
| `k8s/browserless/deployment.yaml` | Browserless Deployment + Service |
| `backend/src/services/RerankerService.ts` | LLM-based post-retrieval reranking |
| `backend/src/services/HybridSearchService.ts` | BM25+Vector fusion with RRF |
| `backend/src/services/ModelConfigService.ts` | Adaptive model params/context |
| `backend/src/services/BrowserService.ts` | Headless Chrome integration |
| `backend/src/services/MCPClientManager.ts` | MCP protocol client manager |
| `backend/src/services/MemoryDecayService.ts` | Episodic memory decay/cleanup |
| `frontend/src/pages/admin/KnowledgeBasePage.tsx` | Knowledge base upload UI |

### Existing files to modify (14):
| File | Changes |
|---|---|
| `k8s/kustomization.yaml` | Add qdrant resource |
| `k8s/backend/deployment.yaml` | Add QDRANT_URL, BROWSERLESS_URL envs |
| `backend/src/services/EmbeddingService.ts` | Add X-Ollama-Key auth header |
| `backend/src/services/AgentChainService.ts` | Add reranker, recall logging |
| `backend/src/services/ChunkingService.ts` | Sentence-boundary chunking |
| `backend/src/services/VectorMemoryService.ts` | Deduplication check |
| `backend/src/services/ToolService.ts` | Browser tool definitions + handlers |
| `backend/src/services/ConversationalFormService.ts` | Auto-trigger detection |
| `backend/src/services/RalphLoopService.ts` | Completion detection improvement |
| `backend/src/modules/chat/routes.ts` | ModelConfig, fallback chain, MCP tools |
| `backend/src/modules/ingestion/routes.ts` | File upload route |
| `backend/src/database/index.ts` | ai_models columns + recall_log migrations |
| `backend/src/index.ts` | Procedural memory boot registration |
| `frontend/src/pages/AdminPage.tsx` | Knowledge Base nav + route |

### SQL statements (6):
1. Seed nomic-embed-text model in ai_models
2. Ensure Ollama provider base_url is correct
3. Enable auto_rag for all users
4. Enable HyDE in system_settings
5. Tune recall parameters in memory_settings
6. Seed model family/params in ai_models

---

### Critical Files for Implementation
- `/home/marcello/enterprise-ai-chat/backend/src/modules/chat/routes.ts` - Core chat pipeline where RAG, tools, forms, memory, and streaming all converge; most modifications needed here
- `/home/marcello/enterprise-ai-chat/backend/src/services/EmbeddingService.ts` - Must fix Ollama auth header; without this, zero vector operations work
- `/home/marcello/enterprise-ai-chat/backend/src/services/VectorMemoryService.ts` - Central vector memory service; add deduplication, used by all RAG features
