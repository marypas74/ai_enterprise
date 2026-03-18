/**
 * OCRCacheService — Cache Tesseract OCR results per attachment_id + page hash.
 * Uses Redis if available, falls back to in-memory Map.
 */
import crypto from 'crypto';

const CACHE_TTL_SECONDS = 3600; // 1 hour
const memoryCache = new Map<string, { text: string; ts: number }>();
const MAX_MEMORY_ENTRIES = 500;

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
      if (cached !== null) return cached;
    } catch {
      // Redis unavailable — fall through to memory
    }
  }

  // Try memory cache
  const entry = memoryCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_SECONDS * 1000) {
    return entry.text;
  }

  // Expired — clean up
  if (entry) memoryCache.delete(key);
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
