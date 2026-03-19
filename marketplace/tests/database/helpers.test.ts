import { describe, it, expect, vi } from 'vitest';
import { findOne, findMany, insertOne, execute } from '../../src/database/helpers.js';

describe('Database helpers', () => {
  const mockPool = {
    execute: vi.fn(),
  } as any;

  it('findOne returns first row or null', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ id: 1, name: 'test' }]]);
    const result = await findOne(mockPool, 'SELECT * FROM t WHERE id = ?', [1]);
    expect(result).toEqual({ id: 1, name: 'test' });
  });

  it('findOne returns null when no rows', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const result = await findOne(mockPool, 'SELECT * FROM t WHERE id = ?', [999]);
    expect(result).toBeNull();
  });

  it('findMany returns all rows', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]]);
    const result = await findMany(mockPool, 'SELECT * FROM t');
    expect(result).toHaveLength(2);
  });

  it('insertOne returns insertId', async () => {
    mockPool.execute.mockResolvedValueOnce([{ insertId: 42 }]);
    const id = await insertOne(mockPool, 'INSERT INTO t (name) VALUES (?)', ['test']);
    expect(id).toBe(42);
  });

  it('execute runs query without returning data', async () => {
    mockPool.execute.mockResolvedValueOnce([{}]);
    await execute(mockPool, 'DELETE FROM t WHERE id = ?', [1]);
    expect(mockPool.execute).toHaveBeenCalledWith('DELETE FROM t WHERE id = ?', [1]);
  });
});
