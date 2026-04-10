import { FastifyRequest, FastifyReply } from 'fastify';

interface UserPayload {
  id: number;
  email: string;
  role: string;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user as UserPayload;
  if (user.role !== 'admin' && user.role !== 'service') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user as UserPayload;
    if (user.role === 'admin') return; // admin bypasses all role checks
    if (!roles.includes(user.role)) {
      return reply.status(403).send({ error: `Role ${roles.join(' or ')} required` });
    }
  };
}
