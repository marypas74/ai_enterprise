/**
 * RagWebFallback.test.ts
 * TDD unit tests for RagWebFallback runner.
 * Written BEFORE implementation (RED phase).
 * Coverage target: ≥ 80%
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateRagSufficiency,
  buildAttributionContext,
  type WebResult,
} from './RagWebFallback.js';

// ── Mock performWebSearch via module mock ────────────────────────────────────
vi.mock('../../../services/WebSearchService.js', () => ({
  performWebSearch: vi.fn(),
  extractSearchQuery: vi.fn((q: string) => q),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeChunks(scores: number[]) {
  return scores.map((score, i) => ({
    id: i,
    content: `Chunk content ${i}`,
    score,
    metadata: { attachment_id: i + 1, source: `doc${i}.pdf` },
    collection: 'declarative_memory',
  }));
}

function makeWebResults(count: number): WebResult[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example${i}.com/page`,
    snippet: `Snippet for result ${i}`,
    source: `example${i}.com`,
  }));
}

// ── evaluateRagSufficiency ───────────────────────────────────────────────────

describe('evaluateRagSufficiency', () => {
  it('returns sufficient=true when maxScore >= threshold', () => {
    const chunks = makeChunks([0.80, 0.65, 0.45]);
    const result = evaluateRagSufficiency(chunks, 0.35);
    expect(result.sufficient).toBe(true);
    expect(result.maxScore).toBeCloseTo(0.80);
  });

  it('returns sufficient=false when all scores below threshold', () => {
    const chunks = makeChunks([0.20, 0.15, 0.10]);
    const result = evaluateRagSufficiency(chunks, 0.35);
    expect(result.sufficient).toBe(false);
    expect(result.maxScore).toBeCloseTo(0.20);
  });

  it('returns sufficient=false when chunk list is empty', () => {
    const result = evaluateRagSufficiency([], 0.35);
    expect(result.sufficient).toBe(false);
    expect(result.maxScore).toBe(0);
  });

  it('returns sufficient=true when maxScore equals threshold exactly', () => {
    const chunks = makeChunks([0.35]);
    const result = evaluateRagSufficiency(chunks, 0.35);
    expect(result.sufficient).toBe(true);
  });

  it('handles chunks without score field (treats as 0)', () => {
    const chunks = [
      { id: 0, content: 'no score', score: undefined as unknown as number, metadata: {}, collection: 'declarative_memory' },
    ];
    const result = evaluateRagSufficiency(chunks, 0.35);
    expect(result.sufficient).toBe(false);
    expect(result.maxScore).toBe(0);
  });

  it('uses default threshold of 0.35 when not specified', () => {
    const chunks = makeChunks([0.40]);
    const result = evaluateRagSufficiency(chunks);
    expect(result.sufficient).toBe(true);
  });

  it('returns sufficient=false when threshold not specified and score below 0.35', () => {
    const chunks = makeChunks([0.30]);
    const result = evaluateRagSufficiency(chunks);
    expect(result.sufficient).toBe(false);
  });
});

// ── buildAttributionContext ──────────────────────────────────────────────────

describe('buildAttributionContext', () => {
  it('produces [DOCUMENTO N] markers for rag chunks', () => {
    const chunks = makeChunks([0.75]);
    const context = buildAttributionContext(chunks, []);
    expect(context).toContain('[DOCUMENTO 1]');
    expect(context).toContain('Chunk content 0');
  });

  it('produces [WEB N] markers for web results', () => {
    const web = makeWebResults(2);
    const context = buildAttributionContext([], web);
    expect(context).toContain('[WEB 1]');
    expect(context).toContain('https://example0.com/page');
    expect(context).toContain('Result 0');
  });

  it('combines both RAG and web sections when both present', () => {
    const chunks = makeChunks([0.70, 0.60]);
    const web = makeWebResults(2);
    const context = buildAttributionContext(chunks, web);
    expect(context).toContain('[DOCUMENTO 1]');
    expect(context).toContain('[WEB 1]');
    expect(context).toContain('Chunk content 0');
    expect(context).toContain('Result 0');
  });

  it('returns empty string when both inputs are empty', () => {
    const context = buildAttributionContext([], []);
    expect(context.trim()).toBe('');
  });

  it('includes snippet in web section when present', () => {
    const web = makeWebResults(1);
    const context = buildAttributionContext([], web);
    expect(context).toContain('Snippet for result 0');
  });

  it('does not include userId in output (privacy)', () => {
    const chunks = [
      {
        id: 0,
        content: 'private data',
        score: 0.9,
        metadata: { attachment_id: 1, user_id: 42, source: 'doc.pdf' },
        collection: 'declarative_memory',
      },
    ];
    const web = makeWebResults(1);
    const context = buildAttributionContext(chunks, web);
    expect(context).not.toContain('user_id');
    expect(context).not.toContain('"42"');
    expect(context).not.toContain('42');
  });

  it('truncates extremely long chunk content to avoid token bloat', () => {
    const longContent = 'a'.repeat(5000);
    const chunks = [
      { id: 0, content: longContent, score: 0.9, metadata: {}, collection: 'declarative_memory' },
    ];
    const context = buildAttributionContext(chunks, []);
    // Should not contain full 5000 char string
    expect(context.length).toBeLessThan(4500);
  });
});

// ── triggerWebFallback ───────────────────────────────────────────────────────

describe('triggerWebFallback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns web results from performWebSearch', async () => {
    const { performWebSearch } = await import('../../../services/WebSearchService.js');
    vi.mocked(performWebSearch).mockResolvedValue({
      query: 'capitale australia',
      results: [
        { title: 'Canberra', url: 'https://en.wikipedia.org/wiki/Canberra', snippet: 'Capital city', source: 'en.wikipedia.org' },
      ],
      searchPerformed: true,
    });

    const { triggerWebFallback } = await import('./RagWebFallback.js');
    const result = await triggerWebFallback('Capitale dell\'Australia', [], 5);
    expect(result.webResults).toHaveLength(1);
    expect(result.webResults[0].title).toBe('Canberra');
  });

  it('returns empty webResults when performWebSearch fails', async () => {
    const { performWebSearch } = await import('../../../services/WebSearchService.js');
    vi.mocked(performWebSearch).mockRejectedValue(new Error('Network error'));

    const { triggerWebFallback } = await import('./RagWebFallback.js');
    const result = await triggerWebFallback('query', [], 5);
    expect(result.webResults).toHaveLength(0);
  });

  it('limits results to maxResults', async () => {
    const { performWebSearch } = await import('../../../services/WebSearchService.js');
    vi.mocked(performWebSearch).mockResolvedValue({
      query: 'test',
      results: makeWebResults(10).map(r => ({ title: r.title, url: r.url, snippet: r.snippet, source: r.source })),
      searchPerformed: true,
    });

    const { triggerWebFallback } = await import('./RagWebFallback.js');
    const result = await triggerWebFallback('test', [], 3);
    expect(result.webResults.length).toBeLessThanOrEqual(3);
  });

  it('does not include userId in search query (privacy)', async () => {
    const { performWebSearch } = await import('../../../services/WebSearchService.js');
    let capturedQuery = '';
    vi.mocked(performWebSearch).mockImplementation(async (q) => {
      capturedQuery = q;
      return { query: q, results: [], searchPerformed: false };
    });

    const { triggerWebFallback } = await import('./RagWebFallback.js');
    await triggerWebFallback('what is k8s', [], 5);
    // The query sent to search engine must not contain numeric user IDs
    expect(capturedQuery).not.toMatch(/user_?id\s*[:=]\s*\d+/i);
  });
});
