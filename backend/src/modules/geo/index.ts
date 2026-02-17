import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
    interface FastifyRequest {
        geo?: {
            country?: string;
            ip?: string;
        };
    }
}

export const geoPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorateRequest('geo', undefined);

    fastify.addHook('onRequest', async (request, reply) => {
        // IP detection: Cloudflare > X-Forwarded-For > direct
        const cfIp = request.headers['cf-connecting-ip'] as string;
        const xForwardedFor = request.headers['x-forwarded-for'] as string;
        const ip = cfIp || (xForwardedFor ? xForwardedFor.split(',')[0].trim() : request.ip);

        // Country detection: Cloudflare header or unknown
        const country = (request.headers['cf-ipcountry'] as string) || 'XX';

        request.geo = { country, ip };

        // Log only non-health, non-XX requests
        if (country !== 'XX' && request.url !== '/health') {
            request.log.info(`[Geo] Request from ${country} (${ip})`);
        }

        // Access Control
        const allowedCountries = process.env.ALLOWED_COUNTRIES;
        if (allowedCountries) {
            const allowedList = allowedCountries.split(',').map(c => c.trim().toUpperCase());
            if (!allowedList.includes(country.toUpperCase()) && country !== 'XX') {
                request.log.warn(`[Geo] Blocked access from ${country} (${ip})`);
                return reply.status(403).send({ error: 'Access denied: Region not supported' });
            }
        }
    });
});
