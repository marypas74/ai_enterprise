import { z } from 'zod';
import { FastifyRequest } from 'fastify';

// ── Schemas ──────────────────────────────────────────────────────────
export const consentSchema = z.object({
  consent_type: z.enum(['ai_disclosure', 'data_processing', 'terms_of_service', 'cookie']),
  granted: z.boolean(),
});

export const feedbackSchema = z.object({
  message_id: z.number(),
  rating: z.union([z.literal(-1), z.literal(1)]),
  category: z.enum(['accurate', 'inaccurate', 'harmful', 'biased', 'helpful', 'other']).optional(),
  comment: z.string().max(1000).optional(),
});

export const dataExportSchema = z.object({
  format: z.enum(['json']).default('json'),
});

export const deleteAccountSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const modelDocsUpdateSchema = z.object({
  knowledge_cutoff: z.string().max(20).optional(),
  limitations: z.string().max(2000).optional(),
  bias_notes: z.string().max(2000).optional(),
  safety_rating: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
  documentation_url: z.string().url().max(500).optional(),
});

export const revokeConsentSchema = z.object({
  consent_type: z.enum(['ai_disclosure', 'data_processing', 'terms_of_service', 'cookie']),
});

// ── Types ────────────────────────────────────────────────────────────
export interface UserPayload {
  id: number;
  role: string;
  sid?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────
export function safeParseInt(value: string | undefined, defaultVal: number, max?: number): number {
  const parsed = parseInt(value || String(defaultVal), 10);
  const safe = isNaN(parsed) || parsed < 0 ? defaultVal : parsed;
  return max !== undefined ? Math.min(safe, max) : safe;
}

/** Get real client IP behind Cloudflare Tunnel (which sets CF-Connecting-IP). */
export function getRealIp(request: FastifyRequest): string {
  const cfIp = request.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.length > 0) return cfIp;
  return request.ip;
}
