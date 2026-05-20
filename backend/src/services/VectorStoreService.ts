/**
 * Vector Store Service
 * Manages vector storage and semantic search using Qdrant REST API
 * Gracefully degrades when Qdrant is not available
 */

import { generateEmbedding, generateEmbeddings, detectEmbeddingProvider } from './EmbeddingService.js';
import { updateOne } from '../database/index.js';
import type mysql from 'mysql2/promise';
import type { DocumentChunk } from './ChunkingService.js';

// ============================================================
// Configuration
// ============================================================

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'document_chunks';

// ============================================================
// Types
// ============================================================

export interface VectorSearchResult {
    chunkId: number;
    attachmentId: number;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
}

interface QdrantPoint {
    id: number;
    vector: number[];
    payload: {
        attachment_id: number;
        chunk_index: number;
        content: string;
        metadata: Record<string, unknown>;
    };
}

// ============================================================
// Health Check
// ============================================================

let qdrantAvailable: boolean | null = null;
let lastHealthCheck: number = 0;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

/**
 * Check if Qdrant is available. Caches the result for 1 minute.
 */
export async function isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (qdrantAvailable !== null && now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
        return qdrantAvailable;
    }

    try {
        const response = await fetch(`${QDRANT_URL}/healthz`, {
            signal: AbortSignal.timeout(3000),
        });
        qdrantAvailable = response.ok;
    } catch {
        qdrantAvailable = false;
    }

    lastHealthCheck = now;
    return qdrantAvailable;
}

// ============================================================
// Collection Management
// ============================================================

/**
 * Ensure the Qdrant collection exists with the correct dimensions
 */
export async function ensureCollection(dimensions: number): Promise<boolean> {
    if (!await isAvailable()) return false;

    try {
        // Check if collection exists
        const checkResp = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
        if (checkResp.ok) return true;

        // Create collection with tuned HNSW + scalar quantization int8.
        // - hnsw m=32 / ef_construct=200: better recall vs default m=16, modest build-time hit
        // - scalar int8 quantization: ~4× RAM saving with negligible recall loss
        // - on_disk vectors: keep raw vectors on disk, only quantized in RAM
        const createResp = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vectors: {
                    size: dimensions,
                    distance: 'Cosine',
                    on_disk: true,
                },
                hnsw_config: {
                    m: 32,
                    ef_construct: 200,
                    full_scan_threshold: 10000,
                },
                quantization_config: {
                    scalar: {
                        type: 'int8',
                        quantile: 0.99,
                        always_ram: true,
                    },
                },
                optimizers_config: {
                    default_segment_number: 2,
                    indexing_threshold: 20000,
                },
            }),
        });

        if (!createResp.ok) {
            const error = await createResp.text();
            console.error(`[VectorStore] Failed to create collection: ${error}`);
            return false;
        }

        console.log(`[VectorStore] Created collection ${COLLECTION_NAME} (${dimensions}d)`);
        return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[VectorStore] Collection setup error: ${error.message}`);
        return false;
    }
}

// ============================================================
// Indexing
// ============================================================

/**
 * Index document chunks into the vector store
 * Generates embeddings and upserts them into Qdrant
 */
export async function indexChunks(
    db: mysql.Pool,
    attachmentId: number,
    chunks: DocumentChunk[]
): Promise<boolean> {
    if (!await isAvailable()) {
        console.log('[VectorStore] Qdrant not available, skipping indexing');
        return false;
    }

    const provider = await detectEmbeddingProvider(db);
    if (!provider) {
        console.log('[VectorStore] No embedding provider configured, skipping indexing');
        return false;
    }

    try {
        // Track indexing status
        await db.execute(
            `INSERT INTO vector_index_status (attachment_id, total_chunks, indexed_chunks, embedding_model, vector_collection, status)
       VALUES (?, ?, 0, ?, ?, 'indexing')
       ON DUPLICATE KEY UPDATE total_chunks = ?, indexed_chunks = 0, status = 'indexing', error = NULL`,
            [attachmentId, chunks.length, provider.modelId, COLLECTION_NAME, chunks.length]
        );

        // Ensure collection exists
        const collectionReady = await ensureCollection(provider.dimensions);
        if (!collectionReady) {
            await updateOne(db,
                'UPDATE vector_index_status SET status = ?, error = ? WHERE attachment_id = ?',
                ['failed', 'Failed to create/access Qdrant collection', attachmentId]
            );
            return false;
        }

        // Generate embeddings in batches of 20
        const batchSize = 20;
        let indexedCount = 0;

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const texts = batch.map(c => c.content);
            const embeddings = await generateEmbeddings(db, texts);

            // Build Qdrant points
            const points: QdrantPoint[] = [];
            for (let j = 0; j < batch.length; j++) {
                const embedding = embeddings[j];
                if (!embedding) continue;

                // Use a composite ID: attachmentId * 10000 + chunk_index
                const pointId = attachmentId * 10000 + batch[j].index;

                points.push({
                    id: pointId,
                    vector: embedding.embedding,
                    payload: {
                        attachment_id: attachmentId,
                        chunk_index: batch[j].index,
                        content: batch[j].content,
                        metadata: batch[j].metadata,
                    },
                });
            }

            if (points.length > 0) {
                // Upsert to Qdrant
                const upsertResp = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ points }),
                });

                if (!upsertResp.ok) {
                    const error = await upsertResp.text();
                    console.error(`[VectorStore] Upsert failed: ${error}`);
                    continue;
                }

                indexedCount += points.length;
            }

            // Update progress
            await updateOne(db,
                'UPDATE vector_index_status SET indexed_chunks = ? WHERE attachment_id = ?',
                [indexedCount, attachmentId]
            );
        }

        // Mark complete
        await updateOne(db,
            'UPDATE vector_index_status SET status = ?, indexed_chunks = ? WHERE attachment_id = ?',
            ['completed', indexedCount, attachmentId]
        );

        console.log(`[VectorStore] Indexed ${indexedCount}/${chunks.length} chunks for attachment ${attachmentId}`);
        return true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[VectorStore] Indexing error: ${error.message}`);
        await updateOne(db,
            'UPDATE vector_index_status SET status = ?, error = ? WHERE attachment_id = ?',
            ['failed', error.message, attachmentId]
        );
        return false;
    }
}

// ============================================================
// Semantic Search
// ============================================================

/**
 * Search for similar chunks using a query string
 */
export async function searchSimilar(
    db: mysql.Pool,
    query: string,
    options: {
        attachmentIds?: number[];
        limit?: number;
        scoreThreshold?: number;
    } = {}
): Promise<VectorSearchResult[]> {
    const { attachmentIds, limit = 5, scoreThreshold = 0.3 } = options;

    if (!await isAvailable()) {
        return [];
    }

    try {
        // Generate query embedding
        const queryEmbedding = await generateEmbedding(db, query);
        if (!queryEmbedding) return [];

        // Build Qdrant search request
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const searchBody: any = {
            vector: queryEmbedding.embedding,
            limit,
            score_threshold: scoreThreshold,
            with_payload: true,
        };

        // Filter by attachment IDs if specified
        if (attachmentIds && attachmentIds.length > 0) {
            searchBody.filter = {
                must: [{
                    key: 'attachment_id',
                    match: {
                         
                        any: attachmentIds,
                    },
                }],
            };
        }

        const response = await fetch(
            `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(searchBody),
            }
        );

        if (!response.ok) {
            console.error(`[VectorStore] Search failed: ${response.status}`);
            return [];
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const data = await response.json() as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const results: VectorSearchResult[] = (data.result || []).map((hit: any) => ({
            chunkId: hit.id,
            attachmentId: hit.payload?.attachment_id,
            content: hit.payload?.content || '',
            score: hit.score,
            metadata: hit.payload?.metadata || {},
        }));

        return results;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
        console.error(`[VectorStore] Search error: ${error.message}`);
        return [];
    }
}