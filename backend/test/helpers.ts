/**
 * Test helper utilities for the backend test suite.
 *
 * Provides:
 * - createTestFastify()          — builds a Fastify instance with mocked db, redis, jwt
 * - createAuthenticatedRequest() — creates a mock request object with auth token
 * - mockDatabase()               — configures the mock db pool to return specified responses
 */

import { vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { mockPool, mockRedis } from './setup.js';

// ────────────────────────────────────────────────────────────
// createTestFastify — Fastify instance pre-wired with mocks
// ────────────────────────────────────────────────────────────

interface TestFastifyOptions {
  /** JWT secret (default: 'test-jwt-secret') */
  jwtSecret?: string;
  /** Whether to register the authenticate decorator (default: true) */
  withAuth?: boolean;
}

export async function createTestFastify(
  options: TestFastifyOptions = {}
): Promise<FastifyInstance> {
  const { jwtSecret = 'test-jwt-secret', withAuth = true } = options;

  const fastify = Fastify({ logger: false });

  // Register JWT plugin
  await fastify.register(fastifyJwt, { secret: jwtSecret });

  // Register cookie plugin (needed for refresh tokens)
  await fastify.register(fastifyCookie);

  // Attach mocked database pool
  fastify.decorate('db', mockPool as any);

  // Attach mocked redis
  fastify.decorate('redis', mockRedis as any);

  // Decorate with geo extractor (used by auth routes)
  fastify.decorateRequest('geo', null as any);

  if (withAuth) {
    // Decorate with authenticate function that verifies JWT
    fastify.decorate('authenticate', async (request: any, reply: any) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: 'Unauthorized' });
      }
    });
  }

  return fastify;
}

// ────────────────────────────────────────────────────────────
// createAuthenticatedRequest — mock request with auth payload
// ────────────────────────────────────────────────────────────

interface AuthPayload {
  id: number;
  email: string;
  role: 'admin' | 'user';
  sid?: string;
  mfa_verified?: boolean;
}

/**
 * Creates a signed JWT token for testing authenticated endpoints.
 * Call this after `createTestFastify()` and pass the fastify instance.
 */
export function createAuthToken(
  fastify: FastifyInstance,
  userId: number = 1,
  role: 'admin' | 'user' = 'user'
): string {
  const payload: AuthPayload = {
    id: userId,
    email: `user${userId}@test.com`,
    role,
    sid: 'test-session-id',
    mfa_verified: true,
  };
  return fastify.jwt.sign(payload);
}

/**
 * Creates mock headers object with Authorization bearer token.
 * Set `withBody=false` for DELETE/GET/POST-without-body to avoid Fastify FST_ERR_CTP_EMPTY_JSON_BODY.
 */
export function createAuthHeaders(
  fastify: FastifyInstance,
  userId: number = 1,
  role: 'admin' | 'user' = 'user',
  withBody: boolean = true
): Record<string, string> {
  const token = createAuthToken(fastify, userId, role);
  const base = { authorization: `Bearer ${token}` };
  return withBody ? { ...base, 'content-type': 'application/json' } : base;
}

// ────────────────────────────────────────────────────────────
// mockDatabase — configure mock db to return specific data
// ────────────────────────────────────────────────────────────

interface MockDbResponse {
  /** Rows returned by execute/query as the first element of the tuple */
  rows: any[];
  /** Optional fields metadata (second element of the tuple) */
  fields?: any[];
}

/**
 * Configures the mock database pool to return specified responses
 * in order. Each call to `pool.execute()` or `pool.query()` will
 * consume the next response from the queue.
 *
 * @example
 * ```ts
 * mockDatabase([
 *   { rows: [{ id: 1, email: 'admin@test.com' }] },  // first query
 *   { rows: [] },                                       // second query
 * ]);
 * ```
 */
export function mockDatabase(responses: MockDbResponse[]): void {
  let callIndex = 0;

  const getNextResponse = () => {
    if (callIndex < responses.length) {
      const response = responses[callIndex];
      callIndex++;
      return [response.rows, response.fields ?? []];
    }
    // Default: empty result set
    return [[], []];
  };

  mockPool.execute.mockImplementation(() => Promise.resolve(getNextResponse()));
  mockPool.query.mockImplementation(() => Promise.resolve(getNextResponse()));
}

/**
 * Configures a single execute response for an INSERT operation
 * (returns insertId).
 */
export function mockInsert(insertId: number = 1): void {
  mockPool.execute.mockResolvedValueOnce([{ insertId, affectedRows: 1 }, []]);
}

/**
 * Configures a single execute response for an UPDATE operation
 * (returns affectedRows).
 */
export function mockUpdate(affectedRows: number = 1): void {
  mockPool.execute.mockResolvedValueOnce([{ affectedRows }, []]);
}

/**
 * Resets all database mock implementations to their defaults
 * (empty result sets).
 */
export function resetDatabaseMocks(): void {
  mockPool.execute.mockReset().mockResolvedValue([[], []]);
  mockPool.query.mockReset().mockResolvedValue([[], []]);
  mockPool.getConnection.mockReset().mockResolvedValue({
    release: vi.fn(),
    execute: vi.fn().mockResolvedValue([[], []]),
    query: vi.fn().mockResolvedValue([[], []]),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  });
}
