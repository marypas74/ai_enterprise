/**
 * Image Generation routes — handles image creation via OllamaDiffuser.
 *
 * Integrates with the chat flow: images are saved as messages in conversations
 * and served via SSE like regular completions.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, insertOne } from '../../database/index.js';
import { generateImage, isDiffuserHealthy } from '../../services/DiffuserProvider.js';

const imageGenerationSchema = z.object({
  prompt: z.string().min(1).max(2000),
  conversationId: z.number().optional(),
  width: z.number().min(256).max(2048).default(1024),
  height: z.number().min(256).max(2048).default(1024),
  model: z.string().default('stable-diffusion-1.5'),
  negativePrompt: z.string().max(1000).optional(),
  numInferenceSteps: z.number().min(1).max(100).default(20),
  guidanceScale: z.number().min(0).max(30).default(7.5),
});

export async function imageGenerationRoutes(fastify: FastifyInstance) {
  // Health check for diffuser service
  fastify.get('/image/health', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Check OllamaDiffuser health',
      tags: ['chat'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const healthy = await isDiffuserHealthy();
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'unavailable',
      service: 'ollamadiffuser',
    });
  });

  // Generate image (SSE streaming response)
  fastify.post('/image/generate', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Generate an image via OllamaDiffuser (SSE)',
      tags: ['chat'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    let body: z.infer<typeof imageGenerationSchema>;
    try {
      body = imageGenerationSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    // SSE headers
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const writeSse = (data: Record<string, unknown>) => {
      if (!raw.writableEnded) {
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      // Get or create conversation (with ownership check)
      let conversationId = body.conversationId;
      if (conversationId) {
        const conv = await findOne<{ user_id: number }>(
          fastify.db, 'SELECT user_id FROM conversations WHERE id = ?', [conversationId]);
        if (!conv || conv.user_id !== user.id) {
          writeSse({ type: 'error', error: 'Conversation not found or access denied' });
          writeSse({ done: true });
          raw.end();
          return;
        }
      }
      if (!conversationId) {
        const title = body.prompt.length > 50
          ? body.prompt.substring(0, 50) + '...'
          : body.prompt;
        conversationId = await insertOne(
          fastify.db,
          'INSERT INTO conversations (user_id, title, model) VALUES (?, ?, ?)',
          [user.id, `[Image] ${title}`, body.model]
        );
      }

      // Save user message
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content, content_type) VALUES (?, ?, ?, ?)',
        [conversationId, 'user', body.prompt, 'text']
      );

      // Send generating event
      writeSse({
        type: 'image_generating',
        model: body.model,
        prompt: body.prompt,
        conversationId,
      });

      // Generate image
      const result = await generateImage({
        prompt: body.prompt,
        negativePrompt: body.negativePrompt,
        width: body.width,
        height: body.height,
        numInferenceSteps: body.numInferenceSteps,
        guidanceScale: body.guidanceScale,
        model: body.model,
      });

      // Save assistant message with image URL
      const imageMarkdown = `![Generated Image](${result.url})\n\n*Model: ${result.model} | ${result.width}x${result.height} | Seed: ${result.seed} | ${(result.generationTimeMs / 1000).toFixed(1)}s*`;
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content, content_type, model) VALUES (?, ?, ?, ?, ?)',
        [conversationId, 'assistant', imageMarkdown, 'image', result.model]
      );

      // Update conversation timestamp
      await fastify.db.execute(
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId]
      );

      // Send result
      writeSse({
        type: 'image_ready',
        url: result.url,
        filename: result.filename,
        width: result.width,
        height: result.height,
        model: result.model,
        seed: result.seed,
        generationTimeMs: result.generationTimeMs,
        conversationId,
      });

      // Record usage
      try {
        await insertOne(
          fastify.db,
          `INSERT INTO token_usage (user_id, model, provider, tokens_input, tokens_output, cost_usd, conversation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [user.id, result.model, 'diffuser', body.prompt.length, 0, 0, conversationId]
        );
      } catch { /* non-critical */ }

      // Audit log
      try {
        await insertOne(
          fastify.db,
          'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
          [user.id, 'generate_image', 'conversation', conversationId,
            JSON.stringify({ model: result.model, prompt: body.prompt.substring(0, 200), generationTimeMs: result.generationTimeMs }),
            request.ip]
        );
      } catch { /* non-critical */ }

      writeSse({ done: true });
    } catch (err: any) {
      fastify.log.error(`[ImageGen] Error: ${err.message}`);
      writeSse({
        type: 'error',
        error: 'Image generation failed. Please try again.',
      });
      writeSse({ done: true });
    }

    raw.end();
  });
}
