import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// Parlant service URL (internal Kubernetes service)
const PARLANT_URL = process.env.PARLANT_URL || 'http://parlant:8800';

// Validation schemas
const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional()
});

const createGuidelineSchema = z.object({
  condition: z.string().min(1),
  action: z.string().min(1),
  priority: z.number().optional()
});

const updateGuidelineSchema = z.object({
  condition: z.string().optional(),
  action: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional()
});

const createSessionSchema = z.object({
  agentId: z.string().min(1),
  customerId: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.any()).optional()
});

// Helper to proxy requests to Parlant service
async function parlantRequest(
  method: string,
  path: string,
  body?: any,
  timeout: number = 30000
): Promise<{ data: any; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${PARLANT_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Get the response text first (can only read body once)
    const text = await response.text();

    // Try to parse as JSON if there's content
    let data: any;
    if (text && text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        // Not JSON, return as text
        data = text;
      }
    } else {
      // Empty response
      data = null;
    }

    return { data, status: response.status };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Parlant service request timeout');
    }
    throw new Error(`Parlant service error: ${error.message}`);
  }
}

export async function parlantRoutes(fastify: FastifyInstance) {
  // ==================== HEALTH CHECK ====================

  // Check Parlant service health
  fastify.get('/health', {
    schema: {
      description: 'Check Parlant service health',
      tags: ['parlant']
    }
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Use root endpoint for health check (Parlant doesn't have /health)
      const { data, status } = await parlantRequest('GET', '/', undefined, 5000);
      // If we get any response, Parlant is running
      if (status >= 200 && status < 500) {
        return reply.status(200).send({
          status: 'healthy',
          service: 'parlant',
          data: data
        });
      }
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(503).send({
        status: 'unhealthy',
        error: error.message,
        service: 'parlant'
      });
    }
  });

  // ==================== AGENTS ====================

  // List Parlant agents
  fastify.get('/agents', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List Parlant agents',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, status } = await parlantRequest('GET', '/agents');
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // Get agent details
  fastify.get('/agents/:agentId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get Parlant agent details',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId } = request.params as { agentId: string };
    try {
      const { data, status } = await parlantRequest('GET', `/agents/${agentId}`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // Create new agent
  fastify.post('/agents', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create a new Parlant agent',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = createAgentSchema.parse(request.body);
      const { data, status } = await parlantRequest('POST', '/agents', body);
      return reply.status(status).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: error.errors });
      }
      return reply.status(502).send({ error: error.message });
    }
  });

  // Delete agent
  fastify.delete('/agents/:agentId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete a Parlant agent',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId } = request.params as { agentId: string };
    try {
      const { data, status } = await parlantRequest('DELETE', `/agents/${agentId}`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // ==================== GUIDELINES ====================

  // List agent guidelines
  fastify.get('/agents/:agentId/guidelines', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List agent guidelines',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId } = request.params as { agentId: string };
    try {
      const { data, status } = await parlantRequest('GET', `/agents/${agentId}/guidelines`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // Create guideline for agent
  fastify.post('/agents/:agentId/guidelines', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create a guideline for an agent',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId } = request.params as { agentId: string };
    try {
      const body = createGuidelineSchema.parse(request.body);
      const { data, status } = await parlantRequest('POST', `/agents/${agentId}/guidelines`, body);
      return reply.status(status).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: error.errors });
      }
      return reply.status(502).send({ error: error.message });
    }
  });

  // Update guideline
  fastify.patch('/agents/:agentId/guidelines/:guidelineId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Update an agent guideline',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId, guidelineId } = request.params as { agentId: string; guidelineId: string };
    try {
      const body = updateGuidelineSchema.parse(request.body);
      const { data, status } = await parlantRequest('PATCH', `/agents/${agentId}/guidelines/${guidelineId}`, body);
      return reply.status(status).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: error.errors });
      }
      return reply.status(502).send({ error: error.message });
    }
  });

  // Delete guideline
  fastify.delete('/agents/:agentId/guidelines/:guidelineId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete an agent guideline',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId, guidelineId } = request.params as { agentId: string; guidelineId: string };
    try {
      const { data, status } = await parlantRequest('DELETE', `/agents/${agentId}/guidelines/${guidelineId}`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // ==================== SESSIONS ====================

  // List sessions
  fastify.get('/sessions', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List Parlant sessions',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { agentId?: string; limit?: string; offset?: string };
    try {
      let path = '/sessions';
      const params = new URLSearchParams();
      if (query.agentId) params.append('agent_id', query.agentId);
      if (query.limit) params.append('limit', query.limit);
      if (query.offset) params.append('offset', query.offset);
      if (params.toString()) path += `?${params.toString()}`;

      const { data, status } = await parlantRequest('GET', path);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // Create session
  fastify.post('/sessions', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Create a new Parlant session',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number; username: string };
    try {
      const body = createSessionSchema.parse(request.body);
      // Add user info as customer ID if not provided
      const sessionData = {
        agent_id: body.agentId,
        customer_id: body.customerId || `user_${user.id}`,
        metadata: {
          ...body.metadata,
          enterprise_user_id: user.id,
          enterprise_username: user.username
        }
      };
      const { data, status } = await parlantRequest('POST', '/sessions', sessionData);
      return reply.status(status).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: error.errors });
      }
      return reply.status(502).send({ error: error.message });
    }
  });

  // Get session details
  fastify.get('/sessions/:sessionId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get Parlant session details',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      const { data, status } = await parlantRequest('GET', `/sessions/${sessionId}`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // Delete session
  fastify.delete('/sessions/:sessionId', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete a Parlant session',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      const { data, status } = await parlantRequest('DELETE', `/sessions/${sessionId}`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // ==================== EVENTS (MESSAGES) ====================

  // Get session events/messages
  fastify.get('/sessions/:sessionId/events', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get session events/messages',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          offset: { type: 'number' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { limit?: string; offset?: string };
    try {
      let path = `/sessions/${sessionId}/events`;
      const params = new URLSearchParams();
      if (query.limit) params.append('limit', query.limit);
      if (query.offset) params.append('offset', query.offset);
      if (params.toString()) path += `?${params.toString()}`;

      const { data, status } = await parlantRequest('GET', path);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // Send message to session
  fastify.post('/sessions/:sessionId/events', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Send a message to a Parlant session',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      const body = sendMessageSchema.parse(request.body);
      // Parlant v3.0 expects: { kind, source, data: { message: "..." } }
      const eventData = {
        kind: 'message',
        source: 'customer',
        data: {
          message: body.content,
          ...(body.metadata || {})
        }
      };
      console.log(`[Parlant Routes] Sending event to session ${sessionId}:`, JSON.stringify(eventData));
      // Use longer timeout for message processing
      const { data, status } = await parlantRequest('POST', `/sessions/${sessionId}/events`, eventData, 120000);
      console.log(`[Parlant Routes] Response status: ${status}`);
      return reply.status(status).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: error.errors });
      }
      console.error(`[Parlant Routes] Error:`, error.message);
      return reply.status(502).send({ error: error.message });
    }
  });

  // ==================== TOOLS ====================

  // List available tools
  fastify.get('/tools', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List available Parlant tools',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, status } = await parlantRequest('GET', '/tools');
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });

  // ==================== EVALUATIONS ====================

  // Get guideline evaluations for a session
  fastify.get('/sessions/:sessionId/evaluations', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get guideline evaluations for explainability',
      tags: ['parlant'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      const { data, status } = await parlantRequest('GET', `/sessions/${sessionId}/evaluations`);
      return reply.status(status).send(data);
    } catch (error: any) {
      return reply.status(502).send({ error: error.message });
    }
  });
}
