import { FastifyInstance } from 'fastify';
import fastifyRedis from '@fastify/redis';
import fp from 'fastify-plugin';

async function redisConnector(fastify: FastifyInstance) {
  await fastify.register(fastifyRedis, {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    family: 4 // IPv4
  });

  fastify.log.info('Redis connected successfully');
}

export const redisPlugin = fp(redisConnector, {
  name: 'redis'
});

// Cache helpers
export const CACHE_KEYS = {
  SESSION: (userId: number) => `session:${userId}`,
  CONVERSATION: (convId: number) => `conv:${convId}`,
  RATE_LIMIT: (userId: number) => `rate:${userId}`,
  USER_USAGE: (userId: number, month: string) => `usage:${userId}:${month}`
};

export const CACHE_TTL = {
  SESSION: 60 * 60 * 24, // 24 hours
  CONVERSATION: 60 * 30, // 30 minutes
  RATE_LIMIT: 60, // 1 minute
  USER_USAGE: 60 * 5 // 5 minutes
};
