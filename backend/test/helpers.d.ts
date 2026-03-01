/**
 * Test helper utilities for the backend test suite.
 *
 * Provides:
 * - createTestFastify()          — builds a Fastify instance with mocked db, redis, jwt
 * - createAuthenticatedRequest() — creates a mock request object with auth token
 * - mockDatabase()               — configures the mock db pool to return specified responses
 */
import { FastifyInstance } from 'fastify';
interface TestFastifyOptions {
    /** JWT secret (default: 'test-jwt-secret') */
    jwtSecret?: string;
    /** Whether to register the authenticate decorator (default: true) */
    withAuth?: boolean;
}
export declare function createTestFastify(options?: TestFastifyOptions): Promise<FastifyInstance>;
/**
 * Creates a signed JWT token for testing authenticated endpoints.
 * Call this after `createTestFastify()` and pass the fastify instance.
 */
export declare function createAuthToken(fastify: FastifyInstance, userId?: number, role?: 'admin' | 'user'): string;
/**
 * Creates mock headers object with Authorization bearer token.
 */
export declare function createAuthHeaders(fastify: FastifyInstance, userId?: number, role?: 'admin' | 'user'): Record<string, string>;
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
export declare function mockDatabase(responses: MockDbResponse[]): void;
/**
 * Configures a single execute response for an INSERT operation
 * (returns insertId).
 */
export declare function mockInsert(insertId?: number): void;
/**
 * Configures a single execute response for an UPDATE operation
 * (returns affectedRows).
 */
export declare function mockUpdate(affectedRows?: number): void;
/**
 * Resets all database mock implementations to their defaults
 * (empty result sets).
 */
export declare function resetDatabaseMocks(): void;
export {};
//# sourceMappingURL=helpers.d.ts.map