/**
 * Database Helper Tests
 *
 * Covers: findOne, findMany/findAll, insertOne, updateOne query helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findOne, findMany, findAll, insertOne, updateOne } from './index.js';

// ── Use the global mock pool from setup.ts ──────────────────────

const mockExecute = vi.fn();
const mockPool = { execute: mockExecute } as any;

describe('Database Query Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── findOne ──────────────────────────────────────────────

  describe('findOne', () => {
    it('should return first row when results exist', async () => {
      mockExecute.mockResolvedValueOnce([[{ id: 1, name: 'Test' }], []]);

      const result = await findOne<{ id: number; name: string }>(mockPool, 'SELECT * FROM users WHERE id = ?', [1]);
      expect(result).toEqual({ id: 1, name: 'Test' });
    });

    it('should return null when no rows found', async () => {
      mockExecute.mockResolvedValueOnce([[], []]);

      const result = await findOne(mockPool, 'SELECT * FROM users WHERE id = ?', [999]);
      expect(result).toBeNull();
    });

    it('should pass SQL and params to execute', async () => {
      mockExecute.mockResolvedValueOnce([[], []]);

      await findOne(mockPool, 'SELECT * FROM users WHERE email = ?', ['test@test.com']);
      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM users WHERE email = ?', ['test@test.com']);
    });

    it('should default to empty params array', async () => {
      mockExecute.mockResolvedValueOnce([[], []]);

      await findOne(mockPool, 'SELECT COUNT(*) FROM users');
      expect(mockExecute).toHaveBeenCalledWith('SELECT COUNT(*) FROM users', []);
    });
  });

  // ─── findMany ─────────────────────────────────────────────

  describe('findMany', () => {
    it('should return all rows', async () => {
      mockExecute.mockResolvedValueOnce([
        [{ id: 1, name: 'User 1' }, { id: 2, name: 'User 2' }],
        [],
      ]);

      const result = await findMany<{ id: number; name: string }>(mockPool, 'SELECT * FROM users');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('User 1');
    });

    it('should return empty array when no rows', async () => {
      mockExecute.mockResolvedValueOnce([[], []]);

      const result = await findMany(mockPool, 'SELECT * FROM users WHERE 1=0');
      expect(result).toEqual([]);
    });
  });

  // ─── findAll (alias) ──────────────────────────────────────

  describe('findAll (alias for findMany)', () => {
    it('should be the same function as findMany', () => {
      expect(findAll).toBe(findMany);
    });
  });

  // ─── insertOne ────────────────────────────────────────────

  describe('insertOne', () => {
    it('should return insertId', async () => {
      mockExecute.mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }, []]);

      const result = await insertOne(mockPool, 'INSERT INTO users (name) VALUES (?)', ['Test']);
      expect(result).toBe(42);
    });

    it('should pass SQL and params to execute', async () => {
      mockExecute.mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, []]);

      await insertOne(mockPool, 'INSERT INTO users (email, name) VALUES (?, ?)', ['a@b.com', 'Name']);
      expect(mockExecute).toHaveBeenCalledWith(
        'INSERT INTO users (email, name) VALUES (?, ?)',
        ['a@b.com', 'Name']
      );
    });
  });

  // ─── updateOne ────────────────────────────────────────────

  describe('updateOne', () => {
    it('should return affectedRows', async () => {
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const result = await updateOne(mockPool, 'UPDATE users SET name = ? WHERE id = ?', ['New', 1]);
      expect(result).toBe(1);
    });

    it('should return 0 when no rows affected', async () => {
      mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

      const result = await updateOne(mockPool, 'UPDATE users SET name = ? WHERE id = ?', ['New', 999]);
      expect(result).toBe(0);
    });
  });
});
