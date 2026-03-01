/**
 * Board Routes Tests
 *
 * Covers: get board with columns+cards, create board,
 * create/update/delete column, reorder columns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { boardRoutes } from './boards.js';
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

vi.mock('./access.js', () => ({
  checkProjectAccess: vi.fn().mockResolvedValue(true),
  Board: {},
  Column: {},
  Card: {},
}));

describe('Board Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(boardRoutes, { prefix: '/projects' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── GET BOARD ────────────────────────────────────────────

  describe('GET /projects/:projectId/boards/:boardId', () => {
    it('should return 404 when project access denied', async () => {
      const { checkProjectAccess } = await import('./access.js');
      (checkProjectAccess as any).mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1/boards/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 when board not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1/boards/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return board with columns and cards', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 1, name: 'Main Board', project_id: 1 });
      mockFindAll
        .mockResolvedValueOnce([
          { id: 10, board_id: 1, name: 'To Do', sort_order: 0 },
          { id: 11, board_id: 1, name: 'Done', sort_order: 1 },
        ])
        .mockResolvedValueOnce([
          { id: 100, title: 'Task 1', column_id: 10, label_ids: '1,2' },
        ])
        .mockResolvedValueOnce([
          { id: 101, title: 'Task 2', column_id: 11, label_ids: null },
        ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1/boards/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Main Board');
      expect(body.columns).toHaveLength(2);
      expect(body.columns[0].cards).toHaveLength(1);
      expect(body.columns[0].cards[0].labels).toEqual([1, 2]);
      expect(body.columns[1].cards[0].labels).toEqual([]);
    });
  });

  // ─── CREATE BOARD ─────────────────────────────────────────

  describe('POST /projects/:projectId/boards', () => {
    it('should create a new board', async () => {
      mockInsertOne.mockResolvedValueOnce(5);

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/boards',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Sprint Board' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(5);
      expect(body.name).toBe('Sprint Board');
    });

    it('should return 403 with insufficient permissions', async () => {
      const { checkProjectAccess } = await import('./access.js');
      (checkProjectAccess as any).mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/boards',
        headers: createAuthHeaders(fastify),
        payload: { name: 'No Access' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── CREATE COLUMN ────────────────────────────────────────

  describe('POST /projects/:projectId/boards/:boardId/columns', () => {
    it('should create a new column', async () => {
      mockFindOne.mockResolvedValueOnce({ max_order: 3 });
      mockInsertOne.mockResolvedValueOnce(15);

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/boards/1/columns',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Review', color: '#8B5CF6' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(15);
      expect(body.name).toBe('Review');
    });

    it('should handle null max_order (first column)', async () => {
      mockFindOne.mockResolvedValueOnce({ max_order: null });
      mockInsertOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/1/boards/1/columns',
        headers: createAuthHeaders(fastify),
        payload: { name: 'First Column' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ─── UPDATE COLUMN ────────────────────────────────────────

  describe('PATCH /projects/:projectId/columns/:columnId', () => {
    it('should update column properties', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/projects/1/columns/10',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Updated Column', color: '#FF0000' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);
    });

    it('should handle empty update body', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/projects/1/columns/10',
        headers: createAuthHeaders(fastify),
        payload: {},
      });

      // No updates but still returns success
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── DELETE COLUMN ────────────────────────────────────────

  describe('DELETE /projects/:projectId/columns/:columnId', () => {
    it('should delete column with admin permissions', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/projects/1/columns/10',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);
    });

    it('should return 403 without admin permissions', async () => {
      const { checkProjectAccess } = await import('./access.js');
      (checkProjectAccess as any).mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/projects/1/columns/10',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── REORDER COLUMNS ─────────────────────────────────────

  describe('PUT /projects/:projectId/boards/:boardId/columns/reorder', () => {
    it('should reorder columns', async () => {
      const response = await fastify.inject({
        method: 'PUT',
        url: '/projects/1/boards/1/columns/reorder',
        headers: createAuthHeaders(fastify),
        payload: [
          { id: 10, sort_order: 0 },
          { id: 11, sort_order: 1 },
          { id: 12, sort_order: 2 },
        ],
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalledTimes(3);
    });
  });
});
