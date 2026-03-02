import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readdir, stat, createReadStream } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { MetricsService } from '../../services/MetricsService.js';

const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);

const APK_DIR = process.env.APK_DIR || join(process.env.PROJECTS_PATH || '/data/projects', 'apk');

export async function publicRoutes(fastify: FastifyInstance) {
    // Public metrics endpoint — no authentication, no IP restriction
    // Security: only exposes system metrics (CPU, memory, etc.), no sensitive data
    // The page URL itself (/metrics) serves as the access control
    fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const metrics = await MetricsService.getExhaustiveMetrics(fastify.db);
            return metrics;
        } catch (error: any) {
            fastify.log.error(`[PublicMetrics] Error: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to fetch metrics' });
        }
    });

    // Public APK download — no authentication required
    // Serves the latest APK from the APK directory
    fastify.get('/downloads/apk', async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const files = await readdirAsync(APK_DIR);
            const apkFiles = files.filter(f => f.endsWith('.apk'));

            if (apkFiles.length === 0) {
                return reply.status(404).send({ error: 'No APK available for download' });
            }

            // Sort by modification time descending (most recent first)
            const filesWithStats = await Promise.all(apkFiles.map(async (filename) => {
                const filepath = join(APK_DIR, filename);
                const fileStat = await statAsync(filepath);
                return { filename, filepath, mtime: fileStat.mtime, size: fileStat.size };
            }));
            filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            const latest = filesWithStats[0];
            const stream = createReadStream(latest.filepath);

            return reply
                .header('Content-Type', 'application/vnd.android.package-archive')
                .header('Content-Disposition', `attachment; filename="${latest.filename}"`)
                .header('Content-Length', latest.size)
                .send(stream);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return reply.status(404).send({ error: 'APK directory not found' });
            }
            fastify.log.error(`[PublicAPK] Error: ${err.message}`);
            return reply.status(500).send({ error: 'Failed to download APK' });
        }
    });
}
