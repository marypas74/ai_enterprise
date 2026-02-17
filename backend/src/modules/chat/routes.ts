import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { AIProviderFactory, calculateCost, Message } from '../ai/providers.js';
import { fetchAllModels, clearModelsCache } from '../../services/ModelFetcher.js';
import { ParlantProviderFactory, fetchParlantAgents, checkParlantHealth } from '../../services/ParlantProvider.js';
import { enhanceWithWebSearch } from '../../services/WebSearchService.js';
import { saveCodeBlocks, formatSavedFilesNotification, isAutoSaveModel } from '../../services/CodeAutoSaveService.js';

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
  systemPrompt: z.string().optional(),
  attachmentIds: z.array(z.number()).optional()
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

      // DEBUG: Log entry point
      console.log(`[Chat-DEBUG] ============ REQUEST START ============`);
      console.log(`[Chat-DEBUG] Model: "${body.model}"`);
      console.log(`[Chat-DEBUG] Message length: ${body.message?.length || 0}`);
      console.log(`[Chat-DEBUG] User ID: ${user.id}`);
      fastify.log.info(`[Chat] Request for model: ${body.model}`);

      // Check if this is a Parlant agent (model format: "parlant:{agentId}")
      const isParlantAgent = body.model.startsWith('parlant:');
      let provider;
      let providerName: string;

      if (isParlantAgent) {
        // Parse agent ID safely
        const agentId = body.model.split(':')[1];
        if (!agentId || agentId.trim() === '') {
          return reply.status(400).send({
            error: 'Invalid Parlant model format',
            message: 'Expected format: parlant:{agentId}'
          });
        }

        // Check if Parlant service is reachable BEFORE attempting to use it
        const parlantHealthy = await checkParlantHealth();
        if (!parlantHealthy) {
          fastify.log.error(`[Chat] Parlant service is not reachable`);
          return reply.status(503).send({
            error: 'Parlant service unavailable',
            message: 'The Parlant AI Agent service is not running or not reachable. Please contact your administrator.',
            hint: 'Ensure PARLANT_URL is configured and the Parlant service is running.'
          });
        }

        provider = ParlantProviderFactory.getProvider(agentId.trim(), 'Parlant Agent', `user_${user.id}`);
        providerName = 'parlant';
        fastify.log.info(`[Chat] Using Parlant agent: ${agentId}`);
      } else {
        providerName = AIProviderFactory.getProviderName(body.model);
        console.log(`[Chat-DEBUG] Provider determined: "${providerName}" for model "${body.model}"`);
        fastify.log.info(`[Chat] Using ${providerName} provider for model: ${body.model}`);
        provider = AIProviderFactory.getProvider(body.model);
        console.log(`[Chat-DEBUG] Provider instance created: ${provider?.name || 'NULL'}`);
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
      // Add user message
      let userMessage = body.message;

      // Handle attachments if present
      if (body.attachmentIds && body.attachmentIds.length > 0) {
        // Fetch attachments
        const placeholders = body.attachmentIds.map(() => '?').join(',');
        const attachments = await findMany<any>(
          fastify.db,
          `SELECT id, original_name, content_type, processing_status, processed_content
           FROM chat_attachments
           WHERE id IN (${placeholders}) AND user_id = ?`,
          [...body.attachmentIds, user.id]
        );

        // Build context from: semantic search (L3) → keyword chunks (L2) → full content
        const contextParts: string[] = [];

        // Try semantic search across all attachments first (Layer 3)
        let semanticResults: any[] = [];
        try {
          const { searchSimilar } = await import('../../services/VectorStoreService.js');
          semanticResults = await searchSimilar(fastify.db, body.message, {
            attachmentIds: body.attachmentIds.map(Number),
            limit: 8,
            scoreThreshold: 0.3,
          });
        } catch {
          // Vector store not available — will fall back to Layer 2
        }

        if (semanticResults.length > 0) {
          // Group semantic results by attachment
          const byAttachment = new Map<number, string[]>();
          for (const r of semanticResults) {
            const arr = byAttachment.get(r.attachmentId) || [];
            arr.push(r.content);
            byAttachment.set(r.attachmentId, arr);
          }

          for (const a of attachments) {
            if (!a.processed_content) continue;
            const semanticChunks = byAttachment.get(a.id);
            const content = semanticChunks
              ? semanticChunks.join('\n\n---\n\n')
              : a.processed_content.substring(0, 2000);
            contextParts.push(`[Allegato: ${a.original_name} (${a.content_type})]\n${content}\n[Fine allegato]`);
          }
          console.log(`[Chat-DEBUG] Used semantic search: ${semanticResults.length} chunks across ${byAttachment.size} attachments`);
        } else {
          // Fallback to Layer 2 (keyword chunks) or full content
          for (const a of attachments) {
            if (!a.processed_content) continue;

            let chunkContext: string | null = null;
            try {
              const chunks = await findMany<{ content: string; chunk_index: number; metadata: string }>(
                fastify.db,
                'SELECT content, chunk_index, metadata FROM document_chunks WHERE attachment_id = ? ORDER BY chunk_index ASC',
                [a.id]
              );

              if (chunks.length > 1) {
                const { selectRelevantChunks } = await import('../../services/ChunkingService.js');
                const chunkObjs = chunks.map((c: any) => ({
                  index: c.chunk_index,
                  content: c.content,
                  charCount: c.content.length,
                  metadata: JSON.parse(c.metadata || '{}')
                }));

                const relevant = selectRelevantChunks(chunkObjs, body.message, 5);
                if (relevant.length > 0) {
                  chunkContext = relevant.map(c => c.content).join('\n\n---\n\n');
                  console.log(`[Chat-DEBUG] Used ${relevant.length}/${chunks.length} keyword chunks for ${a.original_name}`);
                }
              }
            } catch (chunkErr: any) {
              console.log(`[Chat-DEBUG] Chunk retrieval failed for ${a.id}: ${chunkErr.message}, using full content`);
            }

            const content = chunkContext || a.processed_content;
            contextParts.push(`[Allegato: ${a.original_name} (${a.content_type})]\n${content}\n[Fine allegato]`);
          }
        }

        if (contextParts.length > 0) {
          const attachmentContext = contextParts.join('\n\n');
          userMessage = `${attachmentContext}\n\n---\nDomanda utente: ${body.message}`;
          console.log(`[Chat-DEBUG] Added context from ${contextParts.length} attachments`);
        } else {
          console.log(`[Chat-DEBUG] Attachments found but no processed content available yet`);
        }
      }

      messages.push({ role: 'user', content: userMessage });
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'user', userMessage]
      );

      // Add coding system prompt for coder models
      if (isAutoSaveModel(body.model)) {
        const codingSystemPrompt = `Sei un esperto assistente di programmazione. Quando generi codice:
1. Scrivi codice completo e pronto per la produzione
2. Includi tutti gli import e le dipendenze necessarie
3. Aggiungi commenti chiari in italiano che spiegano ogni sezione
4. Usa il formato commento per il nome file: # filename.py o // filename.js
5. Genera applicazioni complete, non solo frammenti
6. Includi gestione errori e validazione input
7. Segui le best practice del linguaggio

Il codice che generi verrà salvato automaticamente nella cartella condivisa. Usa commenti chiari per i nomi dei file.`;

        const systemIndex = messages.findIndex(m => m.role === 'system');
        if (systemIndex >= 0) {
          messages[systemIndex].content = codingSystemPrompt + '\n\n' + messages[systemIndex].content;
        } else {
          messages.unshift({ role: 'system', content: codingSystemPrompt });
        }
      }

      // Check if web search is needed and enhance context
      let webSearchPerformed = false;
      try {
        const searchResult = await enhanceWithWebSearch(body.message);
        if (searchResult.shouldSearch && searchResult.searchContext) {
          webSearchPerformed = true;
          fastify.log.info(`[Chat] Web search performed, found ${searchResult.searchResponse?.results?.length || 0} results`);

          // Add search context to the system prompt or create one
          const searchSystemMessage = `You have access to current web search results. Use them to provide accurate, up-to-date information.\n${searchResult.searchContext}`;

          // Check if there's already a system message
          const systemIndex = messages.findIndex(m => m.role === 'system');
          if (systemIndex >= 0) {
            messages[systemIndex].content += '\n\n' + searchSystemMessage;
          } else {
            messages.unshift({ role: 'system', content: searchSystemMessage });
          }
        }
      } catch (searchError: any) {
        fastify.log.warn(`[Chat] Web search failed: ${searchError.message}`);
        // Continue without search results
      }

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': conversationId.toString(),
        'X-Web-Search': webSearchPerformed ? 'true' : 'false'
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

        // Auto-save code blocks for coding models
        if (isAutoSaveModel(body.model) && fullResponse.length > 50) {
          try {
            const saveResult = await saveCodeBlocks(fullResponse, {
              projectName: `session_${conversationId}`
            });

            if (saveResult.savedFiles.length > 0) {
              const notification = formatSavedFilesNotification(saveResult);
              // Send notification as additional SSE event
              reply.raw.write(`data: ${JSON.stringify({
                content: notification,
                done: false,
                autoSave: true,
                savedFiles: saveResult.savedFiles.map(f => ({
                  filename: f.filename,
                  language: f.language,
                  path: f.path.replace('/data/shared-projects', '\\\\192.168.1.123\\projects').replace(/\//g, '\\\\')
                }))
              })}\n\n`);
              fastify.log.info(`[Chat] Auto-saved ${saveResult.savedFiles.length} code files for model ${body.model}`);
            }
          } catch (saveError: unknown) {
            const errMsg = saveError instanceof Error ? saveError.message : 'Unknown error';
            fastify.log.warn(`[Chat] Auto-save failed: ${errMsg}`);
          }
        }

      } catch (streamError: any) {
        const errorMessage = streamError?.message || 'Unknown stream error';
        console.log(`[Chat-DEBUG] ============ STREAM ERROR ============`);
        console.log(`[Chat-DEBUG] Error name: ${streamError?.name}`);
        console.log(`[Chat-DEBUG] Error message: ${errorMessage}`);
        console.log(`[Chat-DEBUG] Error stack: ${streamError?.stack?.substring(0, 500)}`);
        fastify.log.error(`[Chat] Stream error: ${errorMessage}`);

        // Provide specific error messages for known issues
        let userMessage = 'An error occurred while processing your request.';
        if (errorMessage.includes('Parlant')) {
          userMessage = 'Parlant AI Agent service error: ' + errorMessage;
        } else if (errorMessage.includes('timeout')) {
          userMessage = 'Request timed out. The AI service took too long to respond.';
        } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
          userMessage = 'Could not connect to the AI service. Please try again later.';
        }

        reply.raw.write(`data: ${JSON.stringify({ error: userMessage, done: true })}\n\n`);
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

  // Get available models - from database (admin-enabled only)
  fastify.get('/models', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get AI models enabled by admin',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Get enabled models from database with their provider info
    interface EnabledModel {
      model_id: string;
      display_name: string;
      description: string | null;
      provider_name: string;
      provider_type: string;
      supports_streaming: boolean;
      supports_functions: boolean;
      supports_vision: boolean;
    }

    const models = await findMany<EnabledModel>(
      fastify.db,
      `SELECT m.model_id, m.display_name, m.description,
              p.name as provider_name, p.provider_type,
              m.supports_streaming, m.supports_functions, m.supports_vision
       FROM ai_models m
       JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE
         AND p.is_enabled = TRUE
       ORDER BY p.name, m.sort_order, m.display_name`
    );

    // Transform to expected format
    const result = models.map(m => ({
      id: m.model_id,
      name: m.display_name,
      provider: m.provider_name,
      description: m.description || undefined,
      supportsStreaming: m.supports_streaming,
      supportsFunctions: m.supports_functions,
      supportsVision: m.supports_vision
    }));

    // Also fetch Parlant agents if the service is healthy
    try {
      const parlantHealthy = await checkParlantHealth();
      if (parlantHealthy) {
        const parlantAgents = await fetchParlantAgents();
        fastify.log.info(`Found ${parlantAgents.length} Parlant agents`);

        // Add Parlant agents as "models"
        for (const agent of parlantAgents) {
          result.push({
            id: `parlant:${agent.id}`,
            name: agent.name || `Parlant Agent`,
            provider: 'Parlant',
            description: agent.description || 'Controlled AI Agent with Guidelines',
            supportsStreaming: true,
            supportsFunctions: false,
            supportsVision: false
          });
        }
      }
    } catch (err: any) {
      fastify.log.warn(`Failed to fetch Parlant agents: ${err?.message || err}`);
    }

    fastify.log.info(`Returning ${result.length} enabled models from database`);
    return result;
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

  // Agentic chat with tool support (for task execution)
  const agenticSchema = z.object({
    conversationId: z.number().optional(),
    projectId: z.number(),
    model: z.string(),
    message: z.string().min(1),
    systemPrompt: z.string().optional(),
    enableTools: z.boolean().optional().default(true)
  });

  fastify.post('/agentic', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Agentic chat with tool support for file operations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const reqId = `AG-${Date.now()}`; // Unique request ID for tracing

    fastify.log.info(`[${reqId}] ============ AGENTIC CHAT REQUEST ============`);
    fastify.log.info(`[${reqId}] STEP 1: User: ${user.id}, Time: ${new Date().toISOString()}`);

    try {
      const body = agenticSchema.parse(request.body);
      fastify.log.info(`[${reqId}] STEP 1b: Body parsed - Model: ${body.model}, Message length: ${body.message?.length || 0}`);

      // ============================================================
      // ECHO MODE TEST - Send "/test" to verify SSE streaming works
      // ============================================================
      if (body.message.startsWith('/test')) {
        fastify.log.info(`[${reqId}] ECHO MODE: Testing SSE stream...`);
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        reply.raw.write(`data: ${JSON.stringify({ content: 'Echo test: Stream working! ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Second chunk received. ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Third chunk. Stream OK!', done: false })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId: 0 })}\n\n`);
        reply.raw.end();
        fastify.log.info(`[${reqId}] ECHO MODE: Test complete`);
        return;
      }
      // ============================================================

      // Dynamically import tool service
      const { getToolDefinitions, executeTool } = await import('../../services/ToolService.js');

      // Validate projectId - fallback to default if invalid
      let validProjectId = body.projectId;
      if (!validProjectId || validProjectId === 0 || validProjectId < 1) {
        fastify.log.warn(`[${reqId}] Invalid projectId: ${body.projectId} - attempting to use user's first project`);
        // Try to get user's first project as fallback
        const firstProject = await findOne<{ id: number }>(
          fastify.db,
          'SELECT id FROM projects WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
          [user.id]
        );
        if (firstProject) {
          validProjectId = firstProject.id;
          fastify.log.info(`[${reqId}] Using fallback project ID: ${validProjectId}`);
        } else {
          return reply.status(400).send({
            error: 'Invalid project ID and no default project found',
            hint: 'Please select a valid project before running tasks'
          });
        }
      }

      // Get project context for tools
      const project = await findOne<{ name: string; owner_id: number }>(
        fastify.db,
        'SELECT name, owner_id FROM projects WHERE id = ?',
        [validProjectId]
      );

      if (!project) {
        return reply.status(404).send({ error: `Project ${validProjectId} not found` });
      }

      const owner = await findOne<{ name: string; email: string }>(
        fastify.db,
        'SELECT name, email FROM users WHERE id = ?',
        [project.owner_id]
      );

      const toolContext = {
        userName: owner?.name || owner?.email?.split('@')[0] || `user_${project.owner_id}`,
        projectName: project.name,
        projectId: validProjectId,
        userId: user.id
      };

      // Ensure project folder exists
      const { createProjectFolder } = await import('../../services/StorageService.js');
      await createProjectFolder(toolContext.userName, toolContext.projectName);

      // Get tool definitions
      const tools = body.enableTools ? getToolDefinitions() : [];

      // Build messages
      let conversationId = body.conversationId;
      let messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }[] = [];

      if (conversationId) {
        const conversation = await findOne<Conversation>(
          fastify.db,
          'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
          [conversationId, user.id]
        );

        if (!conversation) {
          return reply.status(404).send({ error: 'Conversation not found' });
        }

        const dbMessages = await findMany<DbMessage>(
          fastify.db,
          'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
          [conversationId]
        );

        messages = dbMessages.map(m => ({
          role: m.role as any,
          content: m.content
        }));
      } else {
        const title = body.message.slice(0, 100);
        const providerName = AIProviderFactory.getProviderName(body.model);
        conversationId = await insertOne(
          fastify.db,
          'INSERT INTO conversations (user_id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)',
          [user.id, title, body.model, providerName, body.systemPrompt || null]
        );
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

      const sendDebug = (msg: string) => {
        fastify.log.info(`[AGENTIC-DEBUG] ${msg}`);
      };

      // ============================================================
      // ECHO MODE TEST - Send "/test" to verify SSE streaming works
      // ============================================================
      if (body.message.startsWith('/test')) {
        fastify.log.info(`[${reqId}] ECHO MODE: Testing SSE stream...`);
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        reply.raw.write(`data: ${JSON.stringify({ content: 'Echo test: Stream working! ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Second chunk received. ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Third chunk. Stream OK!', done: false })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId: 0 })}\n\n`);
        reply.raw.end();
        fastify.log.info(`[${reqId}] ECHO MODE: Test complete`);
        return;
      }
      // ============================================================

      // AI provider setup
      const providerName = AIProviderFactory.getProviderName(body.model);
      const provider = AIProviderFactory.getProvider(body.model);
      fastify.log.info(`[${reqId}] STEP 2: Using provider ${providerName} for model ${body.model}`);

      // Agentic loop - continue until no tool calls
      let fullResponse = '';
      let tokensInput = 0;
      let tokensOutput = 0;
      let iteration = 0;
      const maxIterations = 10; // Prevent infinite loops

      // ============================================================
      // 30-SECOND WATCHDOG TIMER - Prevents stalled requests
      // ============================================================
      const TIMEOUT_MS = 30000;
      let watchdogTimer: NodeJS.Timeout | null = null;
      let requestAborted = false;

      const resetWatchdog = (context: string) => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
          if (!requestAborted) {
            requestAborted = true;
            const timeoutMsg = `⏱️ TIMEOUT: No response after 30s during "${context}"`;
            fastify.log.error(`[${reqId}] ${timeoutMsg}`);
            sendDebug(`❌ ${timeoutMsg}`);
            reply.raw.write(`data: ${JSON.stringify({
              error: 'REQUEST_TIMEOUT_30S',
              message: timeoutMsg,
              context,
              done: true
            })}\n\n`);
            reply.raw.end();
          }
        }, TIMEOUT_MS);
      };

      const clearWatchdog = () => {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
      };

      // Start the watchdog
      resetWatchdog('initial_connection');

      // Send immediate "thinking" notification to keep connection alive
      reply.raw.write(`data: ${JSON.stringify({ status: 'thinking', message: 'Connecting to AI...', reqId })}\n\n`);
      resetWatchdog('connecting_to_ai');

      const systemPrompt = body.systemPrompt || `You are a skilled software developer AI assistant. Your ONLY purpose is to write and manage code files and Office documents.

CRITICAL INSTRUCTIONS:
1. You DO NOT have the ability to update Kanban board status or move cards. Do not try.
2. Your available tools are: write_file, read_file, list_files, create_folder, generate_word_document, generate_excel_document, generate_powerpoint_document
3. When asked to create code or documents, immediately use the appropriate tool to save them.
4. Save files to the project storage using relative paths (e.g., "src/main.py", "index.html", "outputs/report.docx")
5. Always create complete, working content - never leave placeholders
6. After writing files, briefly explain what you created

Focus 100% on generation. Start writing files immediately.`;

      // Inject system prompt if not present in messages
      if (!messages.find(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }

      while (iteration < maxIterations && !requestAborted) {
        iteration++;
        resetWatchdog(`iteration_${iteration}_start`);
        sendDebug(`🔄 Iteration ${iteration}/${maxIterations} - Calling AI...`);
        fastify.log.info(`[${reqId}] STEP 3: Starting iteration ${iteration}, messages count: ${messages.length}`);

        try {
          const apiStartTime = Date.now();

          // Call provider.complete (non-streaming for tool handling in a loop is usually more robust)
          // Though we could stream if we wanted chunked text + tool calls later.
          const response = await provider.complete({
            model: body.model,
            messages,
            maxTokens: 4096,
            temperature: 0.7,
            tools: tools as any
          });

          // AI responded - reset watchdog
          resetWatchdog(`iteration_${iteration}_processing`);
          const apiDuration = Date.now() - apiStartTime;
          sendDebug(`✅ AI responded in ${apiDuration}ms`);
          fastify.log.info(`[${reqId}] STEP 3b: Provider responded in ${apiDuration}ms`);

          tokensInput += response.tokensInput;
          tokensOutput += response.tokensOutput;

          if (response.content) {
            fullResponse += response.content;
            reply.raw.write(`data: ${JSON.stringify({ content: response.content, done: false, iteration })}\n\n`);
          }

          // Process tool calls
          const toolCalls = response.toolCalls;
          if (toolCalls && toolCalls.length > 0) {
            sendDebug(`🔧 Processing ${toolCalls.length} tool calls...`);
            fastify.log.info(`[${reqId}] STEP 4: Tool calls detected: ${toolCalls.length}`);

            const toolResults: any[] = [];

            // Add assistant message with tool calls to history
            messages.push({
              role: 'assistant',
              content: response.content || '',
              tool_calls: toolCalls
            } as any);

            for (const toolCall of toolCalls) {
              const name = toolCall.function?.name || toolCall.name;
              const input = typeof toolCall.function?.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : (toolCall.function?.arguments || toolCall.input);
              const id = toolCall.id;

              sendDebug(`🛠️ Tool: ${name}`);

              // Notify client
              reply.raw.write(`data: ${JSON.stringify({
                toolUse: { name, input },
                done: false,
                iteration
              })}\n\n`);

              let result: { success: boolean; output?: any; error?: string };
              try {
                resetWatchdog(`tool_${name}`);
                result = await executeTool(name, input, toolContext);
                resetWatchdog(`tool_${name}_done`);
                sendDebug(`✅ ${name} result: ${result.success ? 'Success' : 'Error'}`);
              } catch (toolError: any) {
                sendDebug(`⚠️ ${name} crashed: ${toolError.message}`);
                result = { success: false, error: toolError.message };
              }

              // Notify client
              reply.raw.write(`data: ${JSON.stringify({
                toolResult: { name, success: result.success, output: result.output, error: result.error },
                done: false,
                iteration
              })}\n\n`);

              toolResults.push({
                role: 'tool',
                tool_call_id: id,
                name: name,
                content: result.success ? JSON.stringify(result.output) : `Error: ${result.error}`
              });
            }

            // Add tool results to history
            messages.push(...toolResults);
          } else {
            // No tool calls, loop finished
            break;
          }
        } catch (error: any) {
          clearWatchdog();
          const isAbort = error.name === 'AbortError' || error.message?.includes('abort');

          if (isAbort) {
            const timeoutMsg = `⏱️ TIMEOUT: Request aborted after ${TIMEOUT_MS / 1000}s - AI model did not respond`;
            sendDebug(`❌ ${timeoutMsg}`);
            fastify.log.error({
              msg: timeoutMsg,
              reqId,
              iteration,
              source: 'backend',
              type: 'HARD_TIMEOUT'
            });
            reply.raw.write(`data: ${JSON.stringify({
              error: 'REQUEST_TIMEOUT_30S',
              message: timeoutMsg,
              done: true
            })}\n\n`);
          } else {
            sendDebug(`❌ ERROR in iteration ${iteration}: ${error.message}`);
            fastify.log.error({
              msg: `Agentic error in iteration ${iteration}: ${error.message}`,
              reqId,
              source: 'backend',
              error: error.stack
            });
            reply.raw.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
          }

          reply.raw.end();
          return;
        }
      }

      // Clear watchdog - agent completed successfully
      clearWatchdog();

      // Final done message
      sendDebug(`🎉 AGENT COMPLETE - ${iteration} iterations, ${tokensInput + tokensOutput} tokens used`);
      reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId, iterations: iteration })}\n\n`);

      // Save assistant message
      if (fullResponse) {
        await insertOne(
          fastify.db,
          'INSERT INTO messages (conversation_id, role, content, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?)',
          [conversationId, 'assistant', fullResponse, tokensInput, tokensOutput]
        );
      }

      // Record usage
      const cost = calculateCost(body.model, tokensInput, tokensOutput);
      await insertOne(
        fastify.db,
        'INSERT INTO token_usage (user_id, conversation_id, provider, model, tokens_input, tokens_output, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, conversationId, providerName, body.model, tokensInput, tokensOutput, cost]
      );

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
}
