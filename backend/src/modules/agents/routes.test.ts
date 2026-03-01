/**
 * Agent Routes Tests
 *
 * Covers: list sessions, create/get/update/delete session, start/pause/resume/cancel,
 * templates CRUD.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { mockPool } from '../../../test/setup.js';
import { agentRoutes } from './routes.js';
import type { FastifyInstance } from 'fastify';

// ── Module-level mocks ──────────────────────────────────────────

const mockFindOne = vi.fn().mockResolvedValue(null);
const mockFindMany = vi.fn().mockResolvedValue([]);

vi.mock('../../database/index.js', () => ({
  findOne: (...args: any[]) => mockFindOne(...args),
  findMany: (...args: any[]) => mockFindMany(...args),
  findAll: (...args: any[]) => mockFindMany(...args),
  insertOne: vi.fn().mockResolvedValue(1),
  updateOne: vi.fn().mockResolvedValue(1),
  databasePlugin: {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'database',
  },
}));

// Mock AgentOrchestrator
const mockGetUserSessions = vi.fn().mockResolvedValue({ sessions: [], total: 0 });
const mockCreateSession = vi.fn().mockResolvedValue({ id: 1, name: 'Test', status: 'pending' });
const mockGetSession = vi.fn().mockResolvedValue(null);
const mockStartSession = vi.fn().mockResolvedValue(undefined);
const mockPauseSession = vi.fn().mockResolvedValue(undefined);
const mockResumeSession = vi.fn().mockResolvedValue(undefined);
const mockCancelSession = vi.fn().mockResolvedValue(undefined);
const mockGetSessionLogs = vi.fn().mockResolvedValue({ logs: [], total: 0 });

vi.mock('../../services/AgentOrchestrator.js', () => ({
  AgentOrchestrator: {
    getUserSessions: (...args: any[]) => mockGetUserSessions(...args),
    createSession: (...args: any[]) => mockCreateSession(...args),
    getSession: (...args: any[]) => mockGetSession(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    pauseSession: (...args: any[]) => mockPauseSession(...args),
    resumeSession: (...args: any[]) => mockResumeSession(...args),
    cancelSession: (...args: any[]) => mockCancelSession(...args),
    getSessionLogs: (...args: any[]) => mockGetSessionLogs(...args),
  },
}));

// Mock WorktreeManager
vi.mock('../../services/WorktreeManager.js', () => ({
  WorktreeManager: {
    getWorktreeStatus: vi.fn().mockResolvedValue(null),
    mergeWorktree: vi.fn().mockResolvedValue({ success: true }),
    getConflictContent: vi.fn().mockResolvedValue({ path: 'file.ts', content: '' }),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock AgentEventEmitter
vi.mock('../../services/AgentEventEmitter.js', () => ({
  AgentEventEmitter: {
    subscribeToSession: vi.fn().mockReturnValue(() => {}),
  },
}));

describe('Agent Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(agentRoutes, { prefix: '/agents' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── LIST SESSIONS ────────────────────────────────────────

  describe('GET /agents/sessions', () => {
    it('should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/agents/sessions',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return user sessions', async () => {
      mockGetUserSessions.mockResolvedValueOnce({
        sessions: [{ id: 1, name: 'Session 1', status: 'pending' }],
        total: 1,
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/agents/sessions',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sessions).toHaveLength(1);
    });
  });

  // ─── CREATE SESSION ───────────────────────────────────────

  describe('POST /agents/sessions', () => {
    it('should create a new session', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions',
        headers: createAuthHeaders(fastify),
        payload: {
          name: 'New Session',
          taskSpecification: 'Implement feature X',
          modelId: 1,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mockCreateSession).toHaveBeenCalled();
    });

    it('should return 400 for invalid payload', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions',
        headers: createAuthHeaders(fastify),
        payload: { name: '' }, // missing required fields
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET SESSION ──────────────────────────────────────────

  describe('GET /agents/sessions/:id', () => {
    it('should return 404 when session not found', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/agents/sessions/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 when session belongs to another user', async () => {
      mockGetSession.mockResolvedValueOnce({ id: 1, userId: 999, status: 'pending' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/agents/sessions/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return session details for owner', async () => {
      mockGetSession.mockResolvedValueOnce({ id: 1, userId: 1, status: 'pending', name: 'My Session' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/agents/sessions/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('My Session');
    });
  });

  // ─── UPDATE SESSION ───────────────────────────────────────

  describe('PATCH /agents/sessions/:id', () => {
    it('should return 400 when session is running', async () => {
      mockGetSession.mockResolvedValueOnce({ id: 1, userId: 1, status: 'running', config: {} });

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/agents/sessions/1',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should update pending session', async () => {
      mockGetSession
        .mockResolvedValueOnce({ id: 1, userId: 1, status: 'pending', config: {} })
        .mockResolvedValueOnce({ id: 1, userId: 1, status: 'pending', name: 'Updated' });

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/agents/sessions/1',
        headers: createAuthHeaders(fastify),
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ─── DELETE SESSION ───────────────────────────────────────

  describe('DELETE /agents/sessions/:id', () => {
    it('should delete session', async () => {
      mockGetSession.mockResolvedValueOnce({ id: 1, userId: 1, status: 'pending' });

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/agents/sessions/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
    });

    it('should cancel running session before deleting', async () => {
      mockGetSession.mockResolvedValueOnce({ id: 1, userId: 1, status: 'running' });

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/agents/sessions/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(mockCancelSession).toHaveBeenCalled();
    });
  });

  // ─── START/PAUSE/RESUME/CANCEL ────────────────────────────

  describe('Session lifecycle', () => {
    const sessionOwned = { id: 1, userId: 1, status: 'pending' };

    it('POST /start should start session', async () => {
      mockGetSession.mockResolvedValueOnce(sessionOwned);

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions/1/start',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(mockStartSession).toHaveBeenCalled();
    });

    it('POST /pause should pause session', async () => {
      mockGetSession.mockResolvedValueOnce({ ...sessionOwned, status: 'running' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions/1/pause',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(mockPauseSession).toHaveBeenCalled();
    });

    it('POST /resume should resume session', async () => {
      mockGetSession.mockResolvedValueOnce({ ...sessionOwned, status: 'paused' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions/1/resume',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(mockResumeSession).toHaveBeenCalled();
    });

    it('POST /cancel should cancel session', async () => {
      mockGetSession.mockResolvedValueOnce({ ...sessionOwned, status: 'running' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions/1/cancel',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(mockCancelSession).toHaveBeenCalled();
    });

    it('should return 404 for non-existent session on start', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions/999/start',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 when session belongs to another user', async () => {
      mockGetSession.mockResolvedValueOnce({ id: 1, userId: 999, status: 'pending' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/sessions/1/start',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── TEMPLATES ────────────────────────────────────────────

  describe('GET /agents/templates', () => {
    it('should return templates list', async () => {
      mockPool.execute.mockResolvedValueOnce([[
        {
          id: 1,
          user_id: 1,
          name: 'Template 1',
          description: 'Test',
          model_id: 1,
          model_name: 'gpt-4',
          model_display_name: 'GPT-4',
          system_prompt: 'You are helpful',
          default_config: '{}',
          tools: '[]',
          max_iterations: 50,
          timeout_seconds: 3600,
          category: 'development',
          is_public: false,
          created_at: '2026-01-01',
        },
      ], []]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/agents/templates',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Template 1');
    });
  });

  describe('POST /agents/templates', () => {
    it('should create a template', async () => {
      mockPool.execute.mockResolvedValueOnce([{ insertId: 10 }, []]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/templates',
        headers: createAuthHeaders(fastify),
        payload: {
          name: 'New Template',
          modelId: 1,
          systemPrompt: 'You are a coding assistant',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(10);
    });

    it('should return 400 for invalid template data', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/agents/templates',
        headers: createAuthHeaders(fastify),
        payload: { name: '' }, // missing required fields
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /agents/templates/:id', () => {
    it('should soft-delete own template', async () => {
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/agents/templates/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 when template not found or not owned', async () => {
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/agents/templates/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
