/**
 * Claude Agent SDK Routes
 *
 * API endpoints for running Claude agents with the Agent SDK.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getClaudeAgentService, AgentConfig } from '../../services/ClaudeAgentService.js';

// Validation schemas
const runAgentSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  maxTurns: z.number().min(1).max(50).optional(),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions']).optional(),
  workingDirectory: z.string().optional()
});

const codeReviewSchema = z.object({
  filePath: z.string().min(1),
  model: z.string().optional()
});

const bugFixSchema = z.object({
  description: z.string().min(1),
  workingDirectory: z.string().min(1),
  model: z.string().optional(),
  autoFix: z.boolean().optional()
});

const featureSchema = z.object({
  description: z.string().min(1),
  workingDirectory: z.string().min(1),
  model: z.string().optional()
});

export async function agentSdkRoutes(fastify: FastifyInstance) {
  const agentService = getClaudeAgentService();

  // Run a generic agent
  fastify.post('/sdk/run', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Run a Claude agent with custom prompt',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = runAgentSchema.parse(request.body);

      const config: AgentConfig = {
        model: body.model,
        maxTurns: body.maxTurns,
        systemPrompt: body.systemPrompt,
        allowedTools: body.allowedTools,
        permissionMode: body.permissionMode,
        workingDirectory: body.workingDirectory
      };

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Run agent and stream responses
      for await (const response of agentService.runAgent(body.prompt, config)) {
        reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);

        if (response.type === 'done' || response.type === 'error') {
          break;
        }
      }

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Code review agent
  fastify.post('/sdk/code-review', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Run a code review agent on a file',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = codeReviewSchema.parse(request.body);

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Run code review agent
      for await (const response of agentService.codeReviewAgent(body.filePath, {
        model: body.model
      })) {
        reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);

        if (response.type === 'done' || response.type === 'error') {
          break;
        }
      }

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Bug fix agent
  fastify.post('/sdk/bug-fix', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Run a bug fix agent',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = bugFixSchema.parse(request.body);

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Run bug fix agent
      for await (const response of agentService.bugFixAgent(body.description, body.workingDirectory, {
        model: body.model,
        permissionMode: body.autoFix ? 'acceptEdits' : 'default'
      })) {
        reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);

        if (response.type === 'done' || response.type === 'error') {
          break;
        }
      }

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Feature implementation agent
  fastify.post('/sdk/feature', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Run a feature implementation agent',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = featureSchema.parse(request.body);

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Run feature agent
      for await (const response of agentService.featureAgent(body.description, body.workingDirectory, {
        model: body.model,
        permissionMode: 'acceptEdits'
      })) {
        reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);

        if (response.type === 'done' || response.type === 'error') {
          break;
        }
      }

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Get active agent sessions
  fastify.get('/sdk/sessions', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get active agent sessions',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const sessions = agentService.getActiveSessions();
    return { sessions };
  });

  // Cancel an agent session
  fastify.post('/sdk/sessions/:sessionId/cancel', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Cancel an active agent session',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    const cancelled = agentService.cancelSession(sessionId);

    if (cancelled) {
      return { success: true, message: 'Session cancelled' };
    } else {
      return reply.status(404).send({ error: 'Session not found or already completed' });
    }
  });

  // Get session details
  fastify.get('/sdk/sessions/:sessionId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get agent session details',
      tags: ['agents', 'sdk'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = agentService.getSession(sessionId);

    if (session) {
      return session;
    } else {
      return reply.status(404).send({ error: 'Session not found' });
    }
  });
}

export default agentSdkRoutes;
