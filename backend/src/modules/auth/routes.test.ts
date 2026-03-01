/**
 * Auth routes — sample tests to verify test infrastructure.
 *
 * Tests:
 * 1. POST /login returns 400 for missing credentials
 * 2. POST /login returns 401 for invalid credentials (user not found)
 * 3. POST /login calls bcrypt.compare with correct args on valid user
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, mockDatabase } from '../../../test/helpers.js';
import { authRoutes } from './routes.js';
import type { FastifyInstance } from 'fastify';

// Mock bcrypt — needs to be at module level for vi.mock hoisting
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$10$hashedpassword'),
    compare: vi.fn().mockResolvedValue(false),
  },
}));

// Mock otplib
vi.mock('otplib', () => ({
  verify: vi.fn().mockReturnValue(false),
  generateSecret: vi.fn().mockReturnValue('MOCKSECRET'),
  generateURI: vi.fn().mockReturnValue('otpauth://totp/test'),
}));

// Mock qrcode
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mock'),
  },
}));

// Mock the database helpers module
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

describe('Auth Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = await createTestFastify();
    // Register auth routes under /auth prefix (mirrors real app)
    await fastify.register(authRoutes, { prefix: '/auth' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('POST /auth/login', () => {
    it('should return 400 for missing email', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { password: 'somepassword' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing password', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 when user is not found', async () => {
      // findOne returns null (user not found) — this is the default mock
      const { findOne } = await import('../../database/index.js');
      (findOne as any).mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid credentials');
    });

    it('should return 401 when password is wrong', async () => {
      const { findOne } = await import('../../database/index.js');
      const bcrypt = await import('bcrypt');

      // Mock: user found in DB
      (findOne as any).mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        password_hash: '$2b$10$existinghash',
        name: 'Test User',
        role: 'user',
        is_active: true,
        mfa_enabled: false,
        mfa_secret: null,
      });

      // Mock: bcrypt compare returns false (wrong password)
      (bcrypt.default.compare as any).mockResolvedValue(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(bcrypt.default.compare).toHaveBeenCalledWith(
        'wrongpassword',
        '$2b$10$existinghash'
      );
    });

    it('should return access token on successful login', async () => {
      const { findOne, updateOne, insertOne } = await import('../../database/index.js');
      const bcrypt = await import('bcrypt');

      // Mock: user found in DB
      (findOne as any).mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        password_hash: '$2b$10$existinghash',
        name: 'Test User',
        role: 'user',
        is_active: true,
        mfa_enabled: false,
        mfa_secret: null,
      });

      // Mock: bcrypt compare returns true (correct password)
      (bcrypt.default.compare as any).mockResolvedValue(true);

      // Mock: updateOne and insertOne succeed
      (updateOne as any).mockResolvedValue(1);
      (insertOne as any).mockResolvedValue(1);

      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'correctpassword',
        },
        // Simulate local IP so MFA is bypassed
        remoteAddress: '127.0.0.1',
      });

      const body = JSON.parse(response.body);

      // Should return 200 with accessToken and user info
      expect(response.statusCode).toBe(200);
      expect(body.accessToken).toBeDefined();
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.name).toBe('Test User');
      expect(body.user.role).toBe('user');
    });
  });
});
