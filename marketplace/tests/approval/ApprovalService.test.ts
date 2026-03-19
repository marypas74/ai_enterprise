import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalService } from '../../src/approval/ApprovalService.js';

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

describe('ApprovalService', () => {
  const mockPool = {
    execute: vi.fn(),
  } as any;

  let service: ApprovalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApprovalService(mockPool);
  });

  describe('approve()', () => {
    const pendingRequest = {
      id: 1,
      catalog_item_id: 10,
      requested_by: 100,
      status: 'pending',
      admin_notes: null,
      resolved_at: null,
      resolved_by: null,
    };

    const catalogItem = {
      id: 10,
      source_id: 'src-10',
      name: 'test-mcp-server',
      display_name: 'Test MCP Server',
      type: 'mcp',
      category: 'development-tools',
      description: 'A test MCP server',
      metadata: '{}',
      version: '1.0.0',
      tier: 'free',
    };

    const installation = {
      id: 20,
      catalog_item_id: 10,
      installed_by: 100,
      status: 'pending_approval',
      target_type: 'mcp_server',
      target_id: null,
      installed_version: '1.0.0',
    };

    it('updates approval_requests status to approved, sets resolved_at/resolved_by, triggers installation completion', async () => {
      // findOne: get approval request
      mockPool.execute.mockResolvedValueOnce([[pendingRequest]]);
      // execute: update approval request status
      mockPool.execute.mockResolvedValueOnce([{}]);
      // findOne: get catalog item
      mockPool.execute.mockResolvedValueOnce([[catalogItem]]);
      // findOne: get installation
      mockPool.execute.mockResolvedValueOnce([[installation]]);
      // Backend POST response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 55 } }),
      });
      // execute: update installation status + target_id
      mockPool.execute.mockResolvedValueOnce([{}]);

      await service.approve(1, 5, 'Looks good');

      // Verify approval request was updated
      const updateApprovalCall = mockPool.execute.mock.calls[1];
      expect(updateApprovalCall[0]).toContain('approved');
      expect(updateApprovalCall[0]).toContain('resolved_at');
      expect(updateApprovalCall[0]).toContain('resolved_by');
      expect(updateApprovalCall[1]).toContain(5); // adminId
      expect(updateApprovalCall[1]).toContain(1); // requestId

      // Verify backend was called to create the MCP server
      expect(mockFetch).toHaveBeenCalledWith(
        'http://backend:3000/api/skills',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-service-token',
          }),
        }),
      );

      // Verify installation was updated with status='installed' and target_id
      const updateInstallCall = mockPool.execute.mock.calls[4];
      expect(updateInstallCall[0]).toContain('installed');
      expect(updateInstallCall[0]).toContain('target_id');
      expect(updateInstallCall[1]).toContain(55); // target_id from backend
      expect(updateInstallCall[1]).toContain(5);  // approved_by
      expect(updateInstallCall[1]).toContain(20); // installation id
    });

    it('approve without notes works', async () => {
      mockPool.execute.mockResolvedValueOnce([[pendingRequest]]);
      mockPool.execute.mockResolvedValueOnce([{}]);
      mockPool.execute.mockResolvedValueOnce([[catalogItem]]);
      mockPool.execute.mockResolvedValueOnce([[installation]]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 56 } }),
      });
      mockPool.execute.mockResolvedValueOnce([{}]);

      await expect(service.approve(1, 5)).resolves.toBeUndefined();
    });

    it('throws error when approval request not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      await expect(service.approve(999, 5)).rejects.toThrow('Approval request not found');
    });

    it('throws error when approval request is already resolved', async () => {
      const resolvedRequest = { ...pendingRequest, status: 'approved' };
      mockPool.execute.mockResolvedValueOnce([[resolvedRequest]]);

      await expect(service.approve(1, 5)).rejects.toThrow('already been resolved');
    });
  });

  describe('reject()', () => {
    const pendingRequest = {
      id: 2,
      catalog_item_id: 11,
      requested_by: 101,
      status: 'pending',
      admin_notes: null,
      resolved_at: null,
      resolved_by: null,
    };

    it('updates approval_requests status to rejected with admin_notes, sets resolved_at/resolved_by, updates installation status to failed', async () => {
      // findOne: get approval request
      mockPool.execute.mockResolvedValueOnce([[pendingRequest]]);
      // execute: update approval request status
      mockPool.execute.mockResolvedValueOnce([{}]);
      // execute: update installation status to 'failed'
      mockPool.execute.mockResolvedValueOnce([{}]);

      await service.reject(2, 5, 'Security concern');

      // Verify approval request was updated to rejected
      const updateApprovalCall = mockPool.execute.mock.calls[1];
      expect(updateApprovalCall[0]).toContain('rejected');
      expect(updateApprovalCall[0]).toContain('resolved_at');
      expect(updateApprovalCall[0]).toContain('resolved_by');
      expect(updateApprovalCall[0]).toContain('admin_notes');
      expect(updateApprovalCall[1]).toContain('Security concern');
      expect(updateApprovalCall[1]).toContain(5); // adminId
      expect(updateApprovalCall[1]).toContain(2); // requestId

      // Verify installation status updated to 'failed'
      const updateInstallCall = mockPool.execute.mock.calls[2];
      expect(updateInstallCall[0]).toContain('failed');
      expect(updateInstallCall[0]).toContain('marketplace_installations');
      expect(updateInstallCall[1]).toContain(11); // catalog_item_id
      expect(updateInstallCall[1]).toContain(101); // requested_by

      // No backend call for rejection
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws error when approval request not found', async () => {
      mockPool.execute.mockResolvedValueOnce([[]]);

      await expect(service.reject(999, 5, 'No good')).rejects.toThrow('Approval request not found');
    });

    it('throws error when approval request is already resolved', async () => {
      const resolvedRequest = { ...pendingRequest, status: 'rejected' };
      mockPool.execute.mockResolvedValueOnce([[resolvedRequest]]);

      await expect(service.reject(2, 5, 'No good')).rejects.toThrow('already been resolved');
    });
  });

  describe('listPending()', () => {
    it('returns only pending requests with pagination', async () => {
      const pendingItems = [
        {
          id: 1,
          catalog_item_id: 10,
          requested_by: 100,
          status: 'pending',
          name: 'test-mcp',
          display_name: 'Test MCP',
          type: 'mcp',
          category: 'development-tools',
          requested_by_name: 'john',
        },
        {
          id: 2,
          catalog_item_id: 11,
          requested_by: 101,
          status: 'pending',
          name: 'test-hook',
          display_name: 'Test Hook',
          type: 'hook',
          category: 'security',
          requested_by_name: 'jane',
        },
      ];

      // Count query
      mockPool.execute.mockResolvedValueOnce([[{ total: 2 }]]);
      // Data query
      mockPool.execute.mockResolvedValueOnce([pendingItems]);

      const result = await service.listPending(1, 20);

      expect(result).toEqual({
        items: pendingItems,
        total: 2,
      });

      // Verify count query filters by 'pending'
      const countCall = mockPool.execute.mock.calls[0];
      expect(countCall[0]).toContain('pending');

      // Verify data query joins catalog items and users
      const dataCall = mockPool.execute.mock.calls[1];
      expect(dataCall[0]).toContain('marketplace_catalog_items');
      expect(dataCall[0]).toContain('users');
      expect(dataCall[0]).toContain('pending');
      expect(dataCall[1]).toContain(20); // limit
      expect(dataCall[1]).toContain(0);  // offset = (1-1) * 20
    });

    it('applies correct pagination offset', async () => {
      mockPool.execute.mockResolvedValueOnce([[{ total: 30 }]]);
      mockPool.execute.mockResolvedValueOnce([[]]);

      const result = await service.listPending(3, 10);

      expect(result.total).toBe(30);

      const dataCall = mockPool.execute.mock.calls[1];
      expect(dataCall[1]).toContain(10); // limit
      expect(dataCall[1]).toContain(20); // offset = (3-1) * 10
    });
  });
});
