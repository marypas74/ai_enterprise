import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { publicRoutes } from './routes.js';

describe('GET /api/public/login-guide.mp4', () => {
    let app: FastifyInstance;
    let tempDir: string;
    let videoPath: string;
    const PAYLOAD = Buffer.alloc(1024, 'A'); // 1 KiB fixture

    beforeAll(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'login-guide-test-'));
        videoPath = join(tempDir, 'login-guide.mp4');
        writeFileSync(videoPath, PAYLOAD);
        process.env.LOGIN_GUIDE_PATH = videoPath;

        app = Fastify({ logger: false });
        await app.register(import('@fastify/rate-limit'), { global: false });
        await app.register(publicRoutes, { prefix: '/api/public' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        try { unlinkSync(videoPath); } catch { /* ignore */ }
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('200 + full file when no Range header', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/public/login-guide.mp4' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('video/mp4');
        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(res.headers['content-length']).toBe(String(PAYLOAD.length));
        expect(res.rawPayload.length).toBe(PAYLOAD.length);
    });

    it('206 + partial body with Range bytes=0-99', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/public/login-guide.mp4',
            headers: { range: 'bytes=0-99' }
        });
        expect(res.statusCode).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 0-99/${PAYLOAD.length}`);
        expect(res.headers['content-length']).toBe('100');
        expect(res.rawPayload.length).toBe(100);
    });

    it('206 + open-ended Range bytes=500-', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/public/login-guide.mp4',
            headers: { range: 'bytes=500-' }
        });
        expect(res.statusCode).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 500-${PAYLOAD.length - 1}/${PAYLOAD.length}`);
        expect(res.headers['content-length']).toBe(String(PAYLOAD.length - 500));
    });

    it('206 + suffix Range bytes=-128 (last 128 bytes)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/public/login-guide.mp4',
            headers: { range: 'bytes=-128' }
        });
        expect(res.statusCode).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes ${PAYLOAD.length - 128}-${PAYLOAD.length - 1}/${PAYLOAD.length}`);
        expect(res.headers['content-length']).toBe('128');
    });

    it('416 on out-of-range request', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/public/login-guide.mp4',
            headers: { range: `bytes=${PAYLOAD.length + 100}-${PAYLOAD.length + 200}` }
        });
        expect(res.statusCode).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${PAYLOAD.length}`);
    });

    it('416 on malformed Range header', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/public/login-guide.mp4',
            headers: { range: 'banane=0-10' }
        });
        expect(res.statusCode).toBe(416);
    });

    it('404 when file missing', async () => {
        process.env.LOGIN_GUIDE_PATH = '/nonexistent/path/login-guide.mp4';
        const isolated = Fastify({ logger: false });
        await isolated.register(import('@fastify/rate-limit'), { global: false });
        await isolated.register(publicRoutes, { prefix: '/api/public' });
        await isolated.ready();
        const res = await isolated.inject({ method: 'GET', url: '/api/public/login-guide.mp4' });
        expect(res.statusCode).toBe(404);
        await isolated.close();
        process.env.LOGIN_GUIDE_PATH = videoPath;
    });
});
