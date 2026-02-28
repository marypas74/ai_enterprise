
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Mock dependencies
vi.mock('../../database/index.js', () => ({
    findOne: vi.fn(),
    findMany: vi.fn(),
    insertOne: vi.fn().mockResolvedValue(1),
    updateOne: vi.fn().mockResolvedValue(1),
}));

vi.mock('../ai/providers.js', () => ({
    AIProviderFactory: {
        getProviderName: vi.fn().mockReturnValue('openai'),
        getProvider: vi.fn().mockReturnValue({
            streamComplete: async function* () {
                yield { content: 'Response', done: false };
                yield { content: '', done: true };
            }
        }),
    },
    calculateCost: vi.fn().mockReturnValue(0),
}));

// Import modules to test
// Since chatRoutes is an async function that registers routes, we need a way to invoke the handler.
// Ideally we would use fastify.inject(), but setting up the full app context is heavy.
// We will test the logic by extracting the handler logic or simulating the flow if possible.
// Given constraints, we'll write a test that imports the route and mocks fastify to capture the handler.

import { chatRoutes } from './routes.js';

describe('Chat Routes Context Injection', () => {
    let fastifyMock: any;
    let routeHandler: any;

    beforeEach(async () => {
        fastifyMock = {
            post: vi.fn((path, options, handler) => {
                if (path === '/completions') {
                    routeHandler = handler;
                }
            }),
            get: vi.fn(),
            delete: vi.fn(),
            patch: vi.fn(),
            log: {
                info: vi.fn(),
                error: vi.fn(),
                warn: vi.fn(),
            },
            db: {
                execute: vi.fn().mockResolvedValue([{ insertId: 1, affectedRows: 1 }, []]),
            },
            authenticate: vi.fn(),
        };

        await chatRoutes(fastifyMock);
    });

    it('should inject attachment context into user message', async () => {
        const requestMock = {
            body: {
                model: 'gpt-4',
                message: 'Analyze this file',
                attachmentIds: [100]
            },
            user: { id: 1 }
        };

        const replyMock = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            hijack: vi.fn(),
            raw: {
                writeHead: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
                destroyed: false,
            }
        };

        // Mock DB findMany to return attachment content
        const { findMany } = await import('../../database/index.js');
        (findMany as any).mockImplementation((db: any, query: any, params: any) => {
            console.log('findMany query:', query);
            // Match the query used in the route handler
            if (query.includes('FROM chat_attachments') || query.includes('processed_content')) {
                return Promise.resolve([{
                    id: 100,
                    original_name: 'test.pdf',
                    content_type: 'document',
                    processed_content: 'Extracted Content From DB',
                    processing_status: 'completed'
                }]);
            }
            return Promise.resolve([]);
        });

        // Mock insertOne to capture the message saved to DB
        const { insertOne } = await import('../../database/index.js');

        // Execute handler
        await routeHandler(requestMock, replyMock);

        // Verify insertOne was called with the context
        const insertCalls = (insertOne as any).mock.calls;
        // Arguments: [db, query, params] -> indices 0, 1, 2
        const userMessageCall = insertCalls.find((call: any[]) => call && call[1] && call[1].includes('INSERT INTO messages') && call[2] && call[2][1] === 'user');

        expect(userMessageCall).toBeDefined();
        const savedMessage = userMessageCall[2][2];

        expect(savedMessage).toContain('[Allegato ID=100: test.pdf (document)]');
        expect(savedMessage).toContain('Extracted Content From DB');
        expect(savedMessage).toContain('Analyze this file');

        expect(savedMessage).toContain('[Allegato ID=100: test.pdf (document)]');
        expect(savedMessage).toContain('Extracted Content From DB');
        expect(savedMessage).toContain('Analyze this file');
    });
});
