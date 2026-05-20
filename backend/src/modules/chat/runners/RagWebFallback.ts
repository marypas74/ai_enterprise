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

// ── Layer 2: "no info" detection patterns ────────────────────────────────────

const NO_INFO_PATTERNS: readonly RegExp[] = [
  // IT diretti
  /non trovo (questa )?informazion/i,
  /il documento non (contiene|riporta|menziona)/i,
  /non (è presente|c'è nulla) nel documento/i,
  /il documento (non parla|non tratta)/i,
  // IT cortesia
  /purtroppo (non|il documento|questo)/i,
  /mi dispiace,? (non|ma)/i,
  // EN diretti
  /I don't know/i,
  /no information about/i,
  /(the )?document (doesn't contain|does not contain)/i,
  // EN cortesia
  /unfortunately,? I don't/i,
  /I'm sorry,? but/i,
];

/**
 * Detect whether an LLM response indicates it has no information to provide.
 * Used by Layer 2 auto-web-retry in completions.ts.
 */
export function detectNoInfoResponse(text: string): boolean {
  return NO_INFO_PATTERNS.some(p => p.test(text));
}

/**
 * Build a markdown summary of web results for inline streaming.
 * Each result is formatted as a numbered "Fonte" entry with markdown link.
 */
export function buildWebSummary(webResults: readonly WebResult[]): string {
  if (webResults.length === 0) return '';
  return webResults.map((r, i) =>
    `**Fonte ${i + 1}**: [${r.title}](${r.url})\n${r.snippet}\n`
  ).join('\n');
}

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
// ── Optional logger interface ─────────────────────────────────────────────────

interface OptionalLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  warn?: (obj: any, msg?: string) => void;
}

export async function triggerWebFallback(
  query: string,
  _ragChunks: readonly RagChunk[],
  maxResults: number,
  logger?: OptionalLogger
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
  } catch (err: unknown) {
    // DEBT-87-I: log warn with stack trace — logger is optional (not available in all call sites)
    logger?.warn?.({ err }, '[RagWebFallback] triggerWebFallback failed') ?? console.warn('[RagWebFallback] triggerWebFallback failed:', err);
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

// ── Settings cache (T4) ───────────────────────────────────────────────────────

const SETTINGS_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  readonly value: string;
  readonly ts: number;
}

const settingsCache = new Map<string, CacheEntry>();

/**
 * Read a system_settings value with 30s in-memory cache.
 * Reduces DB round-trips during Layer 2 detection (called once per message).
 */
export async function readSettingCached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  db: any,
  key: string,
  defaultValue: string,
  logger?: OptionalLogger
): Promise<string> {
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.ts < SETTINGS_CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const { findOne: dbFindOne } = await import('../../../database/index.js') as any;
    const row = await dbFindOne(db, 'SELECT setting_value FROM system_settings WHERE setting_key=?', [key]);
    const value: string = row?.setting_value ?? defaultValue;
    settingsCache.set(key, { value, ts: Date.now() });
    return value;
  } catch (err: unknown) {
    // DEBT-87-I: log warn with stack trace on DB error, fall back to default
    logger?.warn?.({ err }, `[RagWebFallback] readSettingCached failed for key=${key}, using default=${defaultValue}`) ?? console.warn(`[RagWebFallback] readSettingCached failed for key=${key}:`, err);
    return defaultValue;
  }
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
