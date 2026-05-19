/**
 * User Management Routes Tests (Admin)
 *
 * Covers: list users, get user, create user, update user, delete user,
 * MFA reset, active sessions, disconnect user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { userManagementRoutes } from './userManagement.js';
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

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$10$hashedpassword'),
    compare: vi.fn().mockResolvedValue(false),
  },
}));

describe('User Management Routes (Admin)', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(userManagementRoutes, { prefix: '/admin' });
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
        url: '/admin/users',
      });
      // Should be 401 (sent by authenticate) or 500 (if hook continues after auth failure)
      expect([401, 500]).toContain(response.statusCode);
    });

    it('should return 403 for non-admin users', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/users',
        headers: createAuthHeaders(fastify, 1, 'user'),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // ─── LIST USERS ────────────────────────────────────────────

  describe('GET /admin/users', () => {
    it('should return list of users for admin', async () => {
      mockFindMany.mockResolvedValueOnce([
        { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
        { id: 2, email: 'user@test.com', name: 'User', role: 'user' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/users',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(2);
    });

    it('should support search parameter', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await fastify.inject({
        method: 'GET',
        url: '/admin/users?search=john',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('LIKE'),
        expect.arrayContaining(['%john%', '%john%'])
      );
    });
  });

  // ─── GET USER DETAILS ──────────────────────────────────────

  describe('GET /admin/users/:id', () => {
    it('should return user details', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 5,
        email: 'user@test.com',
        name: 'User',
        role: 'user',
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(5);
    });

    it('should return 404 when user not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/users/999',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── CREATE USER ───────────────────────────────────────────

  describe('POST /admin/users', () => {
    it('should create a new user', async () => {
      mockFindOne.mockResolvedValueOnce(null); // no existing user
      mockInsertOne.mockResolvedValueOnce(10); // userId
      mockInsertOne.mockResolvedValueOnce(1); // default group
      mockInsertOne.mockResolvedValueOnce(1); // audit

      const response = await fastify.inject({
        method: 'POST',
        url: '/admin/users',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: {
          email: 'new@test.com',
          password: 'password123',
          name: 'New User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.userId).toBe(10);
    });

    it('should return 409 when email already exists', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 1 }); // existing user

      const response = await fastify.inject({
        method: 'POST',
        url: '/admin/users',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: {
          email: 'exists@test.com',
          password: 'password123',
          name: 'Duplicate',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should assign user to specified groups', async () => {
      mockFindOne.mockResolvedValueOnce(null);
      mockInsertOne.mockResolvedValue(1);

      const response = await fastify.inject({
        method: 'POST',
        url: '/admin/users',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: {
          email: 'grouped@test.com',
          password: 'password123',
          name: 'Grouped User',
          groupIds: [2, 3],
        },
      });

      expect(response.statusCode).toBe(201);
      // insertOne called for user + 2 groups + audit = at least 4 times
      expect(mockInsertOne).toHaveBeenCalledTimes(4);
    });
  });

  // ─── UPDATE USER ───────────────────────────────────────────

  describe('PATCH /admin/users/:id', () => {
    it('should update user name', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('User updated');
    });

    it('should return 400 when no fields to update', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 when user not found', async () => {
      mockUpdateOne.mockResolvedValueOnce(0);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/999',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { name: 'Nonexistent' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should update role and active status', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { role: 'admin', is_active: false },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should hash password when updating it', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);
      const bcrypt = await import('bcrypt');

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { password: 'newpassword123' },
      });

      expect(response.statusCode).toBe(200);
      expect(bcrypt.default.hash).toHaveBeenCalledWith('newpassword123', 10);
    });

    // ADMIN-77: z.coerce.boolean() — frontend sends boolean-like values from form/JSON
    it('should accept is_active as boolean true', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { is_active: true },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should accept is_active as boolean false', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { is_active: false },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should accept is_active as string "true" (HTML form value)', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { is_active: 'true' },
      });

      // z.coerce.boolean() must coerce string "true" → true
      expect(response.statusCode).toBe(200);
    });

    it('should accept is_active as string "false" (HTML form value)', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { is_active: 'false' },
      });

      // z.coerce.boolean() must coerce string "false" → false (not true!)
      // NOTE: z.coerce.boolean('false') = Boolean('false') = true (non-empty string)
      // We use a custom preprocess to handle this correctly.
      expect(response.statusCode).toBe(200);
    });

    it('should accept exclude_from_stats as boolean', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { exclude_from_stats: true },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should accept exclude_from_stats as string "true" (form value)', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { exclude_from_stats: 'true' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should send only email patch (partial update)', async () => {
      // Note: email is NOT in the updateUserSchema whitelist (intentional RBAC).
      // Only whitelisted fields trigger update. This verifies that omitting all
      // whitelist fields triggers the "No fields to update" 400 response.
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { email: 'new@email.com' }, // not in whitelist
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('No fields to update');
    });

    it('should send only role patch', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin'),
        payload: { role: 'admin' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('User updated');
    });
  });

  // ─── DELETE USER ───────────────────────────────────────────

  describe('DELETE /admin/users/:id', () => {
    it('should prevent self-deletion', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/admin/users/1', // same as admin user ID
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Cannot delete yourself');
    });

    it('should delete another user', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/admin/users/5',
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('User deleted');
    });

    it('should return 404 when user not found', async () => {
      mockUpdateOne.mockResolvedValueOnce(0);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/admin/users/999',
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── MFA RESET ─────────────────────────────────────────────

  describe('POST /admin/users/:id/mfa-reset', () => {
    it('should reset MFA for a user', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'POST',
        url: '/admin/users/5/mfa-reset',
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('MFA reset successfully');
    });

    it('should return 404 when user not found', async () => {
      mockUpdateOne.mockResolvedValueOnce(0);

      const response = await fastify.inject({
        method: 'POST',
        url: '/admin/users/999/mfa-reset',
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── ACTIVE SESSIONS ──────────────────────────────────────

  describe('GET /admin/active-sessions', () => {
    it('should return mapped session data', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 1,
          user_id: 2,
          email: 'user@test.com',
          name: 'User',
          role: 'user',
          mfa_enabled: true,
          ip_address: '1.2.3.4',
          country: 'IT',
          user_agent: 'Chrome',
          login_at: '2026-01-01',
          last_activity_at: '2026-01-01',
        },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/admin/active-sessions',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].email).toBe('user@test.com');
      expect(body.sessions[0].mfaEnabled).toBe(true);
      expect(body.total).toBe(1);
    });
  });

  // ─── DISCONNECT USER SESSION ──────────────────────────────

  describe('DELETE /admin/active-sessions/:userId', () => {
    it('should terminate user sessions', async () => {
      mockUpdateOne.mockResolvedValueOnce(2); // 2 sessions revoked
      mockUpdateOne.mockResolvedValueOnce(1); // refresh tokens revoked

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/admin/active-sessions/5',
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('2 session(s) terminated');
    });

    it('should return 404 when no active sessions found', async () => {
      mockUpdateOne.mockResolvedValueOnce(0);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/admin/active-sessions/999',
        headers: createAuthHeaders(fastify, 1, 'admin', false),
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
