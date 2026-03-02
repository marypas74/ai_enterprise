/**
 * Voice routes — Speech-to-Text (STT) and Text-to-Speech (TTS).
 *
 * Uses OpenAI Whisper API for transcription and OpenAI TTS API for synthesis.
 * Designed for the Android APK voice interface (similar to OpenAI's voice mode).
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { insertOne } from '../../database/index.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const synthesizeSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('nova'),
  speed: z.number().min(0.25).max(4.0).default(1.0),
  model: z.enum(['tts-1', 'tts-1-hd']).default('tts-1'),
});

export async function voiceRoutes(fastify: FastifyInstance) {
  // ── Speech-to-Text (Whisper) ──────────────────────────────────────
  fastify.post('/voice/transcribe', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Transcribe audio to text using OpenAI Whisper',
      tags: ['chat'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    if (!OPENAI_API_KEY) {
      return reply.status(503).send({ error: 'OpenAI API key not configured for voice transcription' });
    }

    const ALLOWED_AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a']);
    const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB (Whisper limit)

    // Parse multipart form data
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' });
    }

    // Validate MIME type
    if (!ALLOWED_AUDIO_TYPES.has(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid audio format. Supported: webm, mp4, mpeg, wav, ogg, m4a' });
    }

    try {
      const audioBuffer = await data.toBuffer();

      // Validate file size
      if (audioBuffer.length > MAX_AUDIO_BYTES) {
        return reply.status(413).send({ error: 'Audio file too large. Maximum 25 MB.' });
      }

      // Build FormData for OpenAI Whisper API
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: data.mimetype });
      formData.append('file', blob, `voice_${Date.now()}.webm`);
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');
      // Omit language param — Whisper auto-detects accurately

      const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        fastify.log.error(`[Voice] Whisper API error (${response.status}): ${errorText}`);
        return reply.status(502).send({ error: 'Transcription service unavailable. Please try again.' });
      }

      const result = await response.json() as { text: string };

      // Audit log
      try {
        await insertOne(
          fastify.db,
          'INSERT INTO audit_log (user_id, action, entity_type, details, ip_address) VALUES (?, ?, ?, ?, ?)',
          [user.id, 'voice_transcribe', 'voice', JSON.stringify({ textLength: result.text.length }), request.ip]
        );
      } catch { /* non-critical */ }

      return { text: result.text };
    } catch (err: any) {
      fastify.log.error(`[Voice] Transcription error: ${err.message}`);
      return reply.status(500).send({ error: 'Transcription failed. Please try again.' });
    }
  });

  // ── Text-to-Speech (TTS) ──────────────────────────────────────────
  fastify.post('/voice/synthesize', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Convert text to speech using OpenAI TTS',
      tags: ['chat'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!OPENAI_API_KEY) {
      return reply.status(503).send({ error: 'OpenAI API key not configured for voice synthesis' });
    }

    let body: z.infer<typeof synthesizeSchema>;
    try {
      body = synthesizeSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    try {
      const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: body.model,
          input: body.text,
          voice: body.voice,
          speed: body.speed,
          response_format: 'mp3',
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        fastify.log.error(`[Voice] TTS API error (${response.status}): ${errorText}`);
        return reply.status(502).send({ error: 'Speech synthesis service unavailable. Please try again.' });
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', audioBuffer.length)
        .send(audioBuffer);
    } catch (err: any) {
      fastify.log.error(`[Voice] TTS error: ${err.message}`);
      return reply.status(500).send({ error: 'Speech synthesis failed. Please try again.' });
    }
  });
}
