/**
 * Permission management routes (admin only)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PermissionService, type Resource, type Permission } from '../../services/PermissionService.js';

// Validation schema for permission body
const permissionBodySchema = z.record(z.boolean());

export async function permissionRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', (fastify as any).authenticate);

  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string };
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  };

  const permService = new PermissionService(fastify.db);

  // Get permission schema (resources + permission types)
  fastify.get('/schema', {
    onRequest: [adminOnly],
  }, async () => {
    return {
      schema: permService.getSchema(),
      defaults: permService.getDefaults(),
    };
  });

  // Get permissions for a specific user
  fastify.get('/users/:userId', {
    onRequest: [adminOnly],
  }, async (request: FastifyRequest) => {
    const { userId } = request.params as { userId: string };
    const permissions = await permService.getUserPermissions(parseInt(userId), 'user');
    return { userId: parseInt(userId), permissions };
  });

  // Get own permissions
  fastify.get('/me', async (request: FastifyRequest) => {
    const user = request.user as { id: number; role: string };
    const permissions = await permService.getUserPermissions(user.id, user.role);
    return { permissions };
  });

  // Set permissions for a user on a resource
  fastify.put('/users/:userId/:resource', {
    onRequest: [adminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, resource } = request.params as { userId: string; resource: string };
    const body = permissionBodySchema.parse(request.body) as Partial<Record<Permission, boolean>>;

    const validResources = permService.getSchema().resources;
    if (!validResources.includes(resource as Resource)) {
      return reply.status(400).send({ error: `Invalid resource: ${resource}. Valid: ${validResources.join(', ')}` });
    }

    await permService.setPermission(parseInt(userId), resource as Resource, body);
    const permissions = await permService.getUserPermissions(parseInt(userId), 'user');
    return { userId: parseInt(userId), permissions, message: 'Permissions updated' };
  });

  // Reset permissions for a user on a resource
  fastify.delete('/users/:userId/:resource', {
    onRequest: [adminOnly],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, resource } = request.params as { userId: string; resource: string };

    const validResources = permService.getSchema().resources;
    if (!validResources.includes(resource as Resource)) {
      return reply.status(400).send({ error: `Invalid resource: ${resource}` });
    }

    await permService.resetPermission(parseInt(userId), resource as Resource);
    return { message: `Permissions reset to defaults for resource: ${resource}` };
  });

  // Reset all permissions for a user
  fastify.delete('/users/:userId', {
    onRequest: [adminOnly],
  }, async (request: FastifyRequest) => {
    const { userId } = request.params as { userId: string };
    await permService.resetAllPermissions(parseInt(userId));
    return { message: 'All permissions reset to defaults' };
  });
}
