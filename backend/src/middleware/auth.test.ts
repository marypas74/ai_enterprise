import { describe, it, expect, vi } from 'vitest';
import { requireAdmin, requireRole } from './auth.js';

function createMockRequest(role: string) {
  return { user: { role, id: 1, email: 'test@test.com' } } as any;
}

function createMockReply() {
  const reply: any = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

describe('requireAdmin', () => {
  it('should pass for admin users', async () => {
    const request = createMockRequest('admin');
    const reply = createMockReply();
    await requireAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should return 403 for non-admin users', async () => {
    const request = createMockRequest('user');
    const reply = createMockReply();
    await requireAdmin(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Admin access required' });
  });
});

describe('requireRole', () => {
  it('should pass for matching role', async () => {
    const middleware = requireRole('editor');
    const request = createMockRequest('editor');
    const reply = createMockReply();
    await middleware(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should pass for admin regardless of required role', async () => {
    const middleware = requireRole('editor');
    const request = createMockRequest('admin');
    const reply = createMockReply();
    await middleware(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should return 403 for non-matching role', async () => {
    const middleware = requireRole('editor');
    const request = createMockRequest('user');
    const reply = createMockReply();
    await middleware(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});
