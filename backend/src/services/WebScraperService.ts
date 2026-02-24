/**
 * Web Scraper Service — Fetch and extract clean text from URLs
 * Used for URL ingestion into declarative memory / RAG pipeline
 */

import { insertOne, updateOne } from '../database/index.js';
import { chunkDocument } from './ChunkingService.js';
import { storeDeclarative } from './VectorMemoryService.js';
import type mysql from 'mysql2/promise';

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  contentLength: number;
}

export interface IngestionResult {
  url: string;
  title: string;
  chunksCount: number;
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Validate a URL against SSRF blocklist (private/internal networks)
 */
function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true;
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (/^169\.254\./.test(hostname)) return true;
    if (/^127\./.test(hostname)) return true;
    if (hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
    if (hostname.startsWith('::ffff:')) return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) return true;
    if (/^\d+$/.test(hostname)) return true;
    if (/^0\d/.test(hostname)) return true;

    return false;
  } catch {
    return true;
  }
}

const MAX_REDIRECTS = 5;

/**
 * Fetch a URL and extract clean text content
 */
export async function scrapeUrl(url: string, _redirectCount = 0): Promise<ScrapeResult> {
  if (isBlockedUrl(url)) {
    throw new Error('URL targets a private/internal network and is not allowed');
  }
  if (_redirectCount > MAX_REDIRECTS) {
    throw new Error('Too many redirects');
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; EnterpriseAIChat/1.5; +https://plane.lushlolli.com)',
      'Accept': 'text/html,application/xhtml+xml,text/plain,application/pdf',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'manual',
  });

  // Handle redirects manually to validate each target
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect without Location header');
    const resolvedUrl = new URL(location, url).toString();
    return scrapeUrl(resolvedUrl, _redirectCount + 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('text/plain')) {
    return { url, title: extractTitleFromUrl(url), content: rawText.trim(), contentLength: rawText.length };
  }

  // HTML parsing
  const title = extractHtmlTitle(rawText) || extractTitleFromUrl(url);
  const cleanText = extractTextFromHtml(rawText);

  return { url, title, content: cleanText, contentLength: cleanText.length };
}

/**
 * Full pipeline: scrape → chunk → embed → store in declarative memory
 */
export async function ingestUrl(
  db: mysql.Pool,
  userId: number,
  url: string,
  conversationId?: number,
): Promise<IngestionResult> {
  // Track ingestion
  const ingestionId = await insertOne(db,
    `INSERT INTO web_ingestions (user_id, conversation_id, url, status) VALUES (?, ?, ?, 'fetching')`,
    [userId, conversationId || null, url],
  );

  try {
    // 1. Scrape
    await updateOne(db, `UPDATE web_ingestions SET status = 'fetching' WHERE id = ?`, [ingestionId]);
    const scraped = await scrapeUrl(url);

    if (scraped.content.length < 50) {
      throw new Error('Extracted content too short (< 50 chars)');
    }

    // 2. Update title
    await updateOne(db,
      `UPDATE web_ingestions SET title = ?, content_length = ?, status = 'chunking' WHERE id = ?`,
      [scraped.title, scraped.contentLength, ingestionId],
    );

    // 3. Chunk
    const chunks = chunkDocument(scraped.content, { chunkSize: 800, overlap: 150 });

    await updateOne(db,
      `UPDATE web_ingestions SET chunks_count = ?, status = 'indexing' WHERE id = ?`,
      [chunks.length, ingestionId],
    );

    // 4. Store each chunk in declarative memory
    let storedCount = 0;
    for (const chunk of chunks) {
      const ok = await storeDeclarative(db, userId, chunk.content, url, {
        title: scraped.title,
        chunk_index: chunk.index,
        section_title: chunk.metadata.sectionTitle,
        source_type: 'web',
      });
      if (ok) storedCount++;
    }

    // 5. Complete
    await updateOne(db,
      `UPDATE web_ingestions SET status = 'completed', chunks_count = ? WHERE id = ?`,
      [storedCount, ingestionId],
    );

    return { url, title: scraped.title, chunksCount: storedCount, status: 'completed' };
  } catch (error: any) {
    await updateOne(db,
      `UPDATE web_ingestions SET status = 'failed', error = ? WHERE id = ?`,
      [error.message, ingestionId],
    );
    return { url, title: '', chunksCount: 0, status: 'failed', error: error.message };
  }
}

// ---- HTML helpers ----

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function extractTextFromHtml(html: string): string {
  // Remove script, style, nav, footer, header, aside
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, '\n');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Clean up whitespace
  text = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');

  // Remove excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function extractTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '').split('/').pop() || u.hostname;
    return path.replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
  } catch {
    return url;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
