/**
 * Memory Routes Tests
 *
 * Covers: create observation, list/search/get/update/delete observations,
 * bulk actions, context, summaries, settings, stats, working memory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { memoryRoutes } from './routes.js';
import type { FastifyInstance } from 'fastify';

// ── Module-level mocks ──────────────────────────────────────────

const mockCaptureObservation = vi.fn().mockResolvedValue(1);
const mockSearchMemories = vi.fn().mockResolvedValue([]);
const mockGetObservation = vi.fn().mockResolvedValue(null);
const mockUpdateObservation = vi.fn().mockResolvedValue(true);
const mockDeleteObservation = vi.fn().mockResolvedValue(true);
const mockBulkArchive = vi.fn().mockResolvedValue(2);
const mockBulkDelete = vi.fn().mockResolvedValue(3);
const mockGetContextForNewChat = vi.fn().mockResolvedValue('Some context');
const mockGetSummaries = vi.fn().mockResolvedValue([]);
const mockGetSettings = vi.fn().mockResolvedValue({ auto_capture: true, inject_context: true });
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);
const mockGetStats = vi.fn().mockResolvedValue({ total: 10, archived: 2 });

vi.mock('./service.js', () => {
  // Use class so `new MemoryService(db)` works correctly in Vitest ESM context
  class MemoryService {
    captureObservation = (...args: any[]) => mockCaptureObservation(...args);
    searchMemories = (...args: any[]) => mockSearchMemories(...args);
    getObservation = (...args: any[]) => mockGetObservation(...args);
    updateObservation = (...args: any[]) => mockUpdateObservation(...args);
    deleteObservation = (...args: any[]) => mockDeleteObservation(...args);
    bulkArchive = (...args: any[]) => mockBulkArchive(...args);
    bulkDelete = (...args: any[]) => mockBulkDelete(...args);
    getContextForNewChat = (...args: any[]) => mockGetContextForNewChat(...args);
    getSummaries = (...args: any[]) => mockGetSummaries(...args);
    getSettings = (...args: any[]) => mockGetSettings(...args);
    updateSettings = (...args: any[]) => mockUpdateSettings(...args);
    getStats = (...args: any[]) => mockGetStats(...args);
    autoCapture = vi.fn().mockResolvedValue(undefined);
  }
  return { MemoryService };
});

// Mock WorkingMemoryService
const mockWmGet = vi.fn().mockResolvedValue(null);
const mockWmListUserSessions = vi.fn().mockResolvedValue([]);
const mockWmClear = vi.fn().mockResolvedValue(undefined);
const mockWmClearAllUserSessions = vi.fn().mockResolvedValue(2);
const mockWmGetStats = vi.fn().mockResolvedValue({ totalSessions: 5 });
const mockGetSessionTokens = vi.fn().mockReturnValue({ input: 100, output: 50 });

vi.mock('../../services/WorkingMemoryService.js', () => {
  // Use class so `new WorkingMemoryService(redis)` works correctly in Vitest ESM context
  class WorkingMemoryService {
    get = (...args: any[]) => mockWmGet(...args);
    listUserSessions = (...args: any[]) => mockWmListUserSessions(...args);
    clear = (...args: any[]) => mockWmClear(...args);
    clearAllUserSessions = (...args: any[]) => mockWmClearAllUserSessions(...args);
    getStats = (...args: any[]) => mockWmGetStats(...args);
    getSessionTokens = (...args: any[]) => mockGetSessionTokens(...args);
  }
  return { WorkingMemoryService };
});

vi.mock('../../database/index.js', () => ({
  findOne: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue([]),
  findAll: vi.fn().mockResolvedValue([]),
  insertOne: vi.fn().mockResolvedValue(1),
  updateOne: vi.fn().mockResolvedValue(1),
  databasePlugin: {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'database',
  },
}));

describe('Memory Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(memoryRoutes, { prefix: '/memory' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── AUTH GUARD ────────────────────────────────────────────

  describe('Auth guard', () => {
    it('should return 401 without auth token', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/observations',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ─── CREATE OBSERVATION ───────────────────────────────────

  describe('POST /memory/observations', () => {
    it('should create an observation', async () => {
      mockCaptureObservation.mockResolvedValueOnce(42);

      const response = await fastify.inject({
        method: 'POST',
        url: '/memory/observations',
        headers: createAuthHeaders(fastify),
        payload: {
          content: 'User prefers dark mode',
          observation_type: 'preference',
          importance: 8,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(42);
    });

    it('should validate content is not empty', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/memory/observations',
        headers: createAuthHeaders(fastify),
        payload: {
          content: '',
        },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── LIST OBSERVATIONS ────────────────────────────────────

  describe('GET /memory/observations', () => {
    it('should return observations list', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        { id: 1, content: 'Observation 1', observation_type: 'insight' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/observations',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.observations).toHaveLength(1);
    });

    it('should pass filter parameters', async () => {
      mockSearchMemories.mockResolvedValueOnce([]);

      await fastify.inject({
        method: 'GET',
        url: '/memory/observations?type=preference&archived=false&min_importance=5',
        headers: createAuthHeaders(fastify),
      });

      expect(mockSearchMemories).toHaveBeenCalledWith(
        1, // user id
        '',
        expect.objectContaining({
          observation_type: 'preference',
          is_archived: false,
          min_importance: 5,
        })
      );
    });
  });

  // ─── SEARCH ───────────────────────────────────────────────

  describe('GET /memory/search', () => {
    it('should return 400 when query is missing', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/search',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should search observations by query', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        { id: 1, content: 'Dark mode preference' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/search?q=dark+mode',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(1);
    });
  });

  // ─── GET OBSERVATION ──────────────────────────────────────

  describe('GET /memory/observations/:id', () => {
    it('should return observation', async () => {
      mockGetObservation.mockResolvedValueOnce({ id: 1, content: 'Test' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/observations/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.observation.content).toBe('Test');
    });

    it('should return 404 when not found', async () => {
      mockGetObservation.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/observations/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── UPDATE OBSERVATION ───────────────────────────────────

  describe('PATCH /memory/observations/:id', () => {
    it('should update observation', async () => {
      mockUpdateObservation.mockResolvedValueOnce(true);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/memory/observations/1',
        headers: createAuthHeaders(fastify),
        payload: { content: 'Updated content', importance: 9 },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 when observation not found', async () => {
      mockUpdateObservation.mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/memory/observations/999',
        headers: createAuthHeaders(fastify),
        payload: { content: 'Nope' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── DELETE OBSERVATION ───────────────────────────────────

  describe('DELETE /memory/observations/:id', () => {
    it('should delete observation', async () => {
      mockDeleteObservation.mockResolvedValueOnce(true);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/memory/observations/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 when not found', async () => {
      mockDeleteObservation.mockResolvedValueOnce(false);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/memory/observations/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── BULK ACTIONS ─────────────────────────────────────────

  describe('POST /memory/observations/bulk', () => {
    it('should archive observations in bulk', async () => {
      mockBulkArchive.mockResolvedValueOnce(3);

      const response = await fastify.inject({
        method: 'POST',
        url: '/memory/observations/bulk',
        headers: createAuthHeaders(fastify),
        payload: { ids: [1, 2, 3], action: 'archive' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.affected).toBe(3);
    });

    it('should delete observations in bulk', async () => {
      mockBulkDelete.mockResolvedValueOnce(2);

      const response = await fastify.inject({
        method: 'POST',
        url: '/memory/observations/bulk',
        headers: createAuthHeaders(fastify),
        payload: { ids: [1, 2], action: 'delete' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.affected).toBe(2);
    });
  });

  // ─── CONTEXT ──────────────────────────────────────────────

  describe('GET /memory/context', () => {
    it('should return memory context', async () => {
      mockGetContextForNewChat.mockResolvedValueOnce('Important context here');

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/context',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.has_context).toBe(true);
      expect(body.context).toBe('Important context here');
    });

    it('should indicate no context when null', async () => {
      mockGetContextForNewChat.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/context',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.has_context).toBe(false);
    });
  });

  // ─── SETTINGS ─────────────────────────────────────────────

  describe('GET /memory/settings', () => {
    it('should return memory settings', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/settings',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.settings.auto_capture).toBe(true);
    });
  });

  describe('PATCH /memory/settings', () => {
    it('should update settings', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/memory/settings',
        headers: createAuthHeaders(fastify),
        payload: { auto_capture: false, max_context_observations: 20 },
      });

      expect(response.statusCode).toBe(200);
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  // ─── STATS ────────────────────────────────────────────────

  describe('GET /memory/stats', () => {
    it('should return memory statistics', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/stats',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.stats.total).toBe(10);
    });
  });

  // ─── WORKING MEMORY ──────────────────────────────────────

  describe('GET /memory/working/:conversationId', () => {
    it('should return working memory state', async () => {
      mockWmGet.mockResolvedValueOnce({ conversationId: 1, data: 'some state' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/working/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.state).toBeDefined();
      expect(body.tokenUsage).toBeDefined();
    });

    it('should return 404 when no working memory', async () => {
      mockWmGet.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/memory/working/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /memory/working/:conversationId', () => {
    it('should clear working memory', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/memory/working/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(mockWmClear).toHaveBeenCalledWith(1, 1);
    });
  });

  describe('DELETE /memory/working', () => {
    it('should clear all working memory sessions', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/memory/working',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.cleared).toBe(2);
    });
  });
});
