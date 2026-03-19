import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstallService } from '../../src/install/InstallService.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    backendUrl: 'http://backend:3000',
    jwtSecret: 'test-secret-key',
  },
}));

// Mock serviceToken
vi.mock('../../src/auth/serviceToken.js', () => ({
  generateServiceToken: vi.fn(() => 'mock-service-token'),
}));

describe('InstallService', () => {
  const mockPool = {
    execute: vi.fn(),
  } as any;

  let service: InstallService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InstallService(mockPool);
  });

  describe('install()', () => {
    const catalogItem = {
      id: 1,
      name: 'test-skill',
      display_name: 'Test Skill',
      type: 'skill',
      category: 'development-tools',
      version: '1.0.0',
      metadata: '{}',
    };

    it('installs a skill with status installed and calls backend POST /api/skills', async () => {
      // Count installations: 0
      mockPool.execute.mockResolvedValueOnce([[{ count: 0 }]]);
      // Get catalog item
      mockPool.execute.mockResolvedValueOnce([[catalogItem]]);
      // Check not already installed
      mockPool.execute.mockResolvedValueOnce([[]]);
      // Insert installation row
      mockPool.execute.mockResolvedValueOnce([{ insertId: 10 }]);
      // Update target_id after backend call
      mockPool.execute.mockResolvedValueOnce([{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 42 } }),
      });

      const result = await service.install(1, 100);

      expect(result.status).toBe('installed');
      expect(result.installationId).toBe(10);

      // Verify backend was called
      expect(mockFetch).toHaveBeenCalledWith(
        'http://backend:3000/api/skills',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-service-token',
          }),
        }),
      );
    });

    it('installs an agent with status installed (same as skill)', async () => {
      const agentItem = { ...catalogItem, id: 2, type: 'agent', name: 'test-agent' };

      mockPool.execute.mockResolvedValueOnce([[{ count: 0 }]]);
      mockPool.execute.mockResolvedValueOnce([[agentItem]]);
      mockPool.execute.mockResolvedValueOnce([[]]);
      mockPool.execute.mockResolvedValueOnce([{ insertId: 11 }]);
      mockPool.execute.mockResolvedValueOnce([{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 43 } }),
      });

      const result = await service.install(2, 100);

      expect(result.status).toBe('installed');
    });

    it('installs MCP with status pending_approval and creates approval request', async () => {
      const mcpItem = { ...catalogItem, id: 3, type: 'mcp', name: 'test-mcp' };

      mockPool.execute.mockResolvedValueOnce([[{ count: 0 }]]);
      mockPool.execute.mockResolvedValueOnce([[mcpItem]]);
      mockPool.execute.mockResolvedValueOnce([[]]);
      // Insert installation row
      mockPool.execute.mockResolvedValueOnce([{ insertId: 12 }]);
      // Insert approval request row
      mockPool.execute.mockResolvedValueOnce([{ insertId: 5 }]);

      const result = await service.install(3, 100);

      expect(result.status).toBe('pending_approval');
      expect(result.installationId).toBe(12);
      expect(mockFetch).not.toHaveBeenCalled();

      // Verify approval request was inserted
      const approvalCall = mockPool.execute.mock.calls[4];
      expect(approvalCall[0]).toContain('marketplace_approval_requests');
    });

    it('installs hook with status pending_approval', async () => {
      const hookItem = { ...catalogItem, id: 4, type: 'hook', name: 'test-hook' };

      mockPool.execute.mockResolvedValueOnce([[{ count: 0 }]]);
      mockPool.execute.mockResolvedValueOnce([[hookItem]]);
      mockPool.execute.mockResolvedValueOnce([[]]);
      mockPool.execute.mockResolvedValueOnce([{ insertId: 13 }]);
      mockPool.execute.mockResolvedValueOnce([{ insertId: 6 }]);

      const result = await service.install(4, 100);

      expect(result.status).toBe('pending_approval');
    });

    it('throws error when max 50 installations reached', async () => {
      mockPool.execute.mockResolvedValueOnce([[{ count: 50 }]]);

      await expect(service.install(1, 100)).rejects.toThrow(
        'Maximum installation limit (50) reached',
      );
    });

    it('throws error when catalog item not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[{ count: 0 }]]);
      mockPool.execute.mockResolvedValueOnce([[]]);

      await expect(service.install(999, 100)).rejects.toThrow('Catalog item not found');
    });

    it('throws error when already installed by user', async () => {
      mockPool.execute.mockResolvedValueOnce([[{ count: 0 }]]);
      mockPool.execute.mockResolvedValueOnce([[catalogItem]]);
      mockPool.execute.mockResolvedValueOnce([[{ id: 10 }]]);

      await expect(service.install(1, 100)).rejects.toThrow('already installed');
    });
  });

  describe('uninstall()', () => {
    it('removes installation record and calls backend DELETE', async () => {
      const installation = {
        id: 10,
        installed_by: 100,
        target_id: 42,
        target_type: 'skill',
        catalog_item_id: 1,
      };

      // Get installation
      mockPool.execute.mockResolvedValueOnce([[installation]]);
      // Delete installation
      mockPool.execute.mockResolvedValueOnce([{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await service.uninstall(10, 100);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://backend:3000/api/skills/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-service-token',
          }),
        }),
      );

      // Verify delete was called
      const deleteCall = mockPool.execute.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE');
      expect(deleteCall[1]).toContain(10);
    });

    it('skips backend DELETE when no target_id', async () => {
      const installation = {
        id: 12,
        installed_by: 100,
        target_id: null,
        target_type: 'mcp_server',
        catalog_item_id: 3,
      };

      mockPool.execute.mockResolvedValueOnce([[installation]]);
      mockPool.execute.mockResolvedValueOnce([{}]);

      await service.uninstall(12, 100);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws error when installation not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      await expect(service.uninstall(999, 100)).rejects.toThrow('Installation not found');
    });

    it('throws error when user does not own installation', async () => {
      // Query filters by installed_by, so wrong user returns empty result
      mockPool.execute.mockResolvedValueOnce([[]]);

      await expect(service.uninstall(10, 100)).rejects.toThrow('Installation not found');
    });
  });

  describe('listByUser()', () => {
    it('returns paginated results', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([
          [
            { id: 1, catalog_item_id: 10, name: 'skill-a', display_name: 'Skill A', type: 'skill' },
            { id: 2, catalog_item_id: 11, name: 'agent-b', display_name: 'Agent B', type: 'agent' },
          ],
        ]);

      const result = await service.listByUser(100, 1, 20);

      expect(result).toEqual({
        items: [
          { id: 1, catalog_item_id: 10, name: 'skill-a', display_name: 'Skill A', type: 'skill' },
          { id: 2, catalog_item_id: 11, name: 'agent-b', display_name: 'Agent B', type: 'agent' },
        ],
        total: 2,
        page: 1,
        limit: 20,
      });

      // Verify query joins catalog items
      const dataCall = mockPool.execute.mock.calls[1];
      expect(dataCall[0]).toContain('marketplace_catalog_items');
      expect(dataCall[0]).toContain('installed_by = ?');
    });

    it('applies correct pagination offset', async () => {
      mockPool.execute
        .mockResolvedValueOnce([[{ total: 30 }]])
        .mockResolvedValueOnce([[]]);

      const result = await service.listByUser(100, 3, 10);

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);

      const dataCall = mockPool.execute.mock.calls[1];
      expect(dataCall[1]).toContain(10); // limit
      expect(dataCall[1]).toContain(20); // offset = (3-1) * 10
    });
  });

  describe('getInstallation()', () => {
    it('returns installation when found', async () => {
      const installation = { id: 10, catalog_item_id: 1, installed_by: 100, status: 'installed' };
      mockPool.execute.mockResolvedValueOnce([[installation]]);

      const result = await service.getInstallation(10);

      expect(result).toEqual(installation);
    });

    it('returns null when not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      const result = await service.getInstallation(999);

      expect(result).toBeNull();
    });
  });
});
