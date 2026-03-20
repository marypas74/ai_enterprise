import { createHmac } from 'node:crypto';

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlEncodeBuffer(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function generateServiceToken(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const fiveMinutes = 300;

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

  const payload = base64UrlEncode(
    JSON.stringify({
      id: 0,
      sub: 'marketplace-service',
      role: 'service',
      iat: now,
      exp: now + fiveMinutes,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signature = base64UrlEncodeBuffer(
    createHmac('sha256', secret).update(signingInput).digest(),
  );

  return `${signingInput}.${signature}`;
}
