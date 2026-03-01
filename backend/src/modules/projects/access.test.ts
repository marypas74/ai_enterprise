/**
 * Project Access Helpers Tests
 *
 * Covers: checkKanbanAccess, checkProjectAccess — role hierarchy,
 * admin bypass, owner vs member vs viewer, public projects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkKanbanAccess, checkProjectAccess } from './access.js';

// ── Module-level mocks ──────────────────────────────────────────

const mockFindOne = vi.fn().mockResolvedValue(null);

vi.mock('../../database/index.js', () => ({
  findOne: (...args: any[]) => mockFindOne(...args),
  findMany: vi.fn().mockResolvedValue([]),
  findAll: vi.fn().mockResolvedValue([]),
  insertOne: vi.fn().mockResolvedValue(1),
  updateOne: vi.fn().mockResolvedValue(1),
  databasePlugin: {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'database',
  },
}));

// Create a fake FastifyInstance with a db property
function createMockFastify(): any {
  return {
    db: {},
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('checkKanbanAccess', () => {
  let fastify: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fastify = createMockFastify();
  });

  it('should grant access to admin users', async () => {
    mockFindOne.mockResolvedValueOnce({ role: 'admin' });

    const result = await checkKanbanAccess(fastify, 1);
    expect(result).toBe(true);
  });

  it('should check kanban_enabled for non-admin users', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' }) // user role
      .mockResolvedValueOnce({ kanban_enabled: true }); // group kanban_enabled

    const result = await checkKanbanAccess(fastify, 2);
    expect(result).toBe(true);
  });

  it('should deny access when kanban_enabled is false', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ kanban_enabled: false });

    const result = await checkKanbanAccess(fastify, 2);
    expect(result).toBe(false);
  });

  it('should handle numeric 1 as kanban_enabled=true', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ kanban_enabled: 1 });

    const result = await checkKanbanAccess(fastify, 2);
    expect(result).toBe(true);
  });

  it('should default to true when kanban_enabled column does not exist', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockRejectedValueOnce(new Error('Unknown column'));

    const result = await checkKanbanAccess(fastify, 2);
    expect(result).toBe(true);
  });

  it('should return false for null kanban_enabled result', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce(null);

    const result = await checkKanbanAccess(fastify, 2);
    expect(result).toBe(false);
  });
});

describe('checkProjectAccess', () => {
  let fastify: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fastify = createMockFastify();
  });

  it('should grant access to global admin regardless of project membership', async () => {
    mockFindOne.mockResolvedValueOnce({ role: 'admin' });

    const result = await checkProjectAccess(fastify, 1, 999);
    expect(result).toBe(true);
    // Should not query project table
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it('should grant access to project owner', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' }) // not global admin
      .mockResolvedValueOnce({ id: 10, owner_id: 2, member_role: null }); // project (owned)

    const result = await checkProjectAccess(fastify, 2, 10);
    expect(result).toBe(true);
  });

  it('should deny access when project not found', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce(null);

    const result = await checkProjectAccess(fastify, 2, 999);
    expect(result).toBe(false);
  });

  it('should grant access to public project without role requirement', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ id: 10, owner_id: 99, is_public: true, member_role: null });

    const result = await checkProjectAccess(fastify, 2, 10);
    expect(result).toBe(true);
  });

  it('should check role hierarchy for member access', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ id: 10, owner_id: 99, member_role: 'member' });

    const result = await checkProjectAccess(fastify, 2, 10, 'member');
    expect(result).toBe(true);
  });

  it('should deny when member role is below required role', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ id: 10, owner_id: 99, member_role: 'viewer' });

    const result = await checkProjectAccess(fastify, 2, 10, 'admin');
    expect(result).toBe(false);
  });

  it('should grant when member role exceeds required role', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ id: 10, owner_id: 99, member_role: 'admin' });

    const result = await checkProjectAccess(fastify, 2, 10, 'member');
    expect(result).toBe(true);
  });

  it('should treat null member_role as viewer', async () => {
    mockFindOne
      .mockResolvedValueOnce({ role: 'user' })
      .mockResolvedValueOnce({ id: 10, owner_id: 99, member_role: null });

    // viewer < member, so should deny
    const result = await checkProjectAccess(fastify, 2, 10, 'member');
    expect(result).toBe(false);
  });
});
