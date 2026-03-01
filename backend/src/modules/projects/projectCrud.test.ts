/**
 * Project CRUD Routes Tests
 *
 * Covers: kanban-access check, list projects, get project, create, update, delete.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { projectCrudRoutes } from './projectCrud.js';
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

// Mock access module
vi.mock('./access.js', () => ({
  checkKanbanAccess: vi.fn().mockResolvedValue(true),
  checkProjectAccess: vi.fn().mockResolvedValue(true),
  Project: {},
  Board: {},
}));

// Mock StorageService
vi.mock('../../services/StorageService.js', () => ({
  createProjectFolder: vi.fn().mockResolvedValue({ basePath: '/data/projects/user/project' }),
}));

describe('Project CRUD Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(projectCrudRoutes, { prefix: '/projects' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── KANBAN ACCESS ────────────────────────────────────────

  describe('GET /projects/kanban-access', () => {
    it('should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/kanban-access',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return kanban access status and groups', async () => {
      mockFindAll.mockResolvedValueOnce([
        { name: 'Developers', kanban_enabled: true },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/kanban-access',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.hasKanbanAccess).toBe(true);
      expect(body.groups).toBeDefined();
    });
  });

  // ─── LIST PROJECTS ────────────────────────────────────────

  describe('GET /projects/', () => {
    it('should return projects for authenticated user', async () => {
      mockFindAll.mockResolvedValueOnce([
        { id: 1, name: 'Project 1', owner_id: 1, role: 'owner', board_count: 1, card_count: 5 },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Project 1');
    });

    it('should return 403 when Kanban access denied', async () => {
      const { checkKanbanAccess } = await import('./access.js');
      (checkKanbanAccess as any).mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── GET PROJECT ──────────────────────────────────────────

  describe('GET /projects/:id', () => {
    it('should return project with boards, labels, and members', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        name: 'My Project',
        owner_id: 1,
      });
      mockFindAll
        .mockResolvedValueOnce([{ id: 1, name: 'Main Board' }]) // boards
        .mockResolvedValueOnce([{ id: 1, name: 'Bug', color: '#ff0000' }]) // labels
        .mockResolvedValueOnce([{ id: 1, name: 'User', role: 'admin' }]); // members

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('My Project');
      expect(body.boards).toHaveLength(1);
      expect(body.labels).toHaveLength(1);
      expect(body.members).toHaveLength(1);
    });

    it('should return 404 when project access denied', async () => {
      const { checkProjectAccess } = await import('./access.js');
      (checkProjectAccess as any).mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'GET',
        url: '/projects/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── CREATE PROJECT ───────────────────────────────────────

  describe('POST /projects/', () => {
    it('should create project with default board and columns', async () => {
      mockFindOne.mockResolvedValueOnce({ name: 'Test User', email: 'test@test.com' }); // user info
      mockInsertOne
        .mockResolvedValueOnce(10) // project insert
        .mockResolvedValueOnce(20) // board insert
        .mockResolvedValueOnce(1) // col 1
        .mockResolvedValueOnce(2) // col 2
        .mockResolvedValueOnce(3) // col 3
        .mockResolvedValueOnce(4); // col 4

      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/',
        headers: createAuthHeaders(fastify),
        payload: { name: 'New Project' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(10);
      expect(body.board_id).toBe(20);
      // 4 default columns created
      expect(mockInsertOne).toHaveBeenCalledTimes(6);
    });

    it('should reject invalid project name', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/projects/',
        headers: createAuthHeaders(fastify),
        payload: { name: '' },
      });

      // Zod validation should fail
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── UPDATE PROJECT ───────────────────────────────────────

  describe('PATCH /projects/:id', () => {
    it('should update project fields', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/projects/1',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Updated Name', color: '#FF0000' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);
    });

    it('should return 403 when insufficient permissions', async () => {
      const { checkProjectAccess } = await import('./access.js');
      (checkProjectAccess as any).mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/projects/1',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Nope' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── DELETE PROJECT ───────────────────────────────────────

  describe('DELETE /projects/:id', () => {
    it('should delete project owned by user', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 1, owner_id: 1 });

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/projects/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);
    });

    it('should return 403 when not owner', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 1, owner_id: 99 });

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/projects/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 403 when project not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/projects/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
