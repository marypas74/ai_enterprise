import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const MARKETPLACE_SERVICE_URL = process.env.MARKETPLACE_SERVICE_URL || 'http://marketplace:3100';

const FORWARDED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function buildTargetUrl(requestUrl: string): string {
  const base = MARKETPLACE_SERVICE_URL.replace(/\/+$/, '');
  // Fastify wildcard routes receive the full path including the prefix,
  // and the marketplace service expects routes under /api/marketplace/*
  const prefix = '/api/marketplace';
  if (requestUrl.startsWith(prefix)) {
    // URL already contains the prefix — forward as-is
    return `${base}${requestUrl}`;
  }
  // Fallback: prepend prefix if stripped
  return `${base}${prefix}${requestUrl}`;
}

function buildForwardHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};

  const auth = request.headers.authorization;
  if (auth) {
    headers['authorization'] = auth;
  }

  const contentType = request.headers['content-type'];
  if (contentType) {
    headers['content-type'] = contentType;
  }

  // Forward the real client IP for access control
  const cfIp = request.headers['cf-connecting-ip'];
  if (cfIp) {
    headers['cf-connecting-ip'] = Array.isArray(cfIp) ? cfIp[0] : cfIp;
  }

  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    headers['x-forwarded-for'] = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  }

  return headers;
}

export async function marketplaceProxyRoutes(fastify: FastifyInstance): Promise<void> {
  // Disable body parsing — we forward the raw body to the marketplace service
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', function (_request, payload, done) {
    const chunks: Buffer[] = [];
    payload.on('data', (chunk: Buffer) => chunks.push(chunk));
    payload.on('end', () => done(null, Buffer.concat(chunks)));
    payload.on('error', done);
  });

  for (const method of FORWARDED_METHODS) {
    fastify.route({
      method,
      url: '/*',
      onRequest: [(fastify as any).authenticate],
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const targetUrl = buildTargetUrl(request.url);
        const headers = buildForwardHeaders(request);

        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        if (method !== 'GET' && request.body) {
          fetchOptions.body = request.body as Buffer;
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15_000);
          fetchOptions.signal = controller.signal;
          let response: Response;
          try {
            response = await fetch(targetUrl, fetchOptions);
          } finally {
            clearTimeout(timeoutId);
          }

          // Forward response status
          reply.status(response.status);

          // Forward relevant response headers
          const responseContentType = response.headers.get('content-type');
          if (responseContentType) {
            reply.header('content-type', responseContentType);
          }

          const cacheControl = response.headers.get('cache-control');
          if (cacheControl) {
            reply.header('cache-control', cacheControl);
          }

          // Stream the response body
          const body = await response.arrayBuffer();
          return reply.send(Buffer.from(body));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          fastify.log.error(`[MarketplaceProxy] Failed to reach marketplace service at ${targetUrl}: ${message}`);
          return reply.status(502).send({
            error: 'Bad Gateway',
            message: 'Marketplace service is unavailable',
          });
        }
      },
    });
  }
}
