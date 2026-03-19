import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QdrantClient } from '../../src/qdrant/QdrantClient.js';

describe('QdrantClient', () => {
  let client: QdrantClient;
  const qdrantUrl = 'http://localhost:6333';

  beforeEach(() => {
    client = new QdrantClient(qdrantUrl);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable()', () => {
    it('returns true when healthz responds ok', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const result = await client.isAvailable();

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        `${qdrantUrl}/healthz`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when healthz responds not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

      const result = await client.isAvailable();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));

      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('ensureCollection()', () => {
    it('creates collection if not exists (404)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      await client.ensureCollection('test_collection', 384);

      expect(fetch).toHaveBeenCalledTimes(2);

      // First call: GET to check existence
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        `${qdrantUrl}/collections/test_collection`,
        expect.objectContaining({ method: 'GET' }),
      );

      // Second call: PUT to create
      const createCall = vi.mocked(fetch).mock.calls[1];
      expect(createCall[0]).toBe(`${qdrantUrl}/collections/test_collection`);
      const createInit = createCall[1] as RequestInit;
      expect(createInit.method).toBe('PUT');
      const body = JSON.parse(createInit.body as string);
      expect(body.vectors.size).toBe(384);
      expect(body.vectors.distance).toBe('Cosine');
    });

    it('does nothing if collection already exists', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      await client.ensureCollection('test_collection', 384);

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertPoints()', () => {
    it('sends correct payload to Qdrant API', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const points = [
        { id: 'point-1', vector: [0.1, 0.2, 0.3], payload: { name: 'test' } },
        { id: 'point-2', vector: [0.4, 0.5, 0.6], payload: { name: 'test2' } },
      ];

      await client.upsertPoints('my_collection', points);

      expect(fetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/my_collection/points`,
        expect.objectContaining({ method: 'PUT' }),
      );

      const callInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.points).toEqual(points);
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(
        client.upsertPoints('col', [{ id: '1', vector: [0.1], payload: {} }]),
      ).rejects.toThrow('Qdrant upsert failed');
    });
  });

  describe('search()', () => {
    it('sends query vector and returns scored results', async () => {
      const mockResults = [
        { id: 'r1', score: 0.95, payload: { name: 'result1' } },
        { id: 'r2', score: 0.80, payload: { name: 'result2' } },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: mockResults }),
      } as unknown as Response);

      const results = await client.search('my_collection', [0.1, 0.2], 5);

      expect(results).toEqual(mockResults);

      const callInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(callInit.method).toBe('POST');
      const body = JSON.parse(callInit.body as string);
      expect(body.vector).toEqual([0.1, 0.2]);
      expect(body.limit).toBe(5);
    });

    it('passes filter when provided', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: [] }),
      } as unknown as Response);

      const filter = { must: [{ key: 'type', match: { value: 'skill' } }] };
      await client.search('col', [0.1], 10, filter);

      const callInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.filter).toEqual(filter);
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(
        client.search('col', [0.1], 5),
      ).rejects.toThrow('Qdrant search failed');
    });
  });

  describe('deleteByFilter()', () => {
    it('sends filter payload', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const filter = { must: [{ key: 'source_id', match: { value: 'abc' } }] };
      await client.deleteByFilter('my_collection', filter);

      expect(fetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/my_collection/points/delete`,
        expect.objectContaining({ method: 'POST' }),
      );

      const callInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.filter).toEqual(filter);
    });

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const filter = { must: [] };
      await expect(
        client.deleteByFilter('col', filter),
      ).rejects.toThrow('Qdrant delete failed');
    });
  });
});
