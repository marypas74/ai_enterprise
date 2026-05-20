import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readdir, stat, createReadStream } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { MetricsService } from '../../services/MetricsService.js';

const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);

const APK_DIR = process.env.APK_DIR || join(process.env.PROJECTS_PATH || '/data/projects', 'apk');
function getLoginGuidePath(): string {
    return process.env.LOGIN_GUIDE_PATH || join(process.env.PROJECTS_PATH || '/app/projects', 'assets', 'login-guide.mp4');
}

// Helper: extract real client IP behind Cloudflare Tunnel
function getClientIp(request: FastifyRequest): string {
    return (request.headers['cf-connecting-ip'] as string) || request.ip;
}

export async function publicRoutes(fastify: FastifyInstance) {
    // SECURITY: Rate limit metrics endpoint — prevents abuse (expensive DB + system queries)
    fastify.get('/metrics', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute',
                keyGenerator: (request: FastifyRequest) => getClientIp(request)
            }
        }
    }, async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const metrics = await MetricsService.getExhaustiveMetrics(fastify.db);
            // Strip heavy process list from public endpoint, keep activeUsers for dashboard
            const { processes, ...safeMetrics } = metrics as Record<string, unknown>;
            return safeMetrics;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (error: any) {
            fastify.log.error(`[PublicMetrics] Error: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to fetch metrics' });
        }
    });

    // Public APK download — no authentication required, rate limited to prevent bandwidth abuse
    fastify.get('/downloads/apk', {
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '1 minute',
                keyGenerator: (request: FastifyRequest) => getClientIp(request)
            }
        }
    }, async (_request: FastifyRequest, reply: FastifyReply) => {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return reply.status(404).send({ error: 'APK directory not found' });
            }
            fastify.log.error(`[PublicAPK] Error: ${err.message}`);
            return reply.status(500).send({ error: 'Failed to download APK' });
        }
    });

    fastify.get('/login-guide.mp4', {
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute',
                keyGenerator: (request: FastifyRequest) => getClientIp(request)
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const fileStat = await statAsync(getLoginGuidePath());
            const totalSize = fileStat.size;
            const rangeHeader = request.headers.range;

            reply.header('Content-Type', 'video/mp4');
            reply.header('Accept-Ranges', 'bytes');
            reply.header('Cache-Control', 'public, max-age=3600');

            if (!rangeHeader) {
                return reply
                    .header('Content-Length', totalSize)
                    .send(createReadStream(getLoginGuidePath()));
            }

            const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
            if (!match) {
                return reply.status(416).header('Content-Range', `bytes */${totalSize}`).send();
            }
            const startStr = match[1];
            const endStr = match[2];
            let start: number;
            let end: number;
            if (startStr === '' && endStr !== '') {
                const suffix = parseInt(endStr, 10);
                start = Math.max(0, totalSize - suffix);
                end = totalSize - 1;
            } else if (startStr !== '') {
                start = parseInt(startStr, 10);
                end = endStr !== '' ? parseInt(endStr, 10) : totalSize - 1;
            } else {
                return reply.status(416).header('Content-Range', `bytes */${totalSize}`).send();
            }

            if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= totalSize) {
                return reply.status(416).header('Content-Range', `bytes */${totalSize}`).send();
            }

            const chunkSize = end - start + 1;
            return reply
                .status(206)
                .header('Content-Range', `bytes ${start}-${end}/${totalSize}`)
                .header('Content-Length', chunkSize)
                .send(createReadStream(getLoginGuidePath(), { start, end }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return reply.status(404).send({ error: 'Login guide video not available' });
            }
            fastify.log.error(`[PublicLoginGuide] Error: ${err.message}`);
            return reply.status(500).send({ error: 'Failed to stream login guide' });
        }
    });
}
