/**
 * Ralph Loop API Routes
 * Self-referential AI development loop - works with ANY model
 *
 * Based on: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ralphLoopService, RalphLoopConfig } from '../../services/RalphLoopService.js';
import { AIProviderFactory } from '../ai/providers.js';

// Validation schemas
const startLoopSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().min(1, 'Model is required'),
  maxIterations: z.number().int().min(0).optional().default(0),
  completionPromise: z.string().optional(),
  conversationId: z.number().optional()
});

const stopLoopSchema = z.object({
  reason: z.string().optional().default('Manual stop')
});

export async function ralphRoutes(fastify: FastifyInstance) {
  /**
   * Start a new Ralph loop
   * POST /api/ralph/start
   */
  fastify.post('/start', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Start a new Ralph loop',
      tags: ['ralph'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const body = startLoopSchema.parse(request.body);

      // Check if user already has an active loop
      const existingLoops = ralphLoopService.getUserLoops(user.id);
      if (existingLoops.length > 0) {
        return reply.status(400).send({
          error: 'Loop already active',
          message: 'You already have an active Ralph loop. Stop it first with DELETE /api/ralph/{loopId}',
          activeLoops: existingLoops.map(l => ({
            id: l.id,
            iteration: l.iteration,
            model: l.model,
            startedAt: l.startedAt
          }))
        });
      }

      // Start the loop
      const config: RalphLoopConfig = {
        prompt: body.prompt,
        model: body.model,
        maxIterations: body.maxIterations,
        completionPromise: body.completionPromise,
        userId: user.id,
        conversationId: body.conversationId
      };

      const loop = ralphLoopService.startLoop(config);

      fastify.log.info(`[Ralph] User ${user.id} started loop ${loop.id} with model ${body.model}`);

      return reply.status(201).send({
        success: true,
        message: '🔄 Ralph loop started!',
        loop: {
          id: loop.id,
          model: loop.model,
          iteration: loop.iteration,
          maxIterations: loop.maxIterations || 'unlimited',
          completionPromise: loop.completionPromise,
          status: loop.status,
          startedAt: loop.startedAt
        },
        instructions: {
          monitor: `GET /api/ralph/${loop.id}`,
          stop: `DELETE /api/ralph/${loop.id}`,
          iterate: `POST /api/ralph/${loop.id}/iterate`
        }
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      fastify.log.error(`[Ralph] Start error: ${error.message}`);
      return reply.status(400).send({
        error: 'Failed to start loop',
        message: error.message
      });
    }
  });

  /**
   * Execute next iteration of a Ralph loop
   * This calls the AI model with the loop prompt
   * POST /api/ralph/:loopId/iterate
   */
  fastify.post('/:loopId/iterate', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Execute next iteration of Ralph loop',
      tags: ['ralph'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { loopId } = request.params as { loopId: string };

    try {
      const loop = ralphLoopService.getLoop(loopId);

      if (!loop) {
        return reply.status(404).send({
          error: 'Loop not found',
          message: `No loop with ID ${loopId}`
        });
      }

      if (loop.userId !== user.id) {
        return reply.status(403).send({
          error: 'Access denied',
          message: 'This loop belongs to another user'
        });
      }

      if (!loop.active) {
        return reply.status(400).send({
          error: 'Loop not active',
          message: `Loop status: ${loop.status}`,
          finalIteration: loop.iteration
        });
      }

      // Get the prompt for this iteration
      const prompt = ralphLoopService.getNextIterationPrompt(loopId);
      if (!prompt) {
        return reply.status(500).send({
          error: 'Failed to generate prompt',
          message: 'Could not generate iteration prompt'
        });
      }

      // Get AI provider for the model
      const provider = AIProviderFactory.getProvider(loop.model);

      // Set up SSE streaming for real-time response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Ralph-Loop-Id': loopId,
        'X-Ralph-Iteration': (loop.iteration + 1).toString()
      });

      let fullResponse = '';

      try {
        // Stream the AI response
        const stream = provider.streamComplete({
          model: loop.model,
          messages: [
            { role: 'system', content: 'You are working on an iterative task. Continue from where you left off and work towards completion.' },
            { role: 'user', content: prompt }
          ],
          maxTokens: 4096,
          temperature: 0.7,
          stream: true
        });

        for await (const chunk of stream) {
          if (chunk.content) {
            fullResponse += chunk.content;
            reply.raw.write(`data: ${JSON.stringify({
              type: 'content',
              content: chunk.content,
              iteration: loop.iteration + 1
            })}\n\n`);
          }
        }

        // Process the iteration result
        const result = ralphLoopService.processIteration(loopId, fullResponse);

        // Send completion event
        reply.raw.write(`data: ${JSON.stringify({
          type: 'done',
          iteration: result.iteration,
          completionDetected: result.completionDetected,
          continueLoop: result.continueLoop,
          status: loop.status
        })}\n\n`);

        reply.raw.end();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (streamError: any) {
        fastify.log.error(`[Ralph] Stream error: ${streamError.message}`);
        reply.raw.write(`data: ${JSON.stringify({
          type: 'error',
          error: streamError.message
        })}\n\n`);
        reply.raw.end();
      }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      fastify.log.error(`[Ralph] Iterate error: ${error.message}`);
      return reply.status(500).send({
        error: 'Iteration failed',
        message: error.message
      });
    }
  });

  /**
   * Get loop status
   * GET /api/ralph/:loopId
   */
  fastify.get('/:loopId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get Ralph loop status',
      tags: ['ralph'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { loopId } = request.params as { loopId: string };

    const loop = ralphLoopService.getLoop(loopId);

    if (!loop) {
      return reply.status(404).send({
        error: 'Loop not found',
        message: `No loop with ID ${loopId}`
      });
    }

    if (loop.userId !== user.id) {
      return reply.status(403).send({
        error: 'Access denied',
        message: 'This loop belongs to another user'
      });
    }

    return reply.send({
      id: loop.id,
      active: loop.active,
      model: loop.model,
      iteration: loop.iteration,
      maxIterations: loop.maxIterations || 'unlimited',
      completionPromise: loop.completionPromise,
      status: loop.status,
      startedAt: loop.startedAt,
      lastIterationAt: loop.lastIterationAt,
      outputCount: loop.outputs.length,
      // Include last output preview
      lastOutput: loop.outputs.length > 0
        ? loop.outputs[loop.outputs.length - 1].substring(0, 500)
        : null
    });
  });

  /**
   * Get all user's loops
   * GET /api/ralph
   */
  fastify.get('/', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all Ralph loops for current user',
      tags: ['ralph'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    const loops = ralphLoopService.getUserLoops(user.id);

    return reply.send({
      count: loops.length,
      loops: loops.map(l => ({
        id: l.id,
        active: l.active,
        model: l.model,
        iteration: l.iteration,
        maxIterations: l.maxIterations || 'unlimited',
        status: l.status,
        startedAt: l.startedAt
      }))
    });
  });

  /**
   * Stop a Ralph loop
   * DELETE /api/ralph/:loopId
   */
  fastify.delete('/:loopId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Stop a Ralph loop',
      tags: ['ralph'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const { loopId } = request.params as { loopId: string };

    try {
      const body = request.body ? stopLoopSchema.parse(request.body) : { reason: 'Manual stop' };

      const loop = ralphLoopService.getLoop(loopId);

      if (!loop) {
        return reply.status(404).send({
          error: 'Loop not found',
          message: `No loop with ID ${loopId}`
        });
      }

      if (loop.userId !== user.id) {
        return reply.status(403).send({
          error: 'Access denied',
          message: 'This loop belongs to another user'
        });
      }

      const stopped = ralphLoopService.stopLoop(loopId, body.reason);

      if (stopped) {
        fastify.log.info(`[Ralph] User ${user.id} stopped loop ${loopId}`);
        return reply.send({
          success: true,
          message: '🛑 Ralph loop stopped',
          loop: {
            id: loop.id,
            finalIteration: loop.iteration,
            status: 'stopped',
            reason: body.reason
          }
        });
      } else {
        return reply.status(500).send({
          error: 'Failed to stop loop',
          message: 'Unknown error stopping the loop'
        });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      return reply.status(400).send({
        error: 'Failed to stop loop',
        message: error.message
      });
    }
  });

  /**
   * Get Ralph loop statistics (admin only)
   * GET /api/ralph/stats
   */
  fastify.get('/stats', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get Ralph loop statistics',
      tags: ['ralph'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number; role: string };

    if (user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Admin only',
        message: 'Statistics are only available to admins'
      });
    }

    const stats = ralphLoopService.getStats();

    return reply.send(stats);
  });
}

export default ralphRoutes;
