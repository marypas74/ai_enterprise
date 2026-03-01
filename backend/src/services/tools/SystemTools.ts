/**
 * SystemTools - System/utility tool definitions and executors
 * Handles execute_python, vector_memory_search
 */

import * as SandboxService from '../SandboxService.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../ToolService.js';

/**
 * System/utility tool definitions for Anthropic API
 */
export function getSystemToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'execute_python',
      description: 'Execute Python code in a sandboxed environment with access to: file operations (tool.read_file, tool.write_file, tool.list_files), web search (tool.web_search), HTTP requests (tool.http_get, tool.web_extract), vector search (tool.vector_search, tool.vector_upsert), and data analysis (tool.dataframe with pandas). Use this for complex multi-step tasks, data processing, calculations, web scraping, and any task that benefits from programmatic execution. The variable "tool" is a pre-initialized ToolBridge instance.',
      input_schema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Python 3 code to execute. Use print() for output. The "tool" object provides: tool.read_file(path), tool.write_file(path, content), tool.list_files(path), tool.web_search(query), tool.http_get(url), tool.web_extract(url), tool.vector_search(query, collection, top_k), tool.vector_upsert(text, metadata, collection), tool.dataframe(data).'
          },
          timeout_ms: {
            type: 'number',
            description: 'Optional timeout in milliseconds (default: 30000, max: 60000)'
          }
        },
        required: ['code']
      }
    },
    {
      name: 'vector_memory_search',
      description: 'Search the vector memory (Qdrant) for semantically similar content. Use this to find relevant context from previously stored documents, conversations, or knowledge. Returns ranked results with similarity scores.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query in natural language'
          },
          collection: {
            type: 'string',
            description: 'Qdrant collection to search (default: "document_chunks"). Available: "document_chunks", "episodic_memory", "procedural_memory"'
          },
          top_k: {
            type: 'number',
            description: 'Number of results to return (default: 5, max: 20)'
          },
          score_threshold: {
            type: 'number',
            description: 'Minimum similarity score 0-1 (default: 0.7)'
          }
        },
        required: ['query']
      }
    }
  ];
}

/**
 * Execute a system/utility tool
 */
export async function executeSystemTool(
  toolName: string,
  toolInput: Record<string, any>,
  context: ToolContext
): Promise<ToolResult | null> {
  switch (toolName) {
    case 'execute_python': {
      const { code, timeout_ms } = toolInput;
      if (!code) {
        return { success: false, error: 'Missing required parameter: code' };
      }

      try {
        const db = context.db || null;
        // Clamp timeout at call site as defense-in-depth
        const safeTimeout = timeout_ms
          ? Math.min(Math.max(Number(timeout_ms), 1000), 60_000)
          : undefined;
        const result = await SandboxService.execute(code, context, db, safeTimeout);
        return {
          success: result.success,
          output: {
            stdout: result.output,
            stderr: result.error,
            executionTimeMs: result.executionTimeMs,
            toolCallsCount: result.toolCallsCount,
            webRequestsCount: result.webRequestsCount,
          },
          error: result.success ? undefined : (result.error || 'Python execution failed'),
        };
      } catch (error: any) {
        return { success: false, error: `Sandbox execution failed: ${error.message}` };
      }
    }

    case 'vector_memory_search': {
      const { query, collection, top_k, score_threshold } = toolInput;
      if (!query) {
        return { success: false, error: 'Missing required parameter: query' };
      }

      // Collection allowlist -- prevent access to arbitrary Qdrant collections
      const ALLOWED_COLLECTIONS = new Set(['document_chunks', 'episodic_memory', 'procedural_memory']);
      const collectionName = collection || 'document_chunks';
      if (!ALLOWED_COLLECTIONS.has(collectionName)) {
        return { success: false, error: `Unknown collection: ${collectionName}. Allowed: ${[...ALLOWED_COLLECTIONS].join(', ')}` };
      }

      try {
        const { generateEmbedding } = await import('../EmbeddingService.js');
        const db = context.db || null;
        if (!db) {
          return { success: false, error: 'Database connection not available for embedding generation' };
        }
        const embedding = await generateEmbedding(db, query);
        if (!embedding) {
          return { success: false, error: 'Embedding generation returned null -- no provider configured' };
        }
        const vector = embedding.embedding || [];
        if (!vector.length) {
          return { success: false, error: 'Failed to generate embedding for query' };
        }

        const qdrantUrl = process.env.QDRANT_URL || 'http://qdrant:6333';
        const limit = Math.min(top_k || 5, 20);
        const threshold = score_threshold ?? 0.7;

        const resp = await fetch(
          `${qdrantUrl}/collections/${encodeURIComponent(collectionName)}/points/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vector,
              limit,
              score_threshold: threshold,
              with_payload: true,
            }),
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (!resp.ok) {
          const errText = await resp.text();
          return { success: false, error: `Qdrant search failed (${resp.status}): ${errText}` };
        }

        const data = await resp.json() as any;
        const results = (data.result || []).map((point: any) => {
          const payload = point.payload || {};
          return {
            content: payload.content || '',
            score: Math.round((point.score || 0) * 10000) / 10000,
            metadata: Object.fromEntries(
              Object.entries(payload).filter(([k]) => k !== 'content')
            ),
          };
        });

        return {
          success: true,
          output: {
            query,
            collection: collectionName,
            results,
            count: results.length,
          },
        };
      } catch (error: any) {
        return { success: false, error: `Vector search failed: ${error.message}` };
      }
    }

    default:
      return null;
  }
}
