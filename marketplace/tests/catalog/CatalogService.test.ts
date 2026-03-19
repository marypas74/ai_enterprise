import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogService } from '../../src/catalog/CatalogService.js';

describe('CatalogService', () => {
  const mockPool = {
    execute: vi.fn(),
  } as any;

  let service: CatalogService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CatalogService(mockPool);
  });

  describe('list()', () => {
    it('returns paginated results with defaults', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'skill-a', type: 'skill', tier: 'tier1' },
          { id: 2, name: 'agent-b', type: 'agent', tier: 'tier2' },
        ]]);

      const result = await service.list({});

      expect(result).toEqual({
        items: [
          { id: 1, name: 'skill-a', type: 'skill', tier: 'tier1' },
          { id: 2, name: 'agent-b', type: 'agent', tier: 'tier2' },
        ],
        total: 2,
        page: 1,
        limit: 20,
      });
    });

    it('filters by type', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'skill-a', type: 'skill', tier: 'tier1' },
        ]]);

      await service.list({ type: 'skill' });

      const countCall = mockPool.execute.mock.calls[0];
      expect(countCall[0]).toContain('type = ?');
      expect(countCall[1]).toContain('skill');
    });

    it('filters by tier', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'skill-a', type: 'skill', tier: 'tier1' },
        ]]);

      await service.list({ tier: 'tier1' });

      const countCall = mockPool.execute.mock.calls[0];
      expect(countCall[0]).toContain('tier = ?');
      expect(countCall[1]).toContain('tier1');
    });

    it('filters by category', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'skill-a', type: 'skill', category: 'devtools' },
        ]]);

      await service.list({ category: 'devtools' });

      const countCall = mockPool.execute.mock.calls[0];
      expect(countCall[0]).toContain('category = ?');
      expect(countCall[1]).toContain('devtools');
    });

    it('filters by search term', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'git-helper', description: 'Git utilities' },
        ]]);

      await service.list({ search: 'git' });

      const countCall = mockPool.execute.mock.calls[0];
      expect(countCall[0]).toContain('name LIKE ?');
      expect(countCall[0]).toContain('description LIKE ?');
      expect(countCall[1]).toContain('%git%');
    });

    it('applies multiple filters simultaneously', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'skill-a', type: 'skill', tier: 'tier1', category: 'devtools' },
        ]]);

      await service.list({ type: 'skill', tier: 'tier1', category: 'devtools' });

      const countCall = mockPool.execute.mock.calls[0];
      expect(countCall[0]).toContain('type = ?');
      expect(countCall[0]).toContain('tier = ?');
      expect(countCall[0]).toContain('category = ?');
    });

    it('respects custom pagination', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 50 }]])
        .mockResolvedValueOnce([[{ id: 11, name: 'item-11' }]]);

      const result = await service.list({ page: 2, limit: 10 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(50);

      const dataCall = mockPool.execute.mock.calls[1];
      expect(dataCall[1]).toContain(10); // limit
      expect(dataCall[1]).toContain(10); // offset = (2-1) * 10
    });

    it('returns empty items when no results', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      const result = await service.list({});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getById()', () => {
    it('returns item when found', async () => {
      const item = { id: 1, name: 'skill-a', type: 'skill', tier: 'tier1' };
      mockPool.execute.mockResolvedValueOnce([[item]]);

      const result = await service.getById(1);

      expect(result).toEqual(item);
      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        [1],
      );
    });

    it('returns null when item not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      const result = await service.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('search()', () => {
    it('returns empty array (stub)', async () => {
      const result = await service.search('anything');

      expect(result).toEqual([]);
    });
  });
});
