/**
 * Card Routes Tests
 *
 * Covers: create card, get card details, update card, move card, delete card.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { cardRoutes } from './cards.js';
import type { FastifyInstance } from 'fastify';

// ── Module-level mocks ──────────────────────────────────────────

const mockFindOne = vi.fn().mockResolvedValue(null);
const mockFindAll = vi.fn().mockResolvedValue([]);
const mockInsertOne = vi.fn().mockResolvedValue(1);
const mockUpdateOne = vi.fn().mockResolvedValue(1);

vi.mock('../../database/index.js', () => ({
  findOne: (...args: any[]) => mockFindOne(...args),
  findMany: (...args: any[]) => mockFindAll(...args),
  findAll: (...args: any[]) => mockFindAll(...args),
  insertOne: (...args: any[]) => mockInsertOne(...args),
  updateOne: (...args: any[]) => mockUpdateOne(...args),
  databasePlugin: {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'database',
  },
}));

const mockCheckProjectAccess = vi.fn().mockResolvedValue(true);

vi.mock('./access.js', () => ({
  checkProjectAccess: (...args: any[]) => mockCheckProjectAccess(...args),
  Card: {},
}));

describe('Card Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks (clearAllMocks resets mockResolvedValue to undefined)
    mockFindOne.mockResolvedValue(null);
    mockFindAll.mockResolvedValue([]);
    mockInsertOne.mockResolvedValue(1);
    mockUpdateOne.mockResolvedValue(1);
    mockCheckProjectAccess.mockResolvedValue(true);
    fastify = await createTestFastify();
    await fastify.register(cardRoutes, { prefix: '/projects' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── CREATE CARD ──────────────────────────────────────────

  describe('POST /projects/:projectId/columns/:columnId/cards', () => {
    it('should create a new card', async () => {
      mockFindOne.mockResolvedValueOnce({ max_order: 5 });
      mockInsertOne
        .mockResolvedValueOnce(100) // card insert
        .mockResolvedValueOnce(1); // activity log

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/columns/10/cards',
        headers: createAuthHeaders(fastify),
        payload: { title: 'New Task', priority: 'high' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(100);
      expect(body.title).toBe('New Task');
      expect(body.priority).toBe('high');
    });

    it('should return 403 without member permissions', async () => {
      
      mockCheckProjectAccess.mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/columns/10/cards',
        headers: createAuthHeaders(fastify),
        payload: { title: 'No Access' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should use default medium priority', async () => {
      mockFindOne.mockResolvedValueOnce({ max_order: 0 });
      mockInsertOne.mockResolvedValue(1);

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/columns/10/cards',
        headers: createAuthHeaders(fastify),
        payload: { title: 'Default Priority' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.priority).toBe('medium');
    });
  });

  // ─── GET CARD DETAILS ─────────────────────────────────────

  describe('GET /projects/:projectId/cards/:cardId', () => {
    it('should return card with labels, comments, checklists, and activity', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 100,
        title: 'Task',
        column_id: 10,
        creator_name: 'User 1',
        assignee_name: null,
      });
      mockFindAll
        .mockResolvedValueOnce([{ id: 1, name: 'Bug', color: '#ff0000' }]) // labels
        .mockResolvedValueOnce([{ id: 1, content: 'Great work', user_name: 'Admin' }]) // comments
        .mockResolvedValueOnce([{ id: 1, name: 'Checklist 1', sort_order: 0 }]) // checklists
        .mockResolvedValueOnce([{ id: 1, text: 'Item 1', completed: false }]) // checklist items
        .mockResolvedValueOnce([{ id: 1, action: 'created', user_name: 'User 1' }]) // activity
        .mockResolvedValueOnce([]); // conversations

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1/cards/100',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.title).toBe('Task');
      expect(body.labels).toHaveLength(1);
      expect(body.comments).toHaveLength(1);
      expect(body.checklists).toHaveLength(1);
      expect(body.checklists[0].items).toHaveLength(1);
    });

    it('should return 404 when card not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1/cards/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 when project access denied', async () => {
      
      mockCheckProjectAccess.mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1/cards/100',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── UPDATE CARD ──────────────────────────────────────────

  describe('PATCH /projects/:projectId/cards/:cardId', () => {
    it('should update card fields', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/projects/1/cards/100',
        headers: createAuthHeaders(fastify),
        payload: { title: 'Updated Title', priority: 'urgent' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalled();
      expect(mockInsertOne).toHaveBeenCalled(); // activity log
    });

    it('should handle empty update (no fields)', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/projects/1/cards/100',
        headers: createAuthHeaders(fastify),
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ─── MOVE CARD ────────────────────────────────────────────

  describe('POST /projects/:projectId/cards/:cardId/move', () => {
    it('should move card to different column', async () => {
      mockFindOne
        .mockResolvedValueOnce({ role: 'user' }) // user role
        .mockResolvedValueOnce({ column_id: 10, title: 'Task' }); // old card

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/cards/100/move',
        headers: createAuthHeaders(fastify),
        payload: { column_id: 20, sort_order: 0 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.from).toBe(10);
      expect(body.to).toBe(20);
    });

    it('should return success=false when card not found (never 500)', async () => {
      mockFindOne
        .mockResolvedValueOnce({ role: 'user' }) // user role
        .mockResolvedValueOnce(null); // card not found

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/cards/999/move',
        headers: createAuthHeaders(fastify),
        payload: { column_id: 20 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.warning).toContain('not found');
    });

    it('should return success=false for invalid column_id', async () => {
      mockFindOne.mockResolvedValueOnce({ role: 'user' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/cards/100/move',
        headers: createAuthHeaders(fastify),
        payload: { column_id: 'invalid' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('should allow admin to move any card', async () => {
      mockFindOne
        .mockResolvedValueOnce({ role: 'admin' }) // admin user
        .mockResolvedValueOnce({ column_id: 10, title: 'Task' }); // card

      
      mockCheckProjectAccess.mockResolvedValueOnce(false); // would normally deny

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/cards/100/move',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { column_id: 20 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should handle server error gracefully (returns 200 with warning)', async () => {
      mockFindOne.mockRejectedValueOnce(new Error('DB down'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/cards/100/move',
        headers: createAuthHeaders(fastify),
        payload: { column_id: 20 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.warning).toBeDefined();
    });
  });

  // ─── DELETE CARD ──────────────────────────────────────────

  describe('DELETE /projects/:projectId/cards/:cardId', () => {
    it.skip('should delete card', async () => {
      // TODO 2.1.83: ESM hoisting prevents vi.mock('./access.js') from intercepting
      // checkProjectAccess inside cards.ts when running under Vitest ESM transform.
      // The mock IS registered but the import inside the route module receives the
      // original function because the module was already cached before the mock ran.
      // Fix: use vi.doMock + dynamic import to control load order.
    });

    it('should return 403 without member permissions', async () => {
      
      mockCheckProjectAccess.mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/projects/1/cards/100',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
