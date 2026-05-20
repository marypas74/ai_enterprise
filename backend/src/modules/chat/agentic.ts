import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { AIProviderFactory, calculateCost } from '../ai/providers.js';
import { agenticSchema, Conversation, DbMessage } from './types.js';
import { writeSseDone } from './streaming.js';
// DEBT-87-J: agentic loop extracted to AgenticStreamRunner
import { runAgenticLoop } from './runners/AgenticStreamRunner.js';

export async function agenticRoutes(fastify: FastifyInstance) {

  fastify.post('/agentic', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fastify.authenticate is a JWT plugin decoration not in FastifyInstance type
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Agentic chat with tool support for file operations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const reqId = `AG-${Date.now()}`;

    fastify.log.info(`[${reqId}] Agentic request — user: ${user.id}`);

    try {
      const body = agenticSchema.parse(request.body);

      // ECHO MODE TEST
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
        writeSseDone(reply, { conversationId: 0, finishReason: 'stop' });
        reply.raw.end();
        fastify.log.info(`[${reqId}] ECHO MODE: Test complete`);
        return;
      }

      // Dynamically import tool service
      const { executeTool } = await import('../../services/ToolService.js');

      let validProjectId = body.projectId;
      if (!validProjectId || validProjectId === 0 || validProjectId < 1) {
        fastify.log.warn(`[${reqId}] Invalid projectId: ${body.projectId} - attempting to use user's first project`);
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
        userId: user.id,
        db: fastify.db,
        log: fastify.log
      };

      const { createProjectFolder } = await import('../../services/StorageService.js');
      await createProjectFolder(toolContext.userName, toolContext.projectName);

      const { selectTools: agenticSelectTools } = await import('../../services/ToolSelectionService.js');
      const tools = body.enableTools ? agenticSelectTools(body.message) : [];
      let conversationId = body.conversationId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DbMessage.role is 'system'|'user'|'assistant'; messages union also needs 'tool' for tool-call turns
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

      messages.push({ role: 'user', content: body.message });
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'user', body.message]
      );

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': conversationId!.toString()
      });

      const sendDebug = (msg: string) => {
        fastify.log.info(`[AGENTIC-DEBUG] ${msg}`);
      };

      const providerName = AIProviderFactory.getProviderName(body.model);
      const provider = AIProviderFactory.getProvider(body.model);
      fastify.log.info(`[${reqId}] provider=${providerName}, model=${body.model}`);

      let fullResponse = '';
      let tokensInput = 0;
      let tokensOutput = 0;
      let iteration = 0;
      const maxIterations = 10;

      const TIMEOUT_MS: number = body.maxInferenceMs ?? 30000; // per-tier hard timeout
      let watchdogTimer: NodeJS.Timeout | null = null;
      let requestAborted = false;

      const resetWatchdog = (context: string) => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
          if (!requestAborted) {
            requestAborted = true;
            const timeoutMsg = `TIMEOUT: No response after ${TIMEOUT_MS / 1000}s during "${context}"`;
            fastify.log.error(`[${reqId}] ${timeoutMsg}`);
            sendDebug(`${timeoutMsg}`);
            // DEBT-83-A: use writeSseDone for consistent SSE done structure with finish_reason
            writeSseDone(reply, { error: 'REQUEST_TIMEOUT', finishReason: null });
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

      resetWatchdog('initial_connection');

      // Keepalive prevents Cloudflare 524; declared nullable for DEBT-87-K safe clearInterval
      let keepaliveInterval: NodeJS.Timeout | null = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write('data: {"type":"keepalive"}\n\n');
      }, 25000);
      reply.raw.on('close', () => { if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; } });

      // Send immediate "thinking" notification
      reply.raw.write(`data: ${JSON.stringify({ status: 'thinking', message: 'Connecting to AI...', reqId })}\n\n`);
      resetWatchdog('connecting_to_ai');

      const systemPrompt = body.systemPrompt || `You are a skilled AI assistant with full programmatic capabilities.

AVAILABLE TOOLS:
1. **execute_python** -- Run Python code in a sandbox with access to:
   - File ops: tool.read_file(path), tool.write_file(path, content), tool.list_files(path)
   - Web search: tool.web_search(query) -> [{url, title, snippet}]
   - HTTP: tool.http_get(url), tool.web_extract(url) -> clean text
   - Vector DB: tool.vector_search(query, collection, top_k), tool.vector_upsert(text, metadata)
   - Data analysis: tool.dataframe(data) -> pandas DataFrame
   - Use print() to return output. The "tool" variable is pre-initialized.

2. **vector_memory_search** -- Search vector memory for relevant context
3. **write_file / read_file / list_files / create_folder** -- Direct file operations
4. **generate_word_document / generate_excel_document / generate_powerpoint_document** -- Office docs
5. **web_search / browse_url** -- Web access
6. **get_attachment_text** -- Read uploaded file content

STRATEGY:
- For complex multi-step tasks, prefer execute_python to orchestrate everything in one call
- For simple file operations, use the direct tools
- For data analysis, use execute_python with pandas
- For web research + analysis, use execute_python combining tool.web_search() and tool.web_extract()
- Always produce complete, working output -- never leave placeholders
- After completing work, briefly explain what you did`;

      if (!messages.find(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }

      // DEBT-87-J: delegate streaming + tool loop to AgenticStreamRunner
      const loopResult = await runAgenticLoop(messages, {
        provider,
        model: body.model,
        tools,
        maxIterations,
        reqId,
        reply,
        log: fastify.log,
        sendDebug,
        resetWatchdog,
        clearWatchdog,
        clearKeepalive: () => { if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; } },
        toolContext,
        executeTool,
        timeoutMs: TIMEOUT_MS,
      });

      if (loopResult.handled) return;

      // Unpack loop results (immutable destructure)
      fullResponse = loopResult.fullResponse;
      tokensInput = loopResult.tokensInput;
      tokensOutput = loopResult.tokensOutput;
      iteration = loopResult.iteration;
      messages.length = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AMessage.role is string; local messages expects union — safe cast
      messages.push(...(loopResult.messages as any[]));

      clearWatchdog();
      if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }

      sendDebug(`AGENT COMPLETE - ${iteration} iterations, ${tokensInput + tokensOutput} tokens`);
      writeSseDone(reply, { conversationId, iterations: iteration, finishReason: 'stop' });
      if (fullResponse) {
        await insertOne(
          fastify.db,
          'INSERT INTO messages (conversation_id, role, content, tokens_input, tokens_output, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [conversationId, 'assistant', fullResponse, tokensInput, tokensOutput, true, body.model, providerName]
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
