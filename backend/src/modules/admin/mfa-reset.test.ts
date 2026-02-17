import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';

// Mock dependencies
const mockUpdateOne = vi.fn();
const mockInsertOne = vi.fn();

vi.mock('../../database/index.js', () => ({
    updateOne: (...args: any[]) => mockUpdateOne(...args),
    insertOne: (...args: any[]) => mockInsertOne(...args),
    findOne: vi.fn(),
    findMany: vi.fn()
}));

describe('Admin MFA Reset Route', () => {
    let fastify: FastifyInstance;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Setup fastify instance with mocked auth and routes
        const { default: Fastify } = await import('fastify');
        fastify = Fastify();

        // Mock authentication hook and db
        fastify.decorate('authenticate', async (request: any) => {
            request.user = { id: 1, role: 'admin' }; // Simulate admin user
        });
        fastify.decorate('db', {} as any); // Mock db object

        // Register admin routes
        const { adminRoutes } = await import('./routes.js');
        await fastify.register(adminRoutes, { prefix: '/admin' });

        await fastify.ready();
    });

    it('should reset MFA for a user', async () => {
        // Mock successful update (1 row affected)
        mockUpdateOne.mockResolvedValueOnce(1);

        const response = await fastify.inject({
            method: 'POST',
            url: '/admin/users/123/mfa-reset'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual({ message: 'MFA reset successfully' });

        // Verify database call
        expect(mockUpdateOne).toHaveBeenCalledWith(
            expect.anything(),
            'UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = ?',
            ['123']
        );

        // Verify audit log
        expect(mockInsertOne).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('INSERT INTO audit_log'),
            [1, 'reset_user_mfa', 'user', '123', expect.any(String)]
        );
    });

    it('should return 404 if user not found', async () => {
        // Mock update returning 0 rows affected
        mockUpdateOne.mockResolvedValueOnce(0);

        const response = await fastify.inject({
            method: 'POST',
            url: '/admin/users/999/mfa-reset'
        });

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.payload)).toEqual({ error: 'User not found' });
    });
});
