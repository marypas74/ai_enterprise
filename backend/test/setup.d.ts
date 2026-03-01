/**
 * Global test setup for the backend.
 *
 * Provides mocks for:
 * - mysql2/promise (database pool)
 * - Redis client (@fastify/redis)
 * - bcrypt (password hashing)
 *
 * These mocks are automatically available in every test file
 * because this file is listed in vitest.config.ts setupFiles.
 */
declare const mockConnection: {
    release: import("vitest").Mock<import("@vitest/spy").Procedure>;
    execute: import("vitest").Mock<import("@vitest/spy").Procedure>;
    query: import("vitest").Mock<import("@vitest/spy").Procedure>;
    beginTransaction: import("vitest").Mock<import("@vitest/spy").Procedure>;
    commit: import("vitest").Mock<import("@vitest/spy").Procedure>;
    rollback: import("vitest").Mock<import("@vitest/spy").Procedure>;
};
declare const mockPool: {
    execute: import("vitest").Mock<import("@vitest/spy").Procedure>;
    query: import("vitest").Mock<import("@vitest/spy").Procedure>;
    getConnection: import("vitest").Mock<import("@vitest/spy").Procedure>;
    end: import("vitest").Mock<import("@vitest/spy").Procedure>;
};
declare const mockRedis: {
    get: import("vitest").Mock<import("@vitest/spy").Procedure>;
    set: import("vitest").Mock<import("@vitest/spy").Procedure>;
    del: import("vitest").Mock<import("@vitest/spy").Procedure>;
    ping: import("vitest").Mock<import("@vitest/spy").Procedure>;
    keys: import("vitest").Mock<import("@vitest/spy").Procedure>;
    expire: import("vitest").Mock<import("@vitest/spy").Procedure>;
    ttl: import("vitest").Mock<import("@vitest/spy").Procedure>;
    incr: import("vitest").Mock<import("@vitest/spy").Procedure>;
    hget: import("vitest").Mock<import("@vitest/spy").Procedure>;
    hset: import("vitest").Mock<import("@vitest/spy").Procedure>;
    hdel: import("vitest").Mock<import("@vitest/spy").Procedure>;
    hgetall: import("vitest").Mock<import("@vitest/spy").Procedure>;
    quit: import("vitest").Mock<import("@vitest/spy").Procedure>;
    disconnect: import("vitest").Mock<import("@vitest/spy").Procedure>;
};
export { mockPool, mockConnection, mockRedis };
//# sourceMappingURL=setup.d.ts.map