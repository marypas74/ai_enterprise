/**
 * Chat Attachments API - Route aggregator
 * Delegates to upload.ts for routes and processing.ts for async processing
 */

import { FastifyInstance } from 'fastify';
import { registerUploadRoutes } from './upload.js';

// Re-export extractPdfText for backward compatibility (used in tests)
export { extractPdfText } from './processing.js';

export async function attachmentRoutes(fastify: FastifyInstance) {
  await registerUploadRoutes(fastify);
}

export default attachmentRoutes;
