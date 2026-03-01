/**
 * Conversation Routes Tests
 *
 * Covers: list conversations, get messages, delete, archive/unarchive,
 * bulk delete, bulk archive, undo last message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestFastify, createAuthHeaders } from '../../../test/helpers.js';
import { conversationRoutes } from './conversations.js';
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

describe('Conversation Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = await createTestFastify();
    await fastify.register(conversationRoutes, { prefix: '/chat' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // ─── LIST CONVERSATIONS ─────────────────────────────────────

  describe('GET /chat/conversations', () => {
    it('should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/chat/conversations',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return conversations for authenticated user', async () => {
      mockFindMany.mockResolvedValueOnce([
        { id: 1, title: 'Chat 1', user_id: 1, is_archived: false, message_count: 5 },
        { id: 2, title: 'Chat 2', user_id: 1, is_archived: false, message_count: 3 },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/chat/conversations',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(2);
      expect(body[0].title).toBe('Chat 1');
    });

    it('should support archived filter', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/chat/conversations?archived=true',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      // Verify the archived parameter was passed
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('is_archived'),
        expect.arrayContaining([true])
      );
    });

    it('should support limit and offset pagination', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await fastify.inject({
        method: 'GET',
        url: '/chat/conversations?limit=10&offset=5',
        headers: createAuthHeaders(fastify),
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.arrayContaining([10, 5])
      );
    });
  });

  // ─── GET CONVERSATION MESSAGES ──────────────────────────────

  describe('GET /chat/conversations/:id/messages', () => {
    it('should return 404 when conversation not found or not owned', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/chat/conversations/99/messages',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return conversation with messages', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 1, title: 'Chat', user_id: 1 });
      mockFindMany.mockResolvedValueOnce([
        { id: 1, role: 'user', content: 'Hello' },
        { id: 2, role: 'assistant', content: 'Hi there' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/chat/conversations/1/messages',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.conversation.id).toBe(1);
      expect(body.messages).toHaveLength(2);
    });
  });

  // ─── DELETE CONVERSATION ────────────────────────────────────

  describe('DELETE /chat/conversations/:id', () => {
    it('should return 404 when conversation not found', async () => {
      mockUpdateOne.mockResolvedValueOnce(0);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations/999',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should delete conversation and log audit', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);
      mockInsertOne.mockResolvedValueOnce(1); // audit log

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations/1',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('Conversation deleted');
      expect(mockInsertOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('audit_log'),
        expect.any(Array)
      );
    });
  });

  // ─── ARCHIVE/UNARCHIVE ─────────────────────────────────────

  describe('PATCH /chat/conversations/:id/archive', () => {
    it('should archive a conversation', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/chat/conversations/1/archive',
        headers: createAuthHeaders(fastify),
        payload: { archived: true },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('Conversation archived');
    });

    it('should unarchive a conversation', async () => {
      mockUpdateOne.mockResolvedValueOnce(1);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/chat/conversations/1/archive',
        headers: createAuthHeaders(fastify),
        payload: { archived: false },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('Conversation unarchived');
    });

    it('should return 404 when conversation not found', async () => {
      mockUpdateOne.mockResolvedValueOnce(0);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/chat/conversations/999/archive',
        headers: createAuthHeaders(fastify),
        payload: { archived: true },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── UNDO LAST MESSAGE ─────────────────────────────────────

  describe('DELETE /chat/conversations/:id/undo', () => {
    it('should return 404 when conversation not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations/999/undo',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should undo assistant and preceding user message', async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: 1 }) // conversation ownership
        .mockResolvedValueOnce({ id: 10, role: 'assistant' }) // last assistant
        .mockResolvedValueOnce({ id: 9, role: 'user' }); // preceding user message

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations/1/undo',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deletedCount).toBe(2);
    });

    it('should undo only user message when no assistant message exists', async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: 1 }) // conversation ownership
        .mockResolvedValueOnce(null) // no assistant message
        .mockResolvedValueOnce({ id: 5, role: 'user' }); // last user message

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations/1/undo',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deletedCount).toBe(1);
    });

    it('should return 0 deleted when no messages exist', async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: 1 }) // conversation ownership
        .mockResolvedValueOnce(null) // no assistant message
        .mockResolvedValueOnce(null); // no user message

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations/1/undo',
        headers: createAuthHeaders(fastify),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deletedCount).toBe(0);
    });
  });

  // ─── BULK DELETE ────────────────────────────────────────────

  describe('DELETE /chat/conversations (bulk)', () => {
    it('should delete all conversations with all=true', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations',
        headers: createAuthHeaders(fastify),
        payload: { all: true },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('All conversations deleted');
    });

    it('should delete specific conversations by ids', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations',
        headers: createAuthHeaders(fastify),
        payload: { ids: [1, 2, 3] },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toBe('3 conversations deleted');
    });

    it('should return 400 when neither ids nor all provided', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/chat/conversations',
        headers: createAuthHeaders(fastify),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── BULK ARCHIVE ──────────────────────────────────────────

  describe('PATCH /chat/conversations/archive (bulk)', () => {
    it('should archive all conversations', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/chat/conversations/archive',
        headers: createAuthHeaders(fastify),
        payload: { all: true, archived: true },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toContain('All conversations archived');
    });

    it('should unarchive specific conversations', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/chat/conversations/archive',
        headers: createAuthHeaders(fastify),
        payload: { ids: [1, 2], archived: false },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toContain('2 conversations unarchived');
    });

    it('should return 400 when neither ids nor all provided', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/chat/conversations/archive',
        headers: createAuthHeaders(fastify),
        payload: { archived: true },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
