/**
 * Test helper utilities for the backend test suite.
 *
 * Provides:
 * - createTestFastify()          — builds a Fastify instance with mocked db, redis, jwt
 * - createAuthenticatedRequest() — creates a mock request object with auth token
 * - mockDatabase()               — configures the mock db pool to return specified responses
 */
import { vi } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { mockPool, mockRedis } from './setup.js';
export async function createTestFastify(options = {}) {
    const { jwtSecret = 'test-jwt-secret', withAuth = true } = options;
    const fastify = Fastify({ logger: false });
    // Register JWT plugin
    await fastify.register(fastifyJwt, { secret: jwtSecret });
    // Register cookie plugin (needed for refresh tokens)
    await fastify.register(fastifyCookie);
    // Attach mocked database pool
    fastify.decorate('db', mockPool);
    // Attach mocked redis
    fastify.decorate('redis', mockRedis);
    // Decorate with geo extractor (used by auth routes)
    fastify.decorateRequest('geo', null);
    if (withAuth) {
        // Decorate with authenticate function that verifies JWT
        fastify.decorate('authenticate', async (request, reply) => {
            try {
                await request.jwtVerify();
            }
            catch {
                reply.status(401).send({ error: 'Unauthorized' });
            }
        });
    }
    return fastify;
}
/**
 * Creates a signed JWT token for testing authenticated endpoints.
 * Call this after `createTestFastify()` and pass the fastify instance.
 */
export function createAuthToken(fastify, userId = 1, role = 'user') {
    const payload = {
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
 */
export function createAuthHeaders(fastify, userId = 1, role = 'user') {
    const token = createAuthToken(fastify, userId, role);
    return {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
    };
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
export function mockDatabase(responses) {
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
export function mockInsert(insertId = 1) {
    mockPool.execute.mockResolvedValueOnce([{ insertId, affectedRows: 1 }, []]);
}
/**
 * Configures a single execute response for an UPDATE operation
 * (returns affectedRows).
 */
export function mockUpdate(affectedRows = 1) {
    mockPool.execute.mockResolvedValueOnce([{ affectedRows }, []]);
}
/**
 * Resets all database mock implementations to their defaults
 * (empty result sets).
 */
export function resetDatabaseMocks() {
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
//# sourceMappingURL=helpers.js.map