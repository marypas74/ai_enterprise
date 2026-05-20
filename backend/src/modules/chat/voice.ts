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
const PIPER_TTS_URL = process.env.PIPER_TTS_URL || 'http://10.0.1.1:5500';

/**
 * Server-side safety net: clean text for TTS synthesis.
 * Strips markdown, code blocks, URLs, and HTML tags.
 */
function cleanTextForTTS(text: string): string {
  let result = text;
  result = result.replace(/```[\s\S]*?```/g, ' Codice omesso. ');
  result = result.replace(/`([^`]+)`/g, '$1');
  result = result.replace(/^#{1,6}\s+/gm, '');
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/___(.+?)___/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  result = result.replace(/https?:\/\/[^\s)]+/g, 'un link');
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');
  result = result.replace(/^>\s*/gm, '');
  result = result.replace(/^[\t ]*[-*]\s+/gm, '');
  result = result.replace(/^[\t ]*\d+\.\s+/gm, '');
  result = result.replace(/^\|.*\|$/gm, '');
  result = result.replace(/^[-|: ]+$/gm, '');
  result = result.replace(/<[^>]+>/g, '');
  result = result.replace(/\n{2,}/g, '. ');
  result = result.replace(/\n/g, ' ');
  result = result.replace(/\s{2,}/g, ' ');
  result = result.replace(/\.\s*\.\s*/g, '. ');
  return result.trim();
}

const synthesizeSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('nova'),
  speed: z.number().min(0.25).max(4.0).default(1.0),
  model: z.enum(['tts-1', 'tts-1-hd']).default('tts-1'),
});

export async function voiceRoutes(fastify: FastifyInstance) {
  // ── Speech-to-Text (Whisper) ──────────────────────────────────────
  fastify.post('/voice/transcribe', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      fastify.log.error(`[Voice] Transcription error: ${err.message}`);
      return reply.status(500).send({ error: 'Transcription failed. Please try again.' });
    }
  });

  // ── Text-to-Speech (TTS) ──────────────────────────────────────────
  fastify.post('/voice/synthesize', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      description: 'Convert text to speech using OpenAI TTS',
      tags: ['chat'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let body: z.infer<typeof synthesizeSchema>;
    try {
      body = synthesizeSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    // Clean text for natural speech
    const ttsText = cleanTextForTTS(body.text);
    if (!ttsText) {
      return reply.status(400).send({ error: 'No speakable text after preprocessing' });
    }

    // Try OpenAI first, fall back to local Piper TTS
    if (OPENAI_API_KEY && !OPENAI_API_KEY.startsWith('REPLACE')) {
      try {
        const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: body.model,
            input: ttsText,
            voice: body.voice,
            speed: body.speed,
            response_format: 'mp3',
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const audioBuffer = Buffer.from(await response.arrayBuffer());
          return reply
            .header('Content-Type', 'audio/mpeg')
            .header('Content-Length', audioBuffer.length)
            .send(audioBuffer);
        }
        fastify.log.warn(`[Voice] OpenAI TTS failed (${response.status}), falling back to Piper local`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        fastify.log.warn(`[Voice] OpenAI TTS error: ${err.message}, falling back to Piper local`);
      }
    }

    // Fallback: Piper TTS (local, no API key needed)
    try {
      fastify.log.info(`[Voice] Using Piper local TTS at ${PIPER_TTS_URL}`);
      const piperResponse = await fetch(`${PIPER_TTS_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ttsText }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!piperResponse.ok) {
        const errText = await piperResponse.text().catch(() => '');
        fastify.log.error(`[Voice] Piper TTS error (${piperResponse.status}): ${errText}`);
        return reply.status(502).send({ error: 'Speech synthesis service unavailable.' });
      }

      const audioBuffer = Buffer.from(await piperResponse.arrayBuffer());
      return reply
        .header('Content-Type', 'audio/wav')
        .header('Content-Length', audioBuffer.length)
        .send(audioBuffer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      fastify.log.error(`[Voice] Piper TTS error: ${err.message}`);
      return reply.status(500).send({ error: 'Speech synthesis failed.' });
    }
  });
}
