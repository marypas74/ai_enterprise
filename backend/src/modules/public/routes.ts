import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MetricsService } from '../../services/MetricsService.js';

// Allowed IPs for metrics endpoint (from METRICS_ALLOWED_IPS env var)
// Supports exact IPs and IPv6 prefix: "217.198.133.248,2a00:6d43:906::"
const ALLOWED_IP_ENTRIES = (process.env.METRICS_ALLOWED_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean);

// Private/infrastructure CIDRs that bypass IP check
const INTERNAL_PREFIXES = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
    '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
    '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '127.', '::1', '::ffff:127.'];

function isInternalIp(ip: string): boolean {
    return INTERNAL_PREFIXES.some(prefix => ip.startsWith(prefix));
}

function isAllowedIp(ip: string): boolean {
    if (ALLOWED_IP_ENTRIES.length === 0) return true;
    const ipLower = ip.toLowerCase();
    return ALLOWED_IP_ENTRIES.some(entry => {
        const entryLower = entry.replace(/\/\d+$/, '').toLowerCase(); // strip optional /N suffix
        // Prefix match: entries ending with "::" match any IP starting with that prefix
        if (entryLower.endsWith('::')) {
            return ipLower.startsWith(entryLower.slice(0, -1)); // "2a00:6d43:906::" → match "2a00:6d43:906:"
        }
        return ipLower === entryLower;
    });
}

function getClientIp(request: FastifyRequest): string {
    // Cloudflare Tunnel sets CF-Connecting-IP to the real client IP
    const cfIp = request.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return cfIp;
    // Fallback to X-Forwarded-For or direct IP
    const xff = request.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    return request.ip;
}

export async function publicRoutes(fastify: FastifyInstance) {
    // Metrics endpoint — IP restriction via CF-Connecting-IP header
    fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
        const clientIp = getClientIp(request);

        // Allow internal/infrastructure IPs
        if (!isInternalIp(clientIp)) {
            // External IP — must be in allowed list
            if (!isAllowedIp(clientIp)) {
                fastify.log.warn(`[PublicMetrics] Blocked external IP: ${clientIp}`);
                return reply.status(403).send({ error: 'Forbidden' });
            }
        }

        try {
            const metrics = await MetricsService.getExhaustiveMetrics(fastify.db);
            return metrics;
        } catch (error: any) {
            fastify.log.error(`[PublicMetrics] Error: ${error.message}`);
            return reply.status(500).send({ error: 'Failed to fetch metrics' });
        }
    });
}
