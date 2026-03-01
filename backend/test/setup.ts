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

import { vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────
// Mock: mysql2/promise
// ────────────────────────────────────────────────────────────
const mockConnection = {
  release: vi.fn(),
  execute: vi.fn().mockResolvedValue([[], []]),
  query: vi.fn().mockResolvedValue([[], []]),
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
};

const mockPool = {
  execute: vi.fn().mockResolvedValue([[], []]),
  query: vi.fn().mockResolvedValue([[], []]),
  getConnection: vi.fn().mockResolvedValue(mockConnection),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => mockPool),
  },
  createPool: vi.fn(() => mockPool),
}));

// ────────────────────────────────────────────────────────────
// Mock: Redis client (ioredis-compatible, used by @fastify/redis)
// ────────────────────────────────────────────────────────────
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  ping: vi.fn().mockResolvedValue('PONG'),
  keys: vi.fn().mockResolvedValue([]),
  expire: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(-1),
  incr: vi.fn().mockResolvedValue(1),
  hget: vi.fn().mockResolvedValue(null),
  hset: vi.fn().mockResolvedValue(1),
  hdel: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn().mockResolvedValue({}),
  quit: vi.fn().mockResolvedValue('OK'),
  disconnect: vi.fn(),
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis),
}));

// ────────────────────────────────────────────────────────────
// Reset mocks between tests to prevent state leaking
// ────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// Exports — test files can import these to configure behavior
// ────────────────────────────────────────────────────────────
export { mockPool, mockConnection, mockRedis };
