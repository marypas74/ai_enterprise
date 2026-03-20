import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApprovalService } from './ApprovalService.js';
import { getPool } from '../database/connection.js';

const idParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const approveBodySchema = z.object({
  notes: z.string().optional(),
});

const rejectBodySchema = z.object({
  notes: z.string().min(1, 'Rejection notes are required'),
});

export async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ApprovalService(getPool());

  fastify.get('/approvals', {
    preHandler: [fastify.authenticateAdmin],
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const { page, limit } = parsed.data;
    const result = await service.listPending(page, limit);

    return {
      success: true,
      data: result.items,
      error: null,
      meta: { total: result.total, page, limit },
    };
  });

  fastify.post('/approvals/:id/approve', {
    preHandler: [fastify.authenticateAdmin],
  }, async (request, reply) => {
    const paramsParsed = idParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'Invalid approval request ID',
      });
    }

    const bodyParsed = approveBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: bodyParsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const adminId = request.user.id;

    try {
      await service.approve(paramsParsed.data.id, adminId, bodyParsed.data.notes);
      return { success: true, data: null, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval failed';
      const status = message.includes('not found') ? 404
        : message.includes('already been resolved') ? 409
        : 500;
      return reply.status(status).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });

  fastify.post('/approvals/:id/reject', {
    preHandler: [fastify.authenticateAdmin],
  }, async (request, reply) => {
    const paramsParsed = idParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'Invalid approval request ID',
      });
    }

    const bodyParsed = rejectBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: bodyParsed.error.issues.map((i) => i.message).join('; '),
      });
    }

    const adminId = request.user.id;

    try {
      await service.reject(paramsParsed.data.id, adminId, bodyParsed.data.notes);
      return { success: true, data: null, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rejection failed';
      const status = message.includes('not found') ? 404
        : message.includes('already been resolved') ? 409
        : 500;
      return reply.status(status).send({
        success: false,
        data: null,
        error: message,
      });
    }
  });
}
