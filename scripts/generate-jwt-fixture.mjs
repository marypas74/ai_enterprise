#!/usr/bin/env node
/**
 * One-time script to regenerate the JWT fixture used in jwt-v10.test.ts.
 * Simulates a token signed by @fastify/jwt@9 / fast-jwt@5 (pre-bump era).
 *
 * Usage: node scripts/generate-jwt-fixture.mjs
 * Paste the output as FASTJWT_V5_FIXTURE in backend/src/modules/auth/jwt-v10.test.ts
 */
import { createHmac } from 'crypto';

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: 'test-user-v9',
  iat: 1700000000,
  jti: 'fastjwt-v5-compat-fixture',
})).toString('base64url');
const signingInput = `${header}.${payload}`;
const sig = createHmac('sha256', 'test-secret-fixture').update(signingInput).digest('base64url');
const token = `${signingInput}.${sig}`;

console.log('JWT fixture (fast-jwt@5 / @fastify/jwt@9 compat):');
console.log(token);
console.log('\nPaste as FASTJWT_V5_FIXTURE constant in:');
console.log('  backend/src/modules/auth/jwt-v10.test.ts');
