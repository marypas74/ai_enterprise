/**
 * OCRCacheService — Cache Tesseract OCR results per attachment_id + page hash.
 * Uses Redis if available, falls back to in-memory Map.
 */
import crypto from 'crypto';

const CACHE_TTL_SECONDS = 3600; // 1 hour
const memoryCache = new Map<string, { text: string; ts: number }>();
const MAX_MEMORY_ENTRIES = 500;

// Lightweight in-process counters for cache observability.
// Exposed via getOCRCacheStats() — used by /api/admin/ocr-metrics (F6).
interface CacheCounters {
  page_hits: number;
  page_misses: number;
  page_writes: number;
  doc_hits: number;
  doc_misses: number;
  doc_writes: number;
}
const counters: CacheCounters = {
  page_hits: 0, page_misses: 0, page_writes: 0,
  doc_hits: 0, doc_misses: 0, doc_writes: 0,
};

export interface OCRCacheStats {
  readonly page_hits: number;
  readonly page_misses: number;
  readonly page_writes: number;
  readonly page_hit_rate: number; // 0..1
  readonly doc_hits: number;
  readonly doc_misses: number;
  readonly doc_writes: number;
  readonly doc_hit_rate: number; // 0..1
  readonly memory_entries: number;
}

export function getOCRCacheStats(): OCRCacheStats {
  const pageTotal = counters.page_hits + counters.page_misses;
  const docTotal = counters.doc_hits + counters.doc_misses;
  return {
    page_hits: counters.page_hits,
    page_misses: counters.page_misses,
    page_writes: counters.page_writes,
    page_hit_rate: pageTotal > 0 ? counters.page_hits / pageTotal : 0,
    doc_hits: counters.doc_hits,
    doc_misses: counters.doc_misses,
    doc_writes: counters.doc_writes,
    doc_hit_rate: docTotal > 0 ? counters.doc_hits / docTotal : 0,
    memory_entries: memoryCache.size,
  };
}

export function resetOCRCacheStats(): void {
  counters.page_hits = 0; counters.page_misses = 0; counters.page_writes = 0;
  counters.doc_hits = 0; counters.doc_misses = 0; counters.doc_writes = 0;
}

/**
 * Compute a hash for a page image buffer to detect changes.
 */
function computePageHash(pageBuffer: Buffer): string {
  return crypto.createHash('sha256').update(pageBuffer).digest('hex').substring(0, 16);
}

/**
 * Build the cache key from attachment ID and page buffer hash.
 */
function buildCacheKey(attachmentId: number, pageIndex: number, pageBuffer: Buffer): string {
  const pageHash = computePageHash(pageBuffer);
  return `ocr:${attachmentId}:${pageIndex}:${pageHash}`;
}

/**
 * Get cached OCR result. Tries Redis first, then memory.
 */
export async function getCachedOCR(
  attachmentId: number,
  pageIndex: number,
  pageBuffer: Buffer,
  redisClient?: any,
): Promise<string | null> {
  const key = buildCacheKey(attachmentId, pageIndex, pageBuffer);

  // Try Redis
  if (redisClient) {
    try {
      const cached = await redisClient.get(key);
      if (cached !== null) { counters.page_hits++; return cached; }
    } catch {
      // Redis unavailable — fall through to memory
    }
  }

  // Try memory cache
  const entry = memoryCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_SECONDS * 1000) {
    counters.page_hits++;
    return entry.text;
  }

  // Expired — clean up
  if (entry) memoryCache.delete(key);
  counters.page_misses++;
  return null;
}

/**
 * Store OCR result in cache. Writes to Redis and memory.
 */
export async function setCachedOCR(
  attachmentId: number,
  pageIndex: number,
  pageBuffer: Buffer,
  text: string,
  redisClient?: any,
): Promise<void> {
  const key = buildCacheKey(attachmentId, pageIndex, pageBuffer);

  // Store in Redis
  if (redisClient) {
    try {
      await redisClient.set(key, text, { EX: CACHE_TTL_SECONDS });
    } catch {
      // Redis unavailable — memory only
    }
  }

  // Store in memory (with eviction)
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    // Evict oldest entries
    const entries = Array.from(memoryCache.entries());
    entries.sort((a, b) => a[1].ts - b[1].ts);
    const toDelete = entries.slice(0, Math.floor(MAX_MEMORY_ENTRIES / 4));
    for (const [k] of toDelete) memoryCache.delete(k);
  }

  memoryCache.set(key, { text, ts: Date.now() });
  counters.page_writes++;
}

// ─── Document-level cache (content-hash, attachment-independent) ─────────────
// Key: doc-ocr:<sha256-of-content>:<method-tag>
// Skips the entire pipeline (pdftoppm + per-page vision OCR) when the same file
// is uploaded again. TTL longer than per-page cache: input is content-addressed.

const DOC_CACHE_TTL_SECONDS = 7 * 24 * 3600;

function computeContentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildDocCacheKey(contentHash: string, methodTag: string): string {
  return `doc-ocr:${contentHash}:${methodTag}`;
}

export interface CachedDocResult {
  readonly text: string;
  readonly model: string;
  readonly pages: number;
  readonly method: string;
}

export async function getCachedDocOCR(
  buffer: Buffer,
  methodTag: string,
  redisClient?: any,
): Promise<CachedDocResult | null> {
  const key = buildDocCacheKey(computeContentHash(buffer), methodTag);
  if (redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (raw) { counters.doc_hits++; return JSON.parse(raw) as CachedDocResult; }
    } catch { /* fall through */ }
  }
  const entry = memoryCache.get(key);
  if (entry && Date.now() - entry.ts < DOC_CACHE_TTL_SECONDS * 1000) {
    try { counters.doc_hits++; return JSON.parse(entry.text) as CachedDocResult; }
    catch { memoryCache.delete(key); }
  }
  counters.doc_misses++;
  return null;
}

export async function setCachedDocOCR(
  buffer: Buffer,
  methodTag: string,
  result: CachedDocResult,
  redisClient?: any,
): Promise<void> {
  const key = buildDocCacheKey(computeContentHash(buffer), methodTag);
  const payload = JSON.stringify(result);
  if (redisClient) {
    try { await redisClient.set(key, payload, { EX: DOC_CACHE_TTL_SECONDS }); }
    catch { /* memory only */ }
  }
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const entries = Array.from(memoryCache.entries());
    entries.sort((a, b) => a[1].ts - b[1].ts);
    const toDelete = entries.slice(0, Math.floor(MAX_MEMORY_ENTRIES / 4));
    for (const [k] of toDelete) memoryCache.delete(k);
  }
  memoryCache.set(key, { text: payload, ts: Date.now() });
  counters.doc_writes++;
}

/**
 * Clear all OCR cache entries for a specific attachment.
 */
export async function clearOCRCache(
  attachmentId: number,
  redisClient?: any,
): Promise<void> {
  // Clear memory entries for this attachment
  for (const key of memoryCache.keys()) {
    if (key.startsWith(`ocr:${attachmentId}:`)) {
      memoryCache.delete(key);
    }
  }

  // Clear Redis entries (scan for matching keys)
  if (redisClient) {
    try {
      const keys = await redisClient.keys(`ocr:${attachmentId}:*`);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } catch {
      // Best-effort
    }
  }
}
