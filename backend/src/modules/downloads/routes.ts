import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readdir, stat, createReadStream } from 'fs';
import { join, resolve, sep } from 'path';
import { promisify } from 'util';
import { findOne } from '../../database/index.js';

const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);

// Path to vscode-extension directory - uses EXTENSION_DIR env var or shared projects path
const EXTENSION_DIR = process.env.EXTENSION_DIR || join(process.env.PROJECTS_PATH || '/data/projects', 'extensions');

export async function downloadRoutes(fastify: FastifyInstance) {
  // Helper: Check if user is authenticated
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  };

  // Get available VS Code extension versions
  fastify.get('/downloads/vscode-extension', {
    onRequest: [requireAuth],
    schema: {
      description: 'Get available VS Code extension versions',
      tags: ['downloads'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const files = await readdirAsync(EXTENSION_DIR);
      const vsixFiles = files.filter(f => f.endsWith('.vsix'));

      // Get file info for each vsix
      const extensions = await Promise.all(vsixFiles.map(async (filename) => {
        const filepath = join(EXTENSION_DIR, filename);
        const fileStat = await statAsync(filepath);

        // Extract version from filename (e.g., enterprise-ai-chat-2.9.1.vsix)
        const match = filename.match(/enterprise-ai-chat-(\d+\.\d+\.\d+)\.vsix/);
        const version = match ? match[1] : 'unknown';

        return {
          filename,
          version,
          size: fileStat.size,
          sizeFormatted: formatBytes(fileStat.size),
          createdAt: fileStat.birthtime,
          modifiedAt: fileStat.mtime
        };
      }));

      // Sort by version descending
      extensions.sort((a, b) => {
        const vA = a.version.split('.').map(Number);
        const vB = b.version.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (vA[i] !== vB[i]) return vB[i] - vA[i];
        }
        return 0;
      });

      return {
        extensions,
        latest: extensions[0] || null
      };
    } catch (err) {
      fastify.log.error('Failed to list VS Code extensions: ' + String(err));
      return reply.status(500).send({ error: 'Failed to list extensions' });
    }
  });

  // View user guide (HTML - from DB)
  fastify.get('/downloads/guides/user', {
    onRequest: [requireAuth],
    schema: {
      description: 'View user guide',
      tags: ['downloads'],
      security: [{ bearerAuth: [] }]
    }
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const guide = await findOne<{ content: string }>(
      fastify.db,
      'SELECT content FROM guide_pages WHERE slug = ?',
      ['user']
    );
    if (!guide) return reply.status(404).send({ error: 'User guide not found' });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(guide.content);
  });

  // View admin guide (HTML - from DB)
  fastify.get('/downloads/guides/admin', {
    onRequest: [requireAuth],
    schema: {
      description: 'View admin guide',
      tags: ['downloads'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const user = (request as any).user;
    if (user?.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const guide = await findOne<{ content: string }>(
      fastify.db,
      'SELECT content FROM guide_pages WHERE slug = ?',
      ['admin']
    );
    if (!guide) return reply.status(404).send({ error: 'Admin guide not found' });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(guide.content);
  });

  // List available guides
  fastify.get('/downloads/guides', {
    onRequest: [requireAuth],
    schema: {
      description: 'List available guides',
      tags: ['downloads'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const user = (request as any).user;
      const guides = [
        {
          id: 'user',
          name: 'Guida Utente',
          description: 'Guida completa per gli utenti della piattaforma',
          filename: 'Enterprise-AI-Chat-Guida-Utente.html',
          url: '/api/downloads/guides/user'
        }
      ];

      if (user?.role === 'admin') {
        guides.push({
          id: 'admin',
          name: 'Guida Amministratore',
          description: 'Guida completa per la configurazione e gestione del sistema',
          filename: 'Enterprise-AI-Chat-Guida-Amministratore.html',
          url: '/api/downloads/guides/admin'
        });
      }

      return { guides };
    } catch (err) {
      fastify.log.error('Failed to list guides: ' + String(err));
      return reply.status(500).send({ error: 'Failed to list guides' });
    }
  });

  // Download specific version or latest
  fastify.get('/downloads/vscode-extension/:version', {
    onRequest: [requireAuth],
    schema: {
      description: 'Download VS Code extension',
      tags: ['downloads'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = request.params as { version: string };
      const version = params.version;

      // Validate version format to prevent path traversal
      if (version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) {
        return reply.status(400).send({ error: 'Invalid version format. Expected X.Y.Z or "latest".' });
      }

      let filename: string;

      if (version === 'latest') {
        // Find latest version
        const files = await readdirAsync(EXTENSION_DIR);
        const vsixFiles = files.filter(f => f.endsWith('.vsix'));

        // Sort by version descending
        vsixFiles.sort((a, b) => {
          const matchA = a.match(/enterprise-ai-chat-(\d+\.\d+\.\d+)\.vsix/);
          const matchB = b.match(/enterprise-ai-chat-(\d+\.\d+\.\d+)\.vsix/);
          const vA = matchA ? matchA[1].split('.').map(Number) : [0, 0, 0];
          const vB = matchB ? matchB[1].split('.').map(Number) : [0, 0, 0];
          for (let i = 0; i < 3; i++) {
            if (vA[i] !== vB[i]) return vB[i] - vA[i];
          }
          return 0;
        });

        filename = vsixFiles[0];
      } else {
        filename = `enterprise-ai-chat-${version}.vsix`;
      }

      if (!filename) {
        return reply.status(404).send({ error: 'Extension not found' });
      }

      const filepath = join(EXTENSION_DIR, filename);

      // Path containment check (defense in depth)
      const resolvedDir = resolve(EXTENSION_DIR);
      const resolvedFile = resolve(filepath);
      if (!resolvedFile.startsWith(resolvedDir + sep)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      // Check if file exists
      try {
        await statAsync(filepath);
      } catch {
        return reply.status(404).send({ error: 'Extension version not found' });
      }

      // Send file as download
      const stream = createReadStream(filepath);

      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(stream);
    } catch (err) {
      fastify.log.error('Failed to download extension: ' + String(err));
      return reply.status(500).send({ error: 'Failed to download extension' });
    }
  });
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
