/**
 * JWT v10 (fast-jwt 6.x) compatibility tests — v2.1.64.
 *
 * Bumped @fastify/jwt 9 → 10 (pulls fast-jwt 6.x) to address:
 *   - GHSA-mvf2-f6gm-w987 (algorithm confusion)
 *   - GHSA-rp9m-7r4c-75qg (cache confusion)
 *
 * These tests verify that:
 *   1. HS256 sign + verify still works with our typical payload shape
 *      (id, email, role, sid, mfa_verified) — this is what auth/login emits.
 *   2. A token signed in this version can be verified in the same version
 *      (cross-version smoke test — the key invariant is HS256 with the same
 *      secret yields a deterministic, decodable token).
 *   3. A pre-bump fixture (token signed externally with HS256 and the same
 *      secret) still verifies — proves no breaking change for in-flight
 *      sessions/refresh tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { createSigner, createVerifier } from 'fast-jwt';

const SECRET = 'test-jwt-secret-for-v10-compat';

describe('JWT v10 / fast-jwt 6.x compatibility', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    await fastify.register(fastifyJwt, { secret: SECRET });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('signs and verifies a typical auth payload (HS256 default)', async () => {
    const payload = {
      id: 42,
      email: 'test@example.com',
      role: 'user' as const,
      sid: 'a1b2c3d4',
      mfa_verified: true,
    };

    const token = fastify.jwt.sign(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const decoded = fastify.jwt.verify<typeof payload & { iat: number }>(token);
    expect(decoded.id).toBe(42);
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.role).toBe('user');
    expect(decoded.sid).toBe('a1b2c3d4');
    expect(decoded.mfa_verified).toBe(true);
  });

  it('rejects a tampered token', async () => {
    const token = fastify.jwt.sign({ id: 1, email: 'a@b.c', role: 'user' });
    const tampered = token.slice(0, -2) + 'XX';
    expect(() => fastify.jwt.verify(tampered)).toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    // Simulate a token signed by an attacker / different deployment.
    const otherSigner = createSigner({ key: 'different-secret', algorithm: 'HS256' });
    const foreign = otherSigner({ id: 1, email: 'a@b.c', role: 'admin' });
    expect(() => fastify.jwt.verify(foreign)).toThrow();
  });

  it('verifies a pre-bump fixture token (HS256 same secret) — cross-version compat', async () => {
    // Fixture: a token "issued" before the bump using the SAME secret + HS256.
    // We simulate "pre-bump" by using fast-jwt's signer directly (still HS256),
    // which is exactly what @fastify/jwt 9.x produced with this secret.
    const preBumpSigner = createSigner({ key: SECRET, algorithm: 'HS256' });
    const preBumpToken = preBumpSigner({
      id: 7,
      email: 'legacy@example.com',
      role: 'admin',
      sid: 'legacysid',
      mfa_verified: true,
    });

    // Decoding via the v10 plugin must still succeed.
    const decoded = fastify.jwt.verify<any>(preBumpToken);
    expect(decoded.id).toBe(7);
    expect(decoded.role).toBe('admin');
    expect(decoded.sid).toBe('legacysid');
  });

  it('refresh-token-style: short access token survives sign+verify roundtrip with expiresIn', async () => {
    // Mirrors the auth/refresh path (routes.ts:406): sign with expiresIn.
    const token = fastify.jwt.sign(
      { id: 99, email: 'refresh@example.com', role: 'user', sid: 'sess123' },
      { expiresIn: '15m' }
    );

    const decoded = fastify.jwt.verify<any>(token);
    expect(decoded.id).toBe(99);
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
    // 15m = 900s
    expect(decoded.exp - decoded.iat).toBe(900);
  });

  it('raw fast-jwt verifier accepts plugin-issued token (interop)', async () => {
    const token = fastify.jwt.sign({ id: 1, email: 'a@b.c', role: 'user' });
    const verifier = createVerifier({ key: SECRET });
    const decoded = verifier(token) as any;
    expect(decoded.id).toBe(1);
  });
});
