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
  detectNoInfoResponse,
  buildWebSummary,
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

// ── detectNoInfoResponse ─────────────────────────────────────────────────────
// TDD RED phase — T1 HOTFIX 2.1.86
// These tests MUST fail before detectNoInfoResponse is implemented.

describe('detectNoInfoResponse', () => {
  // IT diretti — 4 positivi
  it('IT: detects "non trovo questa informazione"', () => {
    expect(detectNoInfoResponse('Purtroppo non trovo questa informazione nel documento.')).toBe(true);
  });

  it('IT: detects "il documento non contiene"', () => {
    expect(detectNoInfoResponse('Il documento non contiene dettagli su questo argomento.')).toBe(true);
  });

  it('IT: detects "non è presente nel documento"', () => {
    expect(detectNoInfoResponse('Questa notizia non è presente nel documento fornito.')).toBe(true);
  });

  it('IT: detects "purtroppo" prefix pattern', () => {
    expect(detectNoInfoResponse('Purtroppo questo non è il tema giusto per la tua domanda.')).toBe(true);
  });

  // EN diretti — 4 positivi
  it('EN: detects "I don\'t know"', () => {
    expect(detectNoInfoResponse("I don't know the answer to that question.")).toBe(true);
  });

  it('EN: detects "no information about"', () => {
    expect(detectNoInfoResponse('There is no information about this topic in the document.')).toBe(true);
  });

  it('EN: detects "document does not contain"', () => {
    expect(detectNoInfoResponse('The document does not contain any reference to that.')).toBe(true);
  });

  it('EN: detects "I\'m sorry, but"', () => {
    expect(detectNoInfoResponse("I'm sorry, but I cannot find that information.")).toBe(true);
  });

  // Negativi — 3 casi simili che NON devono essere rilevati
  it('negative: "non trovo dubbi" should be FALSE', () => {
    expect(detectNoInfoResponse('Non trovo dubbi nella tua domanda, posso rispondere subito.')).toBe(false);
  });

  it('negative: "Trovo molte info" should be FALSE', () => {
    expect(detectNoInfoResponse('Trovo molte informazioni utili nel documento allegato.')).toBe(false);
  });

  it('negative: "I know perfectly" should be FALSE', () => {
    expect(detectNoInfoResponse('I know perfectly well what you are asking about.')).toBe(false);
  });

  // Edge case
  it('edge: "purtroppo questo non è il tema giusto" should be TRUE', () => {
    expect(detectNoInfoResponse('Purtroppo questo non è il tema giusto per rispondere alla tua domanda.')).toBe(true);
  });
});

// ── buildWebSummary ──────────────────────────────────────────────────────────
// TDD RED phase — T1 HOTFIX 2.1.86

describe('buildWebSummary', () => {
  it('produces numbered Fonte entries for each result', () => {
    const results: WebResult[] = [
      { title: 'Canberra Facts', url: 'https://wiki.org/canberra', snippet: 'Capital of Australia.' },
      { title: 'Australia Guide', url: 'https://example.com/australia', snippet: 'Travel guide.' },
    ];
    const summary = buildWebSummary(results);
    expect(summary).toContain('**Fonte 1**');
    expect(summary).toContain('**Fonte 2**');
    expect(summary).toContain('[Canberra Facts](https://wiki.org/canberra)');
    expect(summary).toContain('Capital of Australia.');
  });

  it('returns empty string for empty array', () => {
    expect(buildWebSummary([])).toBe('');
  });

  it('includes URL as markdown link', () => {
    const results: WebResult[] = [
      { title: 'Test', url: 'https://test.com', snippet: 'A snippet.' },
    ];
    const summary = buildWebSummary(results);
    expect(summary).toContain('[Test](https://test.com)');
  });
});

// ── Edge tests — DEBT-87-B branch coverage ──────────────────────────────────

describe('triggerWebFallback edge: empty snippet', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns results with empty snippet when snippet is missing', async () => {
    const { performWebSearch } = await import('../../../services/WebSearchService.js');
    vi.mocked(performWebSearch).mockResolvedValue({
      query: 'q',
      results: [{ title: 'T', url: 'https://x.com', snippet: '', source: 'x.com' }],
      searchPerformed: true,
    });
    const { triggerWebFallback } = await import('./RagWebFallback.js');
    const result = await triggerWebFallback('q', [], 5);
    expect(result.webResults[0].snippet).toBe('');
  });
});

describe('truncateContent edge: word boundary', () => {
  // Access via buildAttributionContext with a chunk whose content has word boundary near limit
  it('truncates at word boundary when last space is within 80% of limit', () => {
    // 1200 char limit. Content = 1250 chars. Last space near position 1194 → word-boundary cut.
    const wordBoundaryContent = 'hello '.repeat(200) + 'finalword'; // 1200 + 9 = 1209 chars, last space at 1200
    const chunks = [{ id: 0, content: wordBoundaryContent, score: 0.9, metadata: {}, collection: 'declarative_memory' }];
    const ctx = buildAttributionContext(chunks, []);
    // Should end with ellipsis (truncated since content > 1200)
    expect(ctx).toContain('…');
    expect(ctx.length).toBeLessThan(wordBoundaryContent.length + 100);
  });

  it('truncates hard when space position is less than 80% of limit', () => {
    // Create content where the last space is at position < 960 (80% of 1200)
    const noSpaceBlock = 'a'.repeat(1201); // no spaces at all
    const chunks = [{ id: 0, content: noSpaceBlock, score: 0.9, metadata: {}, collection: 'declarative_memory' }];
    const ctx = buildAttributionContext(chunks, []);
    expect(ctx).toContain('…');
  });
});

// Mock database module for readSettingCached tests
vi.mock('../../../database/index.js', () => ({
  findOne: vi.fn(),
}));

describe('readSettingCached: cache behaviour', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('cache hit: second call returns same value without re-querying DB', async () => {
    const { findOne: mockFindOne } = await import('../../../database/index.js');
    vi.mocked(mockFindOne).mockResolvedValue({ setting_value: 'cached_val' } as never);

    const { readSettingCached } = await import('./RagWebFallback.js');
    const uniqueKey = `test_cache_${Date.now()}`;
    const mockDb = {};

    const first = await readSettingCached(mockDb, uniqueKey, 'default');
    const second = await readSettingCached(mockDb, uniqueKey, 'default');

    expect(first).toBe('cached_val');
    expect(second).toBe('cached_val');
    // findOne called only once (second hit is from cache)
    expect(vi.mocked(mockFindOne)).toHaveBeenCalledTimes(1);
  });

  it('cache miss on DB error: returns default value', async () => {
    const { findOne: mockFindOne } = await import('../../../database/index.js');
    vi.mocked(mockFindOne).mockRejectedValue(new Error('DB down'));

    const { readSettingCached } = await import('./RagWebFallback.js');
    const uniqueKey2 = `test_cache_err_${Date.now()}`;

    const result = await readSettingCached({}, uniqueKey2, 'fallback_default');
    expect(result).toBe('fallback_default');
  });
});
