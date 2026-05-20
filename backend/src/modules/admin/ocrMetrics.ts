/**
 * Admin route: OCR cache metrics (F6).
 * GET /api/admin/ocr-metrics — returns in-process counters from OCRCacheService.
 * Counters are per-pod (not aggregated across replicas).
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdmin } from '../../middleware/index.js';
import {
  getOCRCacheStats,
  resetOCRCacheStats,
} from '../../services/document-processing/OCRCacheService.js';

export async function ocrMetricsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/ocr-metrics',
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      onRequest: [(fastify as any).authenticate, requireAdmin],
      schema: {
        description: 'Per-pod OCR cache counters (page + doc level)',
        tags: ['admin'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const stats = getOCRCacheStats();
      return {
        hostname: process.env.HOSTNAME || 'unknown',
        timestamp: new Date().toISOString(),
        ...stats,
      };
    },
  );

  fastify.post(
    '/ocr-metrics/reset',
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      onRequest: [(fastify as any).authenticate, requireAdmin],
      schema: {
        description: 'Reset OCR cache counters (does NOT evict cached entries)',
        tags: ['admin'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      resetOCRCacheStats();
      return { reset: true, timestamp: new Date().toISOString() };
    },
  );
}
