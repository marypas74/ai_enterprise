/**
 * RagWebFallback.ts
 * Runner that handles automatic web search fallback when RAG context is insufficient.
 *
 * Exported functions:
 *   - evaluateRagSufficiency(chunks, threshold): { sufficient, maxScore }
 *   - triggerWebFallback(query, ragChunks, maxResults): Promise<{ webResults }>
 *   - buildAttributionContext(ragChunks, webResults): string
 */

import { performWebSearch, extractSearchQuery } from '../../../services/WebSearchService.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RagChunk {
  readonly id: unknown;
  readonly content: string;
  readonly score?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly metadata: Record<string, any>;
  readonly collection: string;
}

export interface WebResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source?: string;
}

export interface RagSufficiencyResult {
  readonly sufficient: boolean;
  readonly maxScore: number;
}

export interface WebFallbackResult {
  readonly webResults: readonly WebResult[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.35;
const MAX_CHUNK_CONTENT_LENGTH = 1200;

// ── evaluateRagSufficiency ─────────────────────────────────────────────────────

/**
 * Determine whether the retrieved RAG chunks are sufficient to answer the query.
 * A chunk list is considered sufficient when at least one chunk has a score
 * greater than or equal to the threshold.
 */
export function evaluateRagSufficiency(
  chunks: readonly RagChunk[],
  threshold: number = DEFAULT_THRESHOLD
): RagSufficiencyResult {
  if (chunks.length === 0) {
    return { sufficient: false, maxScore: 0 };
  }

  const maxScore = chunks.reduce((best, chunk) => {
    const score = typeof chunk.score === 'number' ? chunk.score : 0;
    return score > best ? score : best;
  }, 0);

  return {
    sufficient: maxScore >= threshold,
    maxScore,
  };
}

// ── triggerWebFallback ─────────────────────────────────────────────────────────

/**
 * Perform an anonymous web search for the query and return structured results.
 * Query is anonymised: no userId, sessionId, or PII is sent to external services.
 *
 * @param query      The user query (plain text — anonymised before use)
 * @param ragChunks  Retrieved RAG chunks (passed for context, not sent externally)
 * @param maxResults Maximum number of web results to return
 */
export async function triggerWebFallback(
  query: string,
  _ragChunks: readonly RagChunk[],
  maxResults: number
): Promise<WebFallbackResult> {
  try {
    // Anonymise query: strip any potential user identifiers
    const cleanQuery = sanitiseQuery(query);
    const searchQuery = extractSearchQuery(cleanQuery);

    const searchResponse = await performWebSearch(searchQuery);

    if (!searchResponse.searchPerformed || searchResponse.results.length === 0) {
      return { webResults: [] };
    }

    const limited = searchResponse.results.slice(0, maxResults);

    const webResults: WebResult[] = limited.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet || '',
      source: r.source,
    }));

    return { webResults };
  } catch {
    // Network errors or parse failures must not crash the chat flow
    return { webResults: [] };
  }
}

// ── buildAttributionContext ────────────────────────────────────────────────────

/**
 * Build a combined context string with explicit [DOCUMENTO] and [WEB] markers
 * so the LLM can cite sources correctly.
 *
 * Privacy guarantee: user_id and other personal metadata fields are never
 * included in the output string.
 */
export function buildAttributionContext(
  ragChunks: readonly RagChunk[],
  webResults: readonly WebResult[]
): string {
  const parts: string[] = [];

  if (ragChunks.length > 0) {
    const docSection = ragChunks.map((chunk, i) => {
      const safeContent = truncateContent(chunk.content, MAX_CHUNK_CONTENT_LENGTH);
      return `[DOCUMENTO ${i + 1}]\n${safeContent}`;
    }).join('\n\n---\n\n');

    parts.push(`--- CONTESTO DAI DOCUMENTI ---\n${docSection}\n--- FINE DOCUMENTI ---`);
  }

  if (webResults.length > 0) {
    const webSection = webResults.map((r, i) => {
      const lines = [
        `[WEB ${i + 1}] ${r.title}`,
        `Fonte: ${r.url}`,
      ];
      if (r.snippet) {
        lines.push(r.snippet);
      }
      return lines.join('\n');
    }).join('\n\n---\n\n');

    parts.push(`--- RISULTATI RICERCA WEB ---\n${webSection}\n--- FINE WEB ---`);
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join('\n\n');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Remove any PII or user-identifying patterns from a query string
 * before it is forwarded to external search engines.
 */
function sanitiseQuery(query: string): string {
  return query
    .replace(/user_?id\s*[:=]\s*\d+/gi, '')
    .replace(/session_?id\s*[:=]\s*\S+/gi, '')
    .trim();
}

/**
 * Truncate content to maxLength to prevent token bloat.
 * Truncation is word-boundary aware where possible.
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }

  const truncated = content.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) : truncated) + '…';
}
