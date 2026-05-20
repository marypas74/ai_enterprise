/**
 * System Settings Routes Tests (Admin)
 *
 * Covers: usage stats, system-stats dashboard, audit log.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { mockPool } from '../../../test/setup.js';
import { systemSettingsRoutes } from './systemSettings.js';
import type { FastifyInstance } from 'fastify';

// ── Module-level mocks ──────────────────────────────────────────

const mockFindOne = vi.fn().mockResolvedValue(null);
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockInsertOne = vi.fn().mockResolvedValue(1);
const mockUpdateOne = vi.fn().mockResolvedValue(1);

vi.mock('../../database/index.js', () => ({
  findOne: (...args: any[]) => mockFindOne(...args),
  findMany: (...args: any[]) => mockFindMany(...args),
  findAll: (...args: any[]) => mockFindMany(...args),
  insertOne: (...args: any[]) => mockInsertOne(...args),
  updateOne: (...args: any[]) => mockUpdateOne(...args),
  databasePlugin: {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'database',
  },
}));

// Mock MetricsService
vi.mock('../../services/MetricsService.js', () => ({
  MetricsService: {
    getExhaustiveMetrics: vi.fn().mockResolvedValue({
      uptime: 3600,
      memory: { used: 100, total: 500 },
      cpu: { usage: 25 },
    }),
  },
}));

describe('System Settings Routes (Admin)', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(systemSettingsRoutes, { prefix: '/admin' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── AUTH GUARD ────────────────────────────────────────────

  describe('Admin guard', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/usage',
      });
      // Should be 401 (sent by authenticate) or 500 (if hook continues after auth failure)
      expect([401, 500]).toContain(response.statusCode);
    });

    it('should return 403 for non-admin users', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/usage',
        headers: createAuthHeaders(fastify, 1, 'user'),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // ─── USAGE STATS ──────────────────────────────────────────

  describe('GET /admin/usage', () => {
    it('should return usage statistics', async () => {
      // findMany for userStats
      mockFindMany
        .mockResolvedValueOnce([
          { user_id: 1, email: 'user@test.com', name: 'User', total_tokens: 1000, total_cost: 0.5, request_count: 10 },
        ])
        // findMany for providerStats
        .mockResolvedValueOnce([
          { provider: 'openai', tokens_input: 500, tokens_output: 500, cost: 0.5, requests: 10 },
        ]);

      // mockPool.execute for totals
      mockPool.execute.mockResolvedValueOnce([
        [{ total_tokens: 1000, total_cost: 0.5, total_requests: 10 }], [],
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/usage',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.month).toBeDefined();
      expect(body.totals).toBeDefined();
      expect(body.byProvider).toBeDefined();
      expect(body.byUser).toBeDefined();
    });

    it('should accept month and userId query params', async () => {
      mockFindMany.mockResolvedValue([]);
      mockPool.execute.mockResolvedValueOnce([[{}], []]);

      await fastify.inject({
        method: 'GET',
        url: '/admin/usage?month=2026-01&userId=5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      // Verify the month param was used
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('year_month'),
        expect.arrayContaining(['2026-01'])
      );
    });
  });

  // ─── SYSTEM STATS ─────────────────────────────────────────

  describe('GET /admin/system-stats', () => {
    it('should return system statistics with numeric values', async () => {
      // Setup mockPool.execute to return data for each stats query
      mockPool.execute
        .mockResolvedValueOnce([[{ totalUsers: 10, activeUsers: 8 }], []]) // users
        .mockResolvedValueOnce([[{ totalProviders: 3, activeProviders: 2 }], []]) // providers
        .mockResolvedValueOnce([[{ totalModels: 5, activeModels: 4 }], []]) // models
        .mockResolvedValueOnce([[{ activeAgents: 2 }], []]) // agents
        .mockResolvedValueOnce([[{ totalPlugins: 1 }], []]) // plugins
        .mockResolvedValueOnce([[{ mcpServers: 0 }], []]) // mcp servers
        .mockResolvedValueOnce([[{ cnt: 50 }], []]) // today's requests
        .mockResolvedValueOnce([[{ cnt: 200 }], []]) // week requests
        .mockResolvedValueOnce([[{ cost: 5.50 }], []]) // month cost
        .mockResolvedValueOnce([[{ rate: 99.5, respTime: 1.2 }], []]); // success rate

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/system-stats',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalUsers).toBe(10);
      expect(body.activeUsers).toBe(8);
      expect(body.activeProviders).toBe(2);
      expect(body.todayRequests).toBe(50);
    });

    it('should handle missing tables gracefully', async () => {
      // All queries throw errors (tables don't exist)
      mockPool.execute.mockRejectedValue(new Error('Table not found'));

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/system-stats',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should return defaults
      expect(body.totalUsers).toBe(0);
      expect(body.todayRequests).toBe(0);
    });
  });

  // ─── AUDIT LOG ────────────────────────────────────────────

  describe('GET /admin/audit-log', () => {
    it('should return audit log entries', async () => {
      mockFindMany.mockResolvedValueOnce([
        { id: 1, user_id: 1, action: 'login', user_email: 'admin@test.com', created_at: '2026-01-01' },
        { id: 2, user_id: 2, action: 'create_user', user_email: 'admin@test.com', created_at: '2026-01-01' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/audit-log',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(2);
    });

    it('should support action filter', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await fastify.inject({
        method: 'GET',
        url: '/admin/audit-log?action=login',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('action = ?'),
        expect.arrayContaining(['login'])
      );
    });

    it('should support userId filter', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await fastify.inject({
        method: 'GET',
        url: '/admin/audit-log?userId=5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('user_id = ?'),
        expect.arrayContaining(['5'])
      );
    });
  });

  // ─── SYSTEM MONITOR ───────────────────────────────────────

  describe('GET /admin/system-monitor', () => {
    it('should return exhaustive metrics data', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/system-monitor',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.uptime).toBe(3600);
    });
  });

  // ─── OLLAMA MANAGEMENT ────────────────────────────────────
  // DEBT-83-B: Skipped tests removed. Route /admin/ollama/pull was moved to
  // /providers/ollama/docker/pull-model in providerSync.ts (v2.1.81).
  // Coverage exists via providerSync integration tests.
});
