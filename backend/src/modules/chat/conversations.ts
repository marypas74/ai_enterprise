import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { Conversation, DbMessage } from './types.js';

// Validation schemas
const archiveConversationSchema = z.object({
  archived: z.boolean(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.number()).optional(),
  all: z.boolean().optional(),
});

const bulkArchiveSchema = z.object({
  ids: z.array(z.number()).optional(),
  all: z.boolean().optional(),
  archived: z.boolean(),
});

export async function conversationRoutes(fastify: FastifyInstance) {

  // List conversations
  fastify.get('/conversations', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List user conversations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const query = request.query as { archived?: string; limit?: string; offset?: string };

    const isArchived = query.archived === 'true';
    const limit = parseInt(query.limit || '20');
    const offset = parseInt(query.offset || '0');

    const conversations = await findMany<Conversation>(
      fastify.db,
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c
       WHERE c.user_id = ? AND c.is_archived = ?
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, isArchived, limit, offset]
    );

    return conversations;
  });

  // Get conversation messages
  fastify.get('/conversations/:id/messages', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get conversation messages',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    // Verify ownership
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    const messages = await findMany<DbMessage>(
      fastify.db,
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [params.id]
    );

    return {
      conversation,
      messages
    };
  });

  // Undo last message
  fastify.delete('/conversations/:id/undo', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Undo the last message in a conversation',
      tags: ['chat'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const conversationId = parseInt(request.params.id);

    // Verify ownership
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, user.id]
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Find the last assistant message and the user message immediately preceding it
    const lastAssistantMessage = await findOne<{ id: number; role: string }>(
      fastify.db,
      'SELECT id, role FROM messages WHERE conversation_id = ? AND role = "assistant" ORDER BY id DESC LIMIT 1',
      [conversationId]
    );

    const idsToDelete: number[] = [];

    if (lastAssistantMessage) {
      idsToDelete.push(lastAssistantMessage.id);

      const lastUserMessage = await findOne<{ id: number; role: string }>(
        fastify.db,
        'SELECT id, role FROM messages WHERE conversation_id = ? AND role = "user" AND id < ? ORDER BY id DESC LIMIT 1',
        [conversationId, lastAssistantMessage.id]
      );

      if (lastUserMessage) {
        idsToDelete.push(lastUserMessage.id);
      }
    } else {
      const lastUserMessage = await findOne<{ id: number; role: string }>(
        fastify.db,
        'SELECT id, role FROM messages WHERE conversation_id = ? AND role = "user" ORDER BY id DESC LIMIT 1',
        [conversationId]
      );
      if (lastUserMessage) {
        idsToDelete.push(lastUserMessage.id);
      }
    }

    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => '?').join(',');
      await fastify.db.execute(
        `DELETE FROM messages WHERE id IN (${placeholders})`,
        idsToDelete
      );
    }

    return {
      message: 'Undone successfully',
      deletedCount: idsToDelete.length,
      conversationId
    };
  });

  // Delete conversation
  fastify.delete('/conversations/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete a conversation',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const result = await updateOne(
      fastify.db,
      'DELETE FROM conversations WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'delete_conversation', 'conversation', params.id, request.ip]
    );

    return { message: 'Conversation deleted' };
  });

  // Archive/unarchive conversation
  fastify.patch('/conversations/:id/archive', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Archive or unarchive a conversation',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const body = archiveConversationSchema.parse(request.body);

    const result = await updateOne(
      fastify.db,
      'UPDATE conversations SET is_archived = ? WHERE id = ? AND user_id = ?',
      [body.archived, params.id, user.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    return { message: body.archived ? 'Conversation archived' : 'Conversation unarchived' };
  });

  // Bulk Delete Conversations
  fastify.delete('/conversations', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete multiple or all conversations',
      tags: ['chat'],
      body: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' } },
          all: { type: 'boolean' }
        }
      },
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = bulkDeleteSchema.parse(request.body);

    if (body.all) {
      await fastify.db.execute(
        'DELETE FROM conversations WHERE user_id = ?',
        [user.id]
      );
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'bulk_delete_all', 'conversation', 0, request.ip]
      );
      return { message: 'All conversations deleted' };
    } else if (body.ids && body.ids.length > 0) {
      const placeholders = body.ids.map(() => '?').join(',');
      await fastify.db.execute(
        `DELETE FROM conversations WHERE id IN (${placeholders}) AND user_id = ?`,
        [...body.ids, user.id]
      );
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'bulk_delete', 'conversation', body.ids.length, request.ip]
      );
      return { message: `${body.ids.length} conversations deleted` };
    } else {
      return reply.status(400).send({ error: 'Must provide "ids" array or "all": true' });
    }
  });

  // Bulk Archive Conversations
  fastify.patch('/conversations/archive', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Archive or unarchive multiple/all conversations',
      tags: ['chat'],
      body: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' } },
          all: { type: 'boolean' },
          archived: { type: 'boolean' }
        },
        required: ['archived']
      },
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = bulkArchiveSchema.parse(request.body);

    const targetState = body.archived;

    if (body.all) {
      await fastify.db.execute(
        'UPDATE conversations SET is_archived = ? WHERE user_id = ?',
        [targetState, user.id]
      );
      return { message: targetState ? 'All conversations archived' : 'All conversations unarchived' };
    } else if (body.ids && body.ids.length > 0) {
      const placeholders = body.ids.map(() => '?').join(',');
      await fastify.db.execute(
        `UPDATE conversations SET is_archived = ? WHERE id IN (${placeholders}) AND user_id = ?`,
        [targetState, ...body.ids, user.id]
      );
      return { message: targetState ? `${body.ids.length} conversations archived` : `${body.ids.length} conversations unarchived` };
    } else {
      return reply.status(400).send({ error: 'Must provide "ids" array or "all": true' });
    }
  });
}
