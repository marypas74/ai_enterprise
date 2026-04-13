/**
 * Rabbit Hole Service — Enhanced Document Ingestion Pipeline
 *
 * Hookable multi-format document ingestion pipeline.
 *
 * Pipeline:
 *   Upload/URL → Parse → hook:before_splits_text → Chunk → hook:after_splits_text
 *     → hook:before_stores_documents → Embed & Store each chunk → hook:after_stored_documents
 *
 * Supports: PDF, DOCX, XLSX, PPTX, Markdown, plain text, HTML, CSV
 * Provides real-time progress via WebSocket.
 */

import { FastifyInstance } from 'fastify';
import { insertOne, updateOne, findMany } from '../database/index.js';
import { chunkDocument, type DocumentChunk } from './ChunkingService.js';
import { storeDeclarative, getAllCollectionsInfo, type MemoryPoint } from './VectorMemoryService.js';
import { eventBus, type HookContext } from './EventBusService.js';
import type mysql from 'mysql2/promise';
import { VisionPipelineService } from './VisionPipelineService.js';
import { AIProviderFactory } from '../modules/ai/AIProviderFactory.js';

// ---- Types ----

export interface IngestionOptions {
  userId: number;
  conversationId?: number;
  source: string;           // URL or filename
  sourceType: 'url' | 'file' | 'text';
  contentType?: string;     // MIME type
  chunkSize?: number;
  chunkOverlap?: number;
  metadata?: Record<string, any>;
}

export interface IngestionProgress {
  ingestionId: number;
  status: 'parsing' | 'chunking' | 'embedding' | 'completed' | 'failed';
  file: string;
  totalChunks?: number;
  processedChunks?: number;
  error?: string;
}

export interface IngestionResult {
  ingestionId: number;
  source: string;
  title: string;
  chunksCount: number;
  status: 'completed' | 'failed';
  error?: string;
}

type ProgressCallback = (progress: IngestionProgress) => void;

// ---- Service ----

export class RabbitHoleService {
  constructor(
    private fastify: FastifyInstance,
    private db: mysql.Pool,
  ) {}

  /**
   * Main entry point — ingest text content through the full hookable pipeline
   */
  async ingest(
    content: string,
    title: string,
    options: IngestionOptions,
    onProgress?: ProgressCallback,
  ): Promise<IngestionResult> {
    const hookCtx: HookContext = {
      userId: options.userId,
      conversationId: options.conversationId,
    };

    // Create ingestion record
    const ingestionId = await insertOne(this.db,
      `INSERT INTO web_ingestions (user_id, conversation_id, url, title, status) VALUES (?, ?, ?, ?, 'fetching')`,
      [options.userId, options.conversationId || null, options.source, title],
    );

    try {
      // ---- Step 1: Notify parsing ----
      onProgress?.({
        ingestionId, status: 'parsing', file: options.source,
      });

      if (content.length < 30) {
        throw new Error('Content too short (< 30 chars)');
      }

      await updateOne(this.db,
        `UPDATE web_ingestions SET title = ?, content_length = ?, status = 'chunking' WHERE id = ?`,
        [title, content.length, ingestionId],
      );

      // ---- Step 2: Hook — before_splits_text ----
      onProgress?.({
        ingestionId, status: 'chunking', file: options.source,
      });

      const splitData = { text: content, source: options.source, options };
      const beforeSplitResult = await eventBus.pipe('before_splits_text', splitData, hookCtx);
      const textToSplit = beforeSplitResult.data?.text ?? content;

      // ---- Step 3: Chunk ----
      let chunks = chunkDocument(textToSplit, {
        chunkSize: options.chunkSize ?? 800,
        overlap: options.chunkOverlap ?? 150,
      });

      // ---- Step 4: Hook — after_splits_text ----
      const afterSplitResult = await eventBus.pipe('after_splits_text', {
        chunks, source: options.source, options,
      }, hookCtx);
      chunks = afterSplitResult.data?.chunks ?? chunks;

      await updateOne(this.db,
        `UPDATE web_ingestions SET chunks_count = ?, status = 'indexing' WHERE id = ?`,
        [chunks.length, ingestionId],
      );

      onProgress?.({
        ingestionId, status: 'embedding', file: options.source,
        totalChunks: chunks.length, processedChunks: 0,
      });

      // ---- Step 5: Hook — before_stores_documents ----
      const docsData = {
        chunks, source: options.source, title, userId: options.userId, metadata: options.metadata,
      };
      const beforeStoreResult = await eventBus.pipe('before_stores_documents', docsData, hookCtx);
      const finalChunks: DocumentChunk[] = beforeStoreResult.data?.chunks ?? chunks;

      // ---- Step 6: Embed & Store each chunk ----
      let storedCount = 0;
      for (let i = 0; i < finalChunks.length; i++) {
        const chunk = finalChunks[i];
        const ok = await storeDeclarative(this.db, options.userId, chunk.content, options.source, {
          title,
          chunk_index: chunk.index,
          section_title: chunk.metadata.sectionTitle,
          source_type: options.sourceType,
          ...(options.metadata || {}),
        });
        if (ok) storedCount++;

        // Progress notification every 5 chunks
        if ((i + 1) % 5 === 0 || i === finalChunks.length - 1) {
          onProgress?.({
            ingestionId, status: 'embedding', file: options.source,
            totalChunks: finalChunks.length, processedChunks: i + 1,
          });
        }
      }

      // ---- Step 7: Hook — after_stored_documents ----
      await eventBus.emit('after_stored_documents', {
        source: options.source, title, storedCount, totalChunks: finalChunks.length, userId: options.userId,
      }, hookCtx);

      // ---- Step 8: Mark complete ----
      await updateOne(this.db,
        `UPDATE web_ingestions SET status = 'completed', chunks_count = ? WHERE id = ?`,
        [storedCount, ingestionId],
      );

      onProgress?.({
        ingestionId, status: 'completed', file: options.source,
        totalChunks: finalChunks.length, processedChunks: storedCount,
      });

      return { ingestionId, source: options.source, title, chunksCount: storedCount, status: 'completed' };
    } catch (error: any) {
      await updateOne(this.db,
        `UPDATE web_ingestions SET status = 'failed', error = ? WHERE id = ?`,
        [error.message, ingestionId],
      );

      onProgress?.({
        ingestionId, status: 'failed', file: options.source, error: error.message,
      });

      return { ingestionId, source: options.source, title: '', chunksCount: 0, status: 'failed', error: error.message };
    }
  }

  /**
   * Ingest a file from processed chat attachment content
   */
  async ingestFileContent(
    content: string,
    filename: string,
    userId: number,
    conversationId?: number,
    onProgress?: ProgressCallback,
  ): Promise<IngestionResult> {
    return this.ingest(content, filename, {
      userId,
      conversationId,
      source: filename,
      sourceType: 'file',
      metadata: { original_filename: filename },
    }, onProgress);
  }

  /**
   * Ingest di un file raw (Buffer + MIME type).
   * Per i PDF: rileva automaticamente se testuale o scansionato.
   * Se scansionato → usa vLLM Qwen2.5-VL per estrarre il testo dalle immagini.
   * Se testuale → usa extractedText passato dal chiamante.
   */
  async ingestFileBuffer(
    buffer: Buffer,
    mimeType: string,
    extractedText: string,
    filename: string,
    userId: number,
    conversationId?: number,
    onProgress?: ProgressCallback,
  ): Promise<IngestionResult> {
    const vision = await VisionPipelineService.prepare(buffer, mimeType);

    let contentToIngest = extractedText;

    if (vision.pages.length > 0) {
      try {
        const prompt =
          'Estrai e trascrivi fedelmente tutto il testo visibile in questo documento. ' +
          'Preserva la struttura (titoli, paragrafi, tabelle, elenchi). ' +
          'Non aggiungere commenti o interpretazioni — solo il testo del documento.';

        const message = AIProviderFactory.buildDocumentMessage(prompt, vision.pages);
        const provider = AIProviderFactory.getProvider('qwen25vl:32b', 'vllm');
        const result = await provider.complete({
          model: 'qwen25vl:32b',
          messages: [message],
          temperature: 0.1,
          maxTokens: 8192,
        });

        if (result.content && result.content.length > 50) {
          contentToIngest = result.content;
        }
      } catch {
        // Fallback silenzioso: usa il testo già estratto
      }
    }

    return this.ingestFileContent(contentToIngest, filename, userId, conversationId, onProgress);
  }

  /**
   * Ingest raw text (e.g., pasted content)
   */
  async ingestText(
    text: string,
    title: string,
    userId: number,
    conversationId?: number,
    onProgress?: ProgressCallback,
  ): Promise<IngestionResult> {
    return this.ingest(text, title, {
      userId,
      conversationId,
      source: `text:${title}`,
      sourceType: 'text',
    }, onProgress);
  }

  /**
   * Export all memory points from a collection as JSON
   */
  async exportMemory(collection: 'episodic_memory' | 'declarative_memory' | 'procedural_memory', userId: number): Promise<any> {
    const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
    try {
      const resp = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: collection !== 'procedural_memory'
            ? { must: [{ key: 'user_id', match: { value: userId } }] }
            : {},
          limit: 10000,
          with_payload: true,
          with_vector: true,
        }),
      });

      if (!resp.ok) return { collection, points: [], error: `HTTP ${resp.status}` };

      const data = await resp.json() as any;
      return {
        collection,
        points: data.result?.points || [],
        exportedAt: new Date().toISOString(),
        userId,
      };
    } catch (err: any) {
      return { collection, points: [], error: err.message };
    }
  }

  /**
   * Import memory points from a JSON export
   */
  async importMemory(
    collection: 'episodic_memory' | 'declarative_memory' | 'procedural_memory',
    points: any[],
  ): Promise<{ imported: number; errors: number }> {
    const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
    let imported = 0;
    let errors = 0;

    // Batch upsert in groups of 100
    for (let i = 0; i < points.length; i += 100) {
      const batch = points.slice(i, i + 100).map(p => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      }));

      try {
        const resp = await fetch(`${QDRANT_URL}/collections/${collection}/points`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: batch }),
        });
        if (resp.ok) {
          imported += batch.length;
        } else {
          errors += batch.length;
        }
      } catch {
        errors += batch.length;
      }
    }

    return { imported, errors };
  }
}
