/**
 * File Operations API - Enables AI agents to write/read files
 * This is the backend component of the "Claude Dev" functionality
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
  getProjectFolder,
  projectFolderExists,
} from '../../services/StorageService.js';
import { findOne } from '../../database/index.js';

// Schemas
const writeFileSchema = z.object({
  projectId: z.number(),
  path: z.string().min(1).max(500),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8'),
});

const readFileSchema = z.object({
  projectId: z.number(),
  path: z.string().min(1).max(500),
});

const listFilesSchema = z.object({
  projectId: z.number(),
  subPath: z.string().optional(),
});

export default async function fileRoutes(fastify: FastifyInstance) {
  // Helper: Get user and project info for storage path
  async function getStorageContext(userId: number, projectId: number) {
    const user = await findOne<{ name: string; email: string }>(
      fastify.db,
      'SELECT name, email FROM users WHERE id = ?',
      [userId]
    );

    const project = await findOne<{ name: string; owner_id: number }>(
      fastify.db,
      'SELECT name, owner_id FROM projects WHERE id = ?',
      [projectId]
    );

    if (!project) {
      throw new Error('Project not found');
    }

    // Get project owner's name for folder path
    const owner = await findOne<{ name: string; email: string }>(
      fastify.db,
      'SELECT name, email FROM users WHERE id = ?',
      [project.owner_id]
    );

    const userName = owner?.name || owner?.email?.split('@')[0] || `user_${project.owner_id}`;

    return { userName, projectName: project.name };
  }

  /**
   * Write file to project storage
   * POST /api/files/write
   */
  fastify.post('/write', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Write file to project storage (for AI code generation)',
      tags: ['files'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const body = writeFileSchema.parse(request.body);

      const { userName, projectName } = await getStorageContext(userId, body.projectId);

      // Decode base64 content if needed
      let content = body.content;
      if (body.encoding === 'base64') {
        content = Buffer.from(body.content, 'base64').toString('utf-8');
      }

      // Write file
      const fullPath = await writeProjectFile(userName, projectName, body.path, content);

      fastify.log.info(`[Files] User ${userId} wrote file: ${fullPath}`);

      return {
        success: true,
        path: body.path,
        fullPath,
        size: content.length,
      };
    } catch (error: any) {
      fastify.log.error(`[Files] Write error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Read file from project storage
   * POST /api/files/read
   */
  fastify.post('/read', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Read file from project storage',
      tags: ['files'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const body = readFileSchema.parse(request.body);

      const { userName, projectName } = await getStorageContext(userId, body.projectId);

      const content = await readProjectFile(userName, projectName, body.path);

      if (content === null) {
        return reply.status(404).send({ error: 'File not found' });
      }

      return {
        success: true,
        path: body.path,
        content,
        size: content.length,
      };
    } catch (error: any) {
      fastify.log.error(`[Files] Read error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * List files in project storage
   * POST /api/files/list
   */
  fastify.post('/list', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List files in project storage',
      tags: ['files'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const body = listFilesSchema.parse(request.body);

      const { userName, projectName } = await getStorageContext(userId, body.projectId);

      const files = await listProjectFiles(userName, projectName, body.subPath);

      return {
        success: true,
        files,
        count: files.length,
        basePath: getProjectFolder(userName, projectName),
      };
    } catch (error: any) {
      fastify.log.error(`[Files] List error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get project storage info
   * GET /api/files/info/:projectId
   */
  fastify.get('/info/:projectId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get project storage information',
      tags: ['files'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    try {
      const userId = (request.user as any).id;
      const projectId = Number(request.params.projectId);

      const { userName, projectName } = await getStorageContext(userId, projectId);

      const basePath = getProjectFolder(userName, projectName);
      const exists = projectFolderExists(userName, projectName);

      return {
        success: true,
        projectId,
        basePath,
        exists,
        userName,
        projectName,
      };
    } catch (error: any) {
      fastify.log.error(`[Files] Info error: ${error.message}`);
      return reply.status(500).send({ error: error.message });
    }
  });
}
