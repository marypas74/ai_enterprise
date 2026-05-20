/**
 * Extended Auth Routes Tests
 *
 * Covers: register, login (MFA flows), refresh, logout, /me,
 * MFA setup/verify/disable, admin session management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { authRoutes } from './routes.js';
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

vi.mock('otplib', () => ({
  verify: vi.fn().mockReturnValue(false),
  generateSecret: vi.fn().mockReturnValue('MOCKSECRET'),
  generateURI: vi.fn().mockReturnValue('otpauth://totp/test'),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mock'),
  },
}));

// ── Test suite ──────────────────────────────────────────────────

describe('Auth Routes — Extended', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(authRoutes, { prefix: '/auth' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── REGISTER ───────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('should return 403 when registration is disabled', async () => {
      // REGISTRATION_ENABLED is not set -> disabled by default
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'new@test.com', password: 'password123', name: 'Test User' },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toBe('Registration is currently disabled');
    });

    it('should return 409 when email already exists', async () => {
      process.env.REGISTRATION_ENABLED = 'true';
      mockFindOne.mockResolvedValueOnce({ id: 1 }); // existing user

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'exists@test.com', password: 'password123', name: 'Existing' },
      });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error).toBe('Email already registered');
      delete process.env.REGISTRATION_ENABLED;
    });

    it('should create user and return 201 on success', async () => {
      process.env.REGISTRATION_ENABLED = 'true';
      mockFindOne.mockResolvedValueOnce(null); // no existing user
      mockInsertOne.mockResolvedValueOnce(42); // userId
      mockInsertOne.mockResolvedValueOnce(1); // user_groups insert
      mockInsertOne.mockResolvedValueOnce(1); // audit_log insert

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'new@test.com', password: 'password123', name: 'New User' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.userId).toBe(42);
      expect(body.message).toBe('User registered successfully');
      delete process.env.REGISTRATION_ENABLED;
    });

    it('should return 400 for invalid email format', async () => {
      process.env.REGISTRATION_ENABLED = 'true';
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', password: 'password123', name: 'Test' },
      });

      expect(response.statusCode).toBe(400);
      delete process.env.REGISTRATION_ENABLED;
    });

    it('should return 400 for password shorter than 8 characters', async () => {
      process.env.REGISTRATION_ENABLED = 'true';
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@test.com', password: 'short', name: 'Test User' },
      });

      expect(response.statusCode).toBe(400);
      delete process.env.REGISTRATION_ENABLED;
    });
  });

  // ─── LOGIN — MFA FLOWS ─────────────────────────────────────

  describe('POST /auth/login — MFA scenarios', () => {
    const validUser = {
      id: 1,
      email: 'user@test.com',
      password_hash: '$2b$10$hash',
      name: 'Test User',
      role: 'user' as const,
      is_active: true,
      mfa_enabled: true,
      mfa_secret: 'SECRET123',
    };

    it.skip('should return mfa_required when MFA enabled but no TOTP code from external IP', async () => {
      // TODO 2.1.82: MFA response shape changed — verify body.mfa_required field name in current auth flow.
      const bcrypt = await import('bcrypt');
      mockFindOne.mockResolvedValueOnce(validUser);
      (bcrypt.default.compare as any).mockResolvedValueOnce(true);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@test.com', password: 'password' },
        remoteAddress: '8.8.8.8', // external IP
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.mfa_required).toBe(true);
    });

    it('should return 401 for invalid TOTP code', async () => {
      const bcrypt = await import('bcrypt');
      const { verify } = await import('otplib');

      mockFindOne.mockResolvedValueOnce(validUser);
      (bcrypt.default.compare as any).mockResolvedValueOnce(true);
      (verify as any).mockReturnValueOnce(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@test.com', password: 'password', totp_code: '000000' },
        remoteAddress: '8.8.8.8',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('Invalid TOTP code');
    });

    it('should bypass MFA requirement on trusted IP (localhost)', async () => {
      const bcrypt = await import('bcrypt');
      mockFindOne.mockResolvedValueOnce(validUser);
      (bcrypt.default.compare as any).mockResolvedValueOnce(true);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@test.com', password: 'password' },
        remoteAddress: '127.0.0.1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
    });

    it.skip('should return mfa_setup_required for external user without MFA configured', async () => {
      // TODO 2.1.82: MFA response shape changed — verify body.mfa_setup_required field name in current auth flow.
      const bcrypt = await import('bcrypt');
      const userNoMfa = { ...validUser, mfa_enabled: false, mfa_secret: null };
      mockFindOne.mockResolvedValueOnce(userNoMfa);
      (bcrypt.default.compare as any).mockResolvedValueOnce(true);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@test.com', password: 'password' },
        remoteAddress: '8.8.8.8',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.mfa_setup_required).toBe(true);
      expect(body.accessToken).toBeDefined();
    });
  });

  // ─── REFRESH TOKEN ──────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('should return 401 when no refresh token cookie is present', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/refresh',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('Refresh token required');
    });

    it('should return 401 when refresh token is invalid', async () => {
      mockFindOne.mockResolvedValueOnce(null); // no matching token

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refreshToken: 'invalid-token-value' },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('Invalid refresh token');
    });

    it('should return new access token on valid refresh', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        user_id: 5,
        email: 'user@test.com',
        role: 'user',
        name: 'Test',
        token_hash: 'abc',
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refreshToken: 'valid-refresh-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
    });
  });

  // ─── GET /auth/me ───────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('should return 401 without auth token', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return user profile with valid token', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        email: 'me@test.com',
        name: 'Me',
        role: 'user',
        mfa_enabled: false,
        groups: '["default"]',
      });

      const headers = createAuthHeaders(fastify);

      const response = await fastify.inject({
        method: 'GET',
        url: '/auth/me',
        headers,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.email).toBe('me@test.com');
    });

    it('should return 404 when user is not found in DB', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/auth/me',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── LOGOUT ─────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('should return 401 without auth token', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should revoke tokens and return success', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: createAuthHeaders(fastify),
        cookies: { refreshToken: 'some-refresh-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Logged out successfully');
      // Should have called updateOne twice (refresh_tokens + user_sessions)
      expect(mockUpdateOne).toHaveBeenCalledTimes(2);
    });

    it('should succeed even without refresh cookie', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ─── MFA SETUP ──────────────────────────────────────────────

  describe('POST /auth/mfa/setup', () => {
    it('should return QR code and secret for authenticated user', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        email: 'user@test.com',
        mfa_enabled: false,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/setup',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.secret).toBe('MOCKSECRET');
      expect(body.qr_code).toContain('data:image/png');
    });

    it('should return 400 if MFA is already enabled', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        email: 'user@test.com',
        mfa_enabled: true,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/setup',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 if user not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/setup',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── MFA VERIFY SETUP ──────────────────────────────────────

  describe('POST /auth/mfa/verify-setup', () => {
    it('should return 400 if MFA setup not initiated', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/verify-setup',
        headers: createAuthHeaders(fastify),
        payload: { totp_code: '123456' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid TOTP code during setup', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        mfa_secret: 'SECRET',
        mfa_enabled: false,
      });

      const { verify } = await import('otplib');
      (verify as any).mockReturnValueOnce(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/verify-setup',
        headers: createAuthHeaders(fastify),
        payload: { totp_code: '000000' },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Invalid TOTP');
    });

    it('should enable MFA on valid TOTP code', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        mfa_secret: 'SECRET',
        mfa_enabled: false,
      });

      const { verify } = await import('otplib');
      (verify as any).mockReturnValueOnce(true);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/verify-setup',
        headers: createAuthHeaders(fastify),
        payload: { totp_code: '123456' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalled();
    });
  });

  // ─── MFA DISABLE ────────────────────────────────────────────

  describe('POST /auth/mfa/disable', () => {
    it('should return 400 if MFA is not enabled', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        mfa_enabled: false,
        mfa_secret: null,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/disable',
        headers: createAuthHeaders(fastify),
        payload: { totp_code: '123456' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 for invalid TOTP code when disabling', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        mfa_enabled: true,
        mfa_secret: 'SECRET',
      });

      const { verify } = await import('otplib');
      (verify as any).mockReturnValueOnce(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/disable',
        headers: createAuthHeaders(fastify),
        payload: { totp_code: '000000' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should disable MFA on valid TOTP code', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 1,
        mfa_enabled: true,
        mfa_secret: 'SECRET',
      });

      const { verify } = await import('otplib');
      (verify as any).mockReturnValueOnce(true);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/mfa/disable',
        headers: createAuthHeaders(fastify),
        payload: { totp_code: '123456' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  // ─── ADMIN SESSIONS ────────────────────────────────────────

  describe('GET /auth/sessions (admin)', () => {
    it('should return 403 for non-admin users', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/auth/sessions',
        headers: createAuthHeaders(fastify, 1, 'user'),
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return sessions for admin users', async () => {
      // mockPool.query returns the sessions data
      const { mockPool } = await import('../../../test/setup.js');
      (mockPool.query as any).mockResolvedValueOnce([[
        { id: 1, user_id: 2, email: 'u@test.com', name: 'U', ip_address: '1.2.3.4' },
      ], []]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/auth/sessions',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sessions).toBeDefined();
    });
  });

  describe('DELETE /auth/sessions/:id (admin)', () => {
    it('should return 403 for non-admin users', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/auth/sessions/1',
        headers: createAuthHeaders(fastify, 1, 'user'),
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when session not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/auth/sessions/999',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should terminate session and return success', async () => {
      mockFindOne.mockResolvedValueOnce({ token_hash: 'abc123' });

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/auth/sessions/1',
        headers: createAuthHeaders(fastify, 1, 'admin'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });
});
