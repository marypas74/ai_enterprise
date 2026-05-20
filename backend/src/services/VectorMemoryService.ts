/**
 * Vector Memory Service — 4-tier memory system
 *
 * Collections:
 *   episodic_memory     — conversation Q+A pairs (timestamped)
 *   declarative_memory  — facts, documents, knowledge
 *   procedural_memory   — tool/skill/form descriptions
 *
 * Working memory is assembled on-the-fly per request (not stored in Qdrant).
 */

import { generateEmbedding, generateEmbeddings, detectEmbeddingProvider } from './EmbeddingService.js';
import { findOne, findMany, insertOne, updateOne } from '../database/index.js';
import type mysql from 'mysql2/promise';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

// ---- Types ----

export type MemoryCollection = 'episodic_memory' | 'declarative_memory' | 'procedural_memory';

export interface MemoryPoint {
  id: string | number;
  collection: MemoryCollection;
  content: string;
  score: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  metadata: Record<string, any>;
}

export interface WorkingMemory {
  episodic: MemoryPoint[];
  declarative: MemoryPoint[];
  procedural: MemoryPoint[];
  conversationHistory: { role: string; content: string }[];
  injectedContext: string;
}

export interface RecallOptions {
  userId: number;
  query: string;
  collections?: MemoryCollection[];
  episodicK?: number;
  episodicThreshold?: number;
  declarativeK?: number;
  declarativeThreshold?: number;
  proceduralK?: number;
  proceduralThreshold?: number;
}

interface RecallConfig {
  k: number;
  threshold: number;
}

// ---- Health ----

let qdrantOk: boolean | null = null;
let lastCheck = 0;

async function isQdrantAvailable(): Promise<boolean> {
  if (qdrantOk !== null && Date.now() - lastCheck < 60_000) return qdrantOk;
  try {
    const r = await fetch(`${QDRANT_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    qdrantOk = r.ok;
  } catch {
    qdrantOk = false;
  }
  lastCheck = Date.now();
  return qdrantOk;
}

// ---- Collection management ----

async function ensureCollection(name: string, dimensions: number): Promise<boolean> {
  if (!await isQdrantAvailable()) return false;
  try {
    const check = await fetch(`${QDRANT_URL}/collections/${name}`);
    if (check.ok) return true;

    const create = await fetch(`${QDRANT_URL}/collections/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: dimensions, distance: 'Cosine' } }),
    });
    if (!create.ok) {
      console.error(`[VectorMemory] Failed to create collection ${name}: ${await create.text()}`);
      return false;
    }
    console.log(`[VectorMemory] Created collection ${name} (${dimensions}d)`);
    return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (e: any) {
    console.error(`[VectorMemory] ensureCollection error: ${e.message}`);
    return false;
  }
}

async function ensureAllCollections(db: mysql.Pool): Promise<boolean> {
  const provider = await detectEmbeddingProvider(db);
  if (!provider) return false;
  const dim = provider.dimensions;

  const results = await Promise.all([
    ensureCollection('episodic_memory', dim),
    ensureCollection('declarative_memory', dim),
    ensureCollection('procedural_memory', dim),
  ]);
  return results.every(Boolean);
}

// ---- Semantic Deduplication ----

const DEDUP_THRESHOLD = parseFloat(process.env.MEMORY_DEDUP_THRESHOLD || '0.95');

/**
 * Check if a near-duplicate already exists in a collection.
 * Returns true if a point with cosine similarity >= DEDUP_THRESHOLD exists.
 */
async function isDuplicate(
  collection: string,
  embedding: number[],
  filterUserId?: number,
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const body: any = {
      vector: embedding,
      limit: 1,
      score_threshold: DEDUP_THRESHOLD,
      with_payload: false,
    };
    if (filterUserId && collection !== 'procedural_memory') {
      body.filter = { must: [{ key: 'user_id', match: { value: filterUserId } }] };
    }

    const resp = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const data = await resp.json() as any;
    return (data.result || []).length > 0;
  } catch {
    return false; // On error, allow storage (don't block)
  }
}

// ---- Store ----

export async function storeEpisodic(
  db: mysql.Pool,
  userId: number,
  conversationId: number,
  userMessage: string,
  assistantResponse: string,
): Promise<boolean> {
  if (!await isQdrantAvailable()) return false;

  const content = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
  const emb = await generateEmbedding(db, content);
  if (!emb) return false;

  await ensureCollection('episodic_memory', emb.dimensions);

  // Semantic dedup: skip if near-duplicate exists
  if (await isDuplicate('episodic_memory', emb.embedding, userId)) {
    console.log(`[VectorMemory] Skipping duplicate episodic memory for user ${userId}`);
    return true;
  }

  const pointId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  const resp = await fetch(`${QDRANT_URL}/collections/episodic_memory/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: [{
        id: pointId,
        vector: emb.embedding,
        payload: {
          user_id: userId,
          conversation_id: conversationId,
          content,
          user_message: userMessage,
          assistant_response: assistantResponse,
          when: new Date().toISOString(),
          source: `user_${userId}`,
        },
      }],
    }),
  });

  return resp.ok;
}

export async function storeDeclarative(
  db: mysql.Pool,
  userId: number,
  content: string,
  source: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  metadata: Record<string, any> = {},
): Promise<boolean> {
  if (!await isQdrantAvailable()) return false;

  const emb = await generateEmbedding(db, content);
  if (!emb) return false;

  await ensureCollection('declarative_memory', emb.dimensions);

  // Semantic dedup: skip if near-duplicate exists
  if (await isDuplicate('declarative_memory', emb.embedding, userId)) {
    console.log(`[VectorMemory] Skipping duplicate declarative memory for user ${userId}`);
    return true;
  }

  const pointId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  const resp = await fetch(`${QDRANT_URL}/collections/declarative_memory/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: [{
        id: pointId,
        vector: emb.embedding,
        payload: { ...metadata, user_id: userId, content, source, when: new Date().toISOString() },
      }],
    }),
  });

  return resp.ok;
}

export async function storeProcedural(
  db: mysql.Pool,
  toolId: number,
  name: string,
  description: string,
  toolType: string,
  source: string,
): Promise<boolean> {
  if (!await isQdrantAvailable()) return false;

  const emb = await generateEmbedding(db, `${name}: ${description}`);
  if (!emb) return false;

  await ensureCollection('procedural_memory', emb.dimensions);

  const pointId = toolId * 100 + 1;

  // Delete old point for this tool if exists
  await fetch(`${QDRANT_URL}/collections/procedural_memory/points/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points: [pointId] }),
  });

  const resp = await fetch(`${QDRANT_URL}/collections/procedural_memory/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: [{
        id: pointId,
        vector: emb.embedding,
        payload: {
          tool_id: toolId,
          name,
          content: description,
          type: toolType,
          source,
          when: new Date().toISOString(),
        },
      }],
    }),
  });

  return resp.ok;
}

// ---- Recall ----

export async function searchCollection(
  db: mysql.Pool,
  collection: MemoryCollection,
  query: string,
  k: number,
  threshold: number,
  filterUserId?: number,
): Promise<MemoryPoint[]> {
  if (!await isQdrantAvailable()) return [];

  const emb = await generateEmbedding(db, query);
  if (!emb) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const body: any = {
    vector: emb.embedding,
    limit: k,
    score_threshold: threshold,
    with_payload: true,
  };

  if (filterUserId && collection !== 'procedural_memory') {
    body.filter = { must: [{ key: 'user_id', match: { value: filterUserId } }] };
  }

  try {
    const resp = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const data = await resp.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    return (data.result || []).map((hit: any) => ({
      id: hit.id,
      collection,
      content: hit.payload?.content || '',
      score: hit.score,
      metadata: hit.payload || {},
    }));
  } catch {
    return [];
  }
}

export async function recall(db: mysql.Pool, options: RecallOptions): Promise<{
  episodic: MemoryPoint[];
  declarative: MemoryPoint[];
  procedural: MemoryPoint[];
}> {
  const collections = options.collections || ['episodic_memory', 'declarative_memory', 'procedural_memory'];

  const [episodic, declarative, procedural] = await Promise.all([
    collections.includes('episodic_memory')
      ? searchCollection(db, 'episodic_memory', options.query, options.episodicK || 3, options.episodicThreshold || 0.7, options.userId)
      : Promise.resolve([]),
    collections.includes('declarative_memory')
      ? searchCollection(db, 'declarative_memory', options.query, options.declarativeK || 3, options.declarativeThreshold || 0.7, options.userId)
      : Promise.resolve([]),
    collections.includes('procedural_memory')
      ? searchCollection(db, 'procedural_memory', options.query, options.proceduralK || 3, options.proceduralThreshold || 0.7)
      : Promise.resolve([]),
  ]);

  return { episodic, declarative, procedural };
}

// ---- Working Memory builder ----

export function buildWorkingMemory(
  recalled: { episodic: MemoryPoint[]; declarative: MemoryPoint[]; procedural: MemoryPoint[] },
  conversationHistory: { role: string; content: string }[],
): WorkingMemory {
  const parts: string[] = [];

  if (recalled.episodic.length > 0) {
    parts.push('## Relevant past conversations');
    for (const m of recalled.episodic) {
      parts.push(`- (score ${m.score.toFixed(2)}) ${m.content.substring(0, 300)}`);
    }
  }

  if (recalled.declarative.length > 0) {
    parts.push('## Relevant knowledge');
    for (const m of recalled.declarative) {
      const src = m.metadata.source || 'unknown';
      parts.push(`- [${src}] (score ${m.score.toFixed(2)}) ${m.content.substring(0, 400)}`);
    }
  }

  if (recalled.procedural.length > 0) {
    parts.push('## Available tools/procedures');
    for (const m of recalled.procedural) {
      parts.push(`- ${m.metadata.name || 'tool'}: ${m.content.substring(0, 200)}`);
    }
  }

  return {
    ...recalled,
    conversationHistory,
    injectedContext: parts.join('\n'),
  };
}

// ---- Collection info ----

export async function getCollectionInfo(collection: MemoryCollection): Promise<{ name: string; points_count: number; status: string } | null> {
  if (!await isQdrantAvailable()) return null;
  try {
    const resp = await fetch(`${QDRANT_URL}/collections/${collection}`);
    if (!resp.ok) return { name: collection, points_count: 0, status: 'not_created' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const data = await resp.json() as any;
    return {
      name: collection,
      points_count: data.result?.points_count || 0,
      status: data.result?.status || 'unknown',
    };
  } catch {
    return null;
  }
}

export async function getAllCollectionsInfo(): Promise<{ name: string; points_count: number; status: string }[]> {
  const collections: MemoryCollection[] = ['episodic_memory', 'declarative_memory', 'procedural_memory'];
  const results = await Promise.all(collections.map(c => getCollectionInfo(c)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  return results.filter(Boolean) as any[];
}

export async function wipeCollection(collection: MemoryCollection): Promise<boolean> {
  if (!await isQdrantAvailable()) return false;
  try {
    const resp = await fetch(`${QDRANT_URL}/collections/${collection}`, { method: 'DELETE' });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function getUserRecallSettings(db: mysql.Pool, userId: number): Promise<{
  autoRagEnabled: boolean;
  episodicK: number; episodicThreshold: number;
  declarativeK: number; declarativeThreshold: number;
  proceduralK: number; proceduralThreshold: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const row = await findOne<any>(db,
    'SELECT auto_rag_enabled, episodic_recall_k, episodic_recall_threshold, declarative_recall_k, declarative_recall_threshold, procedural_recall_k, procedural_recall_threshold FROM memory_settings WHERE user_id = ?',
    [userId],
  );
  return {
    autoRagEnabled: row?.auto_rag_enabled ?? false,
    episodicK: row?.episodic_recall_k ?? 3,
    episodicThreshold: parseFloat(row?.episodic_recall_threshold ?? 0.7),
    declarativeK: row?.declarative_recall_k ?? 3,
    declarativeThreshold: parseFloat(row?.declarative_recall_threshold ?? 0.7),
    proceduralK: row?.procedural_recall_k ?? 3,
    proceduralThreshold: parseFloat(row?.procedural_recall_threshold ?? 0.7),
  };
}

export { ensureAllCollections };
