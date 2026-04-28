/**
 * Integration test for the chat /completions pre-flight model validation.
 *
 * Captures the route handler registered by `chatRoutes` and exercises it
 * with a mocked Fastify so we can assert that an unknown / disabled model
 * is rejected with HTTP 400 BEFORE the provider is invoked, and that the
 * response shape contains the list of supported models.
 *
 * The matching unit tests for `validateChatModel` and the message builder
 * live in `model-validation.test.ts` and `stream-error.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (must come before importing the route module) ──

vi.mock('../../database/index.js', () => ({
  findOne: vi.fn(),
  findMany: vi.fn(),
  insertOne: vi.fn().mockResolvedValue(1),
  updateOne: vi.fn().mockResolvedValue(1),
}));

const aiProviderGetProvider = vi.fn();
vi.mock('../ai/providers.js', () => ({
  AIProviderFactory: {
    getProviderName: vi.fn().mockReturnValue('openai'),
    getProvider: (...args: any[]) => aiProviderGetProvider(...args),
  },
  calculateCost: vi.fn().mockReturnValue(0),
}));

import { completionRoutes } from './completions.js';

interface CapturedRoute {
  handler: any;
}

async function buildRoute(): Promise<CapturedRoute> {
  const captured: CapturedRoute = { handler: null };
  const fastifyMock: any = {
    post: vi.fn((path: string, _opts: any, handler: any) => {
      if (path === '/completions') captured.handler = handler;
    }),
    get: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    db: { execute: vi.fn().mockResolvedValue([{ insertId: 1, affectedRows: 1 }, []]) },
    authenticate: vi.fn(),
  };
  await completionRoutes(fastifyMock);
  return captured;
}

function buildReply() {
  const reply: any = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    hijack: vi.fn(),
    raw: { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), destroyed: false },
  };
  return reply;
}

describe('Chat /completions — pre-flight model validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 with supportedModels when the requested model is not registered', async () => {
    const { findOne, findMany } = await import('../../database/index.js');

    // First call: validateChatModel -> loadEnabledChatModels (findMany)
    (findMany as any).mockImplementation((_db: any, query: string) => {
      if (query.includes('FROM ai_models m') && query.includes("model_type IN ('chat', 'completion')")) {
        return Promise.resolve([
          { model_id: 'gpt-4o' },
          { model_id: 'gpt-4o-mini' },
          { model_id: 'claude-3-5-sonnet' },
        ]);
      }
      return Promise.resolve([]);
    });

    // Second call: validateChatModel -> lookup specific model -> returns null (unknown)
    (findOne as any).mockResolvedValue(null);

    const route = await buildRoute();
    expect(route.handler).toBeTruthy();

    const reply = buildReply();
    await route.handler(
      {
        body: { model: 'gpt-5.5-pro-2026-04-23', message: 'Ciao' },
        user: { id: 1 },
      },
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    const sendArg = reply.send.mock.calls[0][0];
    expect(sendArg.error).toContain('gpt-5.5-pro-2026-04-23');
    expect(sendArg.supportedModels).toEqual(
      expect.arrayContaining(['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet']),
    );

    // Provider must NOT be invoked
    expect(aiProviderGetProvider).not.toHaveBeenCalled();
  });

  it('returns 400 when model row exists but is disabled', async () => {
    const { findOne, findMany } = await import('../../database/index.js');

    (findMany as any).mockResolvedValue([{ model_id: 'gpt-4o' }]);
    (findOne as any).mockImplementation((_db: any, query: string) => {
      if (query.includes('FROM ai_models m') && query.includes('LIMIT 1')) {
        return Promise.resolve({
          provider_type: 'openai',
          is_enabled: 0,
          provider_enabled: 1,
          model_type: 'chat',
        });
      }
      return Promise.resolve(null);
    });

    const route = await buildRoute();
    const reply = buildReply();
    await route.handler(
      { body: { model: 'gpt-4o', message: 'Ciao' }, user: { id: 1 } },
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    const sendArg = reply.send.mock.calls[0][0];
    expect(sendArg.supportedModels).toContain('gpt-4o');
    expect(aiProviderGetProvider).not.toHaveBeenCalled();
  });
});
