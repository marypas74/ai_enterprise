import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { AIProviderFactory, calculateCost, Message } from '../ai/providers.js';
import { fetchAllModels, clearModelsCache } from '../../services/ModelFetcher.js';
import { ParlantProviderFactory, fetchParlantAgents, checkParlantHealth } from '../../services/ParlantProvider.js';

// Helper to decrypt secrets
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production!!';
function decryptSecret(text: string): string {
  try {
    const [ivHex, encrypted] = text.split(':');
    if (!ivHex || !encrypted) return text;
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return text;
  }
}

// Validation schemas
const completionSchema = z.object({
  conversationId: z.number().optional(),
  model: z.string(),
  message: z.string().min(1),
  systemPrompt: z.string().optional()
});

// Types
interface Conversation {
  id: number;
  user_id: number;
  title: string;
  model: string;
  provider: string;
  system_prompt: string;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

interface DbMessage {
  id: number;
  conversation_id: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  tokens_input: number;
  tokens_output: number;
  created_at: Date;
}

export async function chatRoutes(fastify: FastifyInstance) {
  // Streaming chat completion
  fastify.post('/completions', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Send message and get AI response (streaming)',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const body = completionSchema.parse(request.body);

      // Check if this is a Parlant agent (model format: "parlant:{agentId}")
      const isParlantAgent = body.model.startsWith('parlant:');
      let provider;
      let providerName: string;

      if (isParlantAgent) {
        const agentId = body.model.replace('parlant:', '');
        provider = ParlantProviderFactory.getProvider(agentId, 'Parlant Agent', `user_${user.id}`);
        providerName = 'parlant';
        fastify.log.info(`[Chat] Using Parlant agent: ${agentId}`);
      } else {
        provider = AIProviderFactory.getProvider(body.model);
        providerName = AIProviderFactory.getProviderName(body.model);
      }

      let conversationId = body.conversationId;
      let messages: Message[] = [];

      // Get or create conversation
      if (conversationId) {
        // Load existing conversation
        const conversation = await findOne<Conversation>(
          fastify.db,
          'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
          [conversationId, user.id]
        );

        if (!conversation) {
          return reply.status(404).send({ error: 'Conversation not found' });
        }

        // Load previous messages
        const dbMessages = await findMany<DbMessage>(
          fastify.db,
          'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
          [conversationId]
        );

        messages = dbMessages.map(m => ({ role: m.role, content: m.content }));
      } else {
        // Create new conversation
        const title = body.message.slice(0, 100);
        conversationId = await insertOne(
          fastify.db,
          'INSERT INTO conversations (user_id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)',
          [user.id, title, body.model, providerName, body.systemPrompt || null]
        );

        // Add system prompt if provided
        if (body.systemPrompt) {
          messages.push({ role: 'system', content: body.systemPrompt });
          await insertOne(
            fastify.db,
            'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
            [conversationId, 'system', body.systemPrompt]
          );
        }
      }

      // Add user message
      messages.push({ role: 'user', content: body.message });
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'user', body.message]
      );

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': conversationId.toString()
      });

      // Stream response
      let fullResponse = '';
      let tokensInput = 0;
      let tokensOutput = 0;

      try {
        const stream = provider.streamComplete({
          model: body.model,
          messages,
          maxTokens: 4096,
          temperature: 0.7,
          stream: true
        });

        for await (const chunk of stream) {
          if (chunk.content) {
            fullResponse += chunk.content;
            reply.raw.write(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
          }
          if (chunk.done) {
            reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId })}\n\n`);
          }
        }

        // Estimate tokens (rough approximation)
        tokensInput = Math.ceil(messages.reduce((acc, m) => acc + m.content.length / 4, 0));
        tokensOutput = Math.ceil(fullResponse.length / 4);

      } catch (streamError) {
        reply.raw.write(`data: ${JSON.stringify({ error: 'Stream error', done: true })}\n\n`);
        reply.raw.end();
        return;
      }

      // Save assistant message
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?)',
        [conversationId, 'assistant', fullResponse, tokensInput, tokensOutput]
      );

      // Record token usage
      const cost = calculateCost(body.model, tokensInput, tokensOutput);
      await insertOne(
        fastify.db,
        'INSERT INTO token_usage (user_id, conversation_id, provider, model, tokens_input, tokens_output, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, conversationId, providerName, body.model, tokensInput, tokensOutput, cost]
      );

      // Update monthly usage
      const yearMonth = new Date().toISOString().slice(0, 7);
      await fastify.db.execute(
        `INSERT INTO monthly_usage (user_id, \`year_month\`, provider, total_tokens_input, total_tokens_output, total_cost_usd, request_count)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
         total_tokens_input = total_tokens_input + VALUES(total_tokens_input),
         total_tokens_output = total_tokens_output + VALUES(total_tokens_output),
         total_cost_usd = total_cost_usd + VALUES(total_cost_usd),
         request_count = request_count + 1`,
        [user.id, yearMonth, providerName, tokensInput, tokensOutput, cost]
      );

      // Update conversation timestamp
      await updateOne(
        fastify.db,
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId]
      );

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // List conversations
  fastify.get('/conversations', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List user conversations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const query = request.query as { archived?: string; limit?: string; offset?: string };

    const isArchived = query.archived === 'true';
    const limit = parseInt(query.limit || '20');
    const offset = parseInt(query.offset || '0');

    const conversations = await findMany<Conversation>(
      fastify.db,
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c
       WHERE c.user_id = ? AND c.is_archived = ?
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, isArchived, limit, offset]
    );

    return conversations;
  });

  // Get conversation messages
  fastify.get('/conversations/:id/messages', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get conversation messages',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    // Verify ownership
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    const messages = await findMany<DbMessage>(
      fastify.db,
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [params.id]
    );

    return {
      conversation,
      messages
    };
  });

  // Delete conversation
  fastify.delete('/conversations/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete a conversation',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const result = await updateOne(
      fastify.db,
      'DELETE FROM conversations WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'delete_conversation', 'conversation', params.id, request.ip]
    );

    return { message: 'Conversation deleted' };
  });

  // Archive/unarchive conversation
  fastify.patch('/conversations/:id/archive', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Archive or unarchive a conversation',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const body = request.body as { archived: boolean };

    const result = await updateOne(
      fastify.db,
      'UPDATE conversations SET is_archived = ? WHERE id = ? AND user_id = ?',
      [body.archived, params.id, user.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    return { message: body.archived ? 'Conversation archived' : 'Conversation unarchived' };
  });

  // Get available models - dynamically fetched from provider APIs
  fastify.get('/models', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get available AI models from configured providers (fetched dynamically)',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Get enabled providers with their API keys (encrypted)
    interface ProviderWithKey {
      provider_type: string;
      setting_value: string;
      is_secret: boolean;
      base_url?: string;
    }

    const providers = await findMany<ProviderWithKey>(
      fastify.db,
      `SELECT p.provider_type, ps.setting_value, ps.is_secret,
              (SELECT ps2.setting_value FROM ai_provider_settings ps2
               WHERE ps2.provider_id = p.id AND ps2.setting_key = 'base_url') as base_url
       FROM ai_providers p
       JOIN ai_provider_settings ps ON ps.provider_id = p.id
       WHERE p.is_enabled = TRUE
         AND ps.setting_key IN ('api_key', 'oauth_token')
         AND ps.setting_value IS NOT NULL
         AND ps.setting_value != ''
         AND TRIM(ps.setting_value) != ''`
    );

    if (providers.length === 0) {
      fastify.log.warn('No providers configured with API keys');
      return [];
    }

    // Convert to format expected by ModelFetcher (decrypt API keys)
    const providerConfigs = providers.map(p => ({
      type: p.provider_type,
      apiKey: p.is_secret ? decryptSecret(p.setting_value) : p.setting_value,
      baseUrl: p.base_url
    }));

    fastify.log.info(`Fetching models from ${providerConfigs.length} providers: ${providerConfigs.map(p => p.type).join(', ')}`);

    // Fetch models dynamically from provider APIs
    const models = await fetchAllModels(providerConfigs);

    // Also fetch Parlant agents if the service is healthy
    try {
      const parlantHealthy = await checkParlantHealth();
      if (parlantHealthy) {
        const parlantAgents = await fetchParlantAgents();
        fastify.log.info(`Found ${parlantAgents.length} Parlant agents`);

        // Add Parlant agents as "models"
        for (const agent of parlantAgents) {
          models.push({
            id: `parlant:${agent.id}`,
            name: agent.name || `Parlant Agent`,
            provider: 'Parlant',
            description: agent.description || 'Controlled AI Agent with Guidelines'
          });
        }
      }
    } catch (err: any) {
      fastify.log.warn(`Failed to fetch Parlant agents: ${err?.message || err}`);
    }

    fastify.log.info(`Returning ${models.length} models from provider APIs`);
    return models;
  });

  // Clear models cache (useful when provider settings change)
  fastify.post('/models/refresh', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Clear the models cache to force refresh',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    clearModelsCache();
    return { message: 'Models cache cleared' };
  });
}
