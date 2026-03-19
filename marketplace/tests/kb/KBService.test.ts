import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KBService } from '../../src/kb/KBService.js';
import type { QdrantClient } from '../../src/qdrant/QdrantClient.js';

describe('KBService', () => {
  const mockPool = {
    execute: vi.fn(),
  } as any;

  const mockQdrant = {
    ensureCollection: vi.fn(),
    upsertPoints: vi.fn(),
    search: vi.fn(),
    deleteByFilter: vi.fn(),
  } as unknown as QdrantClient;

  const mockFetch = vi.fn();
  const backendUrl = 'http://backend:3000';
  const serviceTokenSecret = 'test-secret';

  let service: KBService;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as any;
    service = new KBService(mockPool, mockQdrant, backendUrl, serviceTokenSecret);
  });

  describe('indexDocument()', () => {
    it('chunks content, generates embeddings, upserts into Qdrant, and creates DB row', async () => {
      const content = 'First paragraph of content.\n\nSecond paragraph of content.';
      const embeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];

      // Mock embedding API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings }),
      });

      // Mock DB insert - returns doc ID
      mockPool.execute.mockResolvedValueOnce([{ insertId: 42 }]);

      const docId = await service.indexDocument(1, 'test-doc.txt', content);

      expect(docId).toBe(42);

      // Verify embeddings API was called
      expect(mockFetch).toHaveBeenCalledWith(
        `${backendUrl}/api/embeddings`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        }),
      );

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.texts).toHaveLength(2);

      // Verify Qdrant collection ensured
      expect(mockQdrant.ensureCollection).toHaveBeenCalledWith('competency_kb', 3);

      // Verify Qdrant upsert with correct payload
      expect(mockQdrant.upsertPoints).toHaveBeenCalledWith(
        'competency_kb',
        expect.arrayContaining([
          expect.objectContaining({
            vector: [0.1, 0.2, 0.3],
            payload: expect.objectContaining({
              installation_id: 1,
              chunk_index: 0,
              document_name: 'test-doc.txt',
            }),
          }),
          expect.objectContaining({
            vector: [0.4, 0.5, 0.6],
            payload: expect.objectContaining({
              installation_id: 1,
              chunk_index: 1,
              document_name: 'test-doc.txt',
            }),
          }),
        ]),
      );

      // Verify DB row insert
      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO marketplace_kb_documents'),
        expect.arrayContaining([1, 'test-doc.txt', 2]),
      );
    });

    it('handles long content by splitting into max 500 char chunks', async () => {
      const longParagraph = 'A'.repeat(600);
      const content = longParagraph;
      const embeddings = [[0.1, 0.2], [0.3, 0.4]];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings }),
      });
      mockPool.execute.mockResolvedValueOnce([{ insertId: 1 }]);

      await service.indexDocument(1, 'long-doc.txt', content);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      for (const text of fetchBody.texts) {
        expect(text.length).toBeLessThanOrEqual(500);
      }
    });

    it('throws when embedding API fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        service.indexDocument(1, 'fail.txt', 'Some content'),
      ).rejects.toThrow('Embedding generation failed');
    });
  });

  describe('removeDocument()', () => {
    it('deletes from Qdrant by installation_id filter and deletes DB row', async () => {
      // Mock DB lookup for the doc
      mockPool.execute
        .mockResolvedValueOnce([[{ id: 10, installation_id: 5, document_name: 'doc.txt' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await service.removeDocument(10);

      // Verify Qdrant delete by filter
      expect(mockQdrant.deleteByFilter).toHaveBeenCalledWith(
        'competency_kb',
        {
          must: [
            { key: 'installation_id', match: { value: 5 } },
            { key: 'document_name', match: { value: 'doc.txt' } },
          ],
        },
      );

      // Verify DB row deletion
      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM marketplace_kb_documents'),
        [10],
      );
    });

    it('throws when document not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      await expect(service.removeDocument(999)).rejects.toThrow('Document not found');
    });
  });

  describe('listDocuments()', () => {
    it('returns docs for a given installation_id from DB', async () => {
      const docs = [
        { id: 1, installation_id: 3, document_name: 'a.txt', chunk_count: 4, indexed_at: '2026-01-01' },
        { id: 2, installation_id: 3, document_name: 'b.txt', chunk_count: 2, indexed_at: '2026-01-02' },
      ];
      mockPool.execute.mockResolvedValueOnce([docs]);

      const result = await service.listDocuments(3);

      expect(result).toEqual(docs);
      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE installation_id = ?'),
        [3],
      );
    });

    it('returns empty array when no documents exist', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      const result = await service.listDocuments(99);

      expect(result).toEqual([]);
    });
  });

  describe('searchKB()', () => {
    it('generates query embedding and searches Qdrant with installation_id filter', async () => {
      const queryEmbedding = [0.1, 0.2, 0.3];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [queryEmbedding] }),
      });

      const searchResults = [
        { id: 'pt-1', score: 0.95, payload: { content: 'result chunk', installation_id: 1 } },
      ];
      (mockQdrant.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce(searchResults);

      const results = await service.searchKB(1, 'test query', 5);

      expect(results).toEqual(searchResults);

      // Verify embedding was generated for query
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.texts).toEqual(['test query']);

      // Verify Qdrant search with filter
      expect(mockQdrant.search).toHaveBeenCalledWith(
        'competency_kb',
        queryEmbedding,
        5,
        {
          must: [{ key: 'installation_id', match: { value: 1 } }],
        },
      );
    });

    it('uses default limit of 5', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1]] }),
      });
      (mockQdrant.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await service.searchKB(1, 'test');

      expect(mockQdrant.search).toHaveBeenCalledWith(
        'competency_kb',
        [0.1],
        5,
        expect.any(Object),
      );
    });
  });
});
