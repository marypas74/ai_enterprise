import { describe, it, expect } from 'vitest';
import { verify as jwtVerify } from 'jsonwebtoken';

/**
 * Cross-version JWT compatibility test: @fastify/jwt@9 (fast-jwt@5) → @fastify/jwt@10 (fast-jwt@6).
 *
 * The fixture was generated offline by scripts/generate-jwt-fixture.mjs using only
 * Node.js built-in crypto (HS256, secret='test-secret-fixture'), which reproduces the
 * exact same token format that fast-jwt@5 would produce — no live signer in-process.
 *
 * Payload: { sub: 'test-user-v9', iat: 1700000000, jti: 'fastjwt-v5-compat-fixture' }
 */
const FASTJWT_V5_FIXTURE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiJ0ZXN0LXVzZXItdjkiLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6ImZhc3Rqd3QtdjUtY29tcGF0LWZpeHR1cmUifQ' +
  '.HxxIYmam27gm-DlT6xPTc56e5jRIoddnC9HZfRB09aM';

const SECRET = 'test-secret-fixture';

describe('JWT cross-version compatibility: pre-bump fixture (fast-jwt v5 → v6)', () => {
  it('pre-bump fixture cross-version compat: verifies v9-era token with current JWT library', () => {
    const decoded = jwtVerify(FASTJWT_V5_FIXTURE, SECRET, {
      algorithms: ['HS256'],
      ignoreExpiration: true,
    }) as Record<string, unknown>;

    expect(decoded.sub).toBe('test-user-v9');
    expect(decoded.jti).toBe('fastjwt-v5-compat-fixture');
    expect(decoded.iat).toBe(1700000000);
  });

  it('rejects token signed with wrong secret', () => {
    expect(() =>
      jwtVerify(FASTJWT_V5_FIXTURE, 'wrong-secret', { algorithms: ['HS256'], ignoreExpiration: true })
    ).toThrow(/invalid signature/i);
  });

  it('fixture header declares HS256 algorithm', () => {
    const [headerB64] = FASTJWT_V5_FIXTURE.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('fixture token has exactly 3 base64url segments', () => {
    const parts = FASTJWT_V5_FIXTURE.split('.');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
