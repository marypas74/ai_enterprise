import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { AIProviderFactory, calculateCost } from '../ai/providers.js';
import { agenticSchema, Conversation, DbMessage } from './types.js';
import { writeSseDone } from './streaming.js';

export async function agenticRoutes(fastify: FastifyInstance) {

  fastify.post('/agentic', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Agentic chat with tool support for file operations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const reqId = `AG-${Date.now()}`;

    fastify.log.info(`[${reqId}] ============ AGENTIC CHAT REQUEST ============`);
    fastify.log.info(`[${reqId}] STEP 1: User: ${user.id}, Time: ${new Date().toISOString()}`);

    try {
      const body = agenticSchema.parse(request.body);
      const maxInferenceMsOverride: number | undefined = (request.body as Record<string, unknown>)?.maxInferenceMs as number | undefined;
      fastify.log.info(`[${reqId}] STEP 1b: Body parsed - Model: ${body.model}, Message length: ${body.message?.length || 0}`);

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
        reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId: 0 })}\n\n`);
        reply.raw.end();
        fastify.log.info(`[${reqId}] ECHO MODE: Test complete`);
        return;
      }

      // Dynamically import tool service
      const { executeTool } = await import('../../services/ToolService.js');

      // Validate projectId - fallback to default if invalid
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

      // Ensure project folder exists
      const { createProjectFolder } = await import('../../services/StorageService.js');
      await createProjectFolder(toolContext.userName, toolContext.projectName);

      // Get tool definitions
      const { selectTools: agenticSelectTools } = await import('../../services/ToolSelectionService.js');
      const tools = body.enableTools ? agenticSelectTools(body.message) : [];

      // Build messages
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

      // AI provider setup
      const providerName = AIProviderFactory.getProviderName(body.model);
      const provider = AIProviderFactory.getProvider(body.model);
      fastify.log.info(`[${reqId}] STEP 2: Using provider ${providerName} for model ${body.model}`);

      // Agentic loop
      let fullResponse = '';
      let tokensInput = 0;
      let tokensOutput = 0;
      let iteration = 0;
      const maxIterations = 10;

      // DEBT-82-A / DEBT-83-E: Per-tier hard timeout. Default 30000ms (balanced tier seed).
      // maxInferenceMs is NOT in agenticSchema (agentic endpoint) — read from raw body.
      // When called from completions.ts via routing, the value is passed as raw body field.
      const TIMEOUT_MS: number = maxInferenceMsOverride ?? 30000;
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

      // Inject system prompt if not present
      if (!messages.find(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }

      // Track real download URLs from document generation tools
      const generatedDownloads: { downloadUrl: string; downloadFilename: string; displayName: string }[] = [];

      while (iteration < maxIterations && !requestAborted) {
        iteration++;
        resetWatchdog(`iteration_${iteration}_start`);
        sendDebug(`Iteration ${iteration}/${maxIterations} - Calling AI...`);
        fastify.log.info(`[${reqId}] STEP 3: Starting iteration ${iteration}, messages count: ${messages.length}`);

        try {
          const apiStartTime = Date.now();

          const response = await provider.complete({
            model: body.model,
            messages,
            maxTokens: 4096,
            temperature: 0.7,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
            tools: tools as any
          });

          resetWatchdog(`iteration_${iteration}_processing`);
          const apiDuration = Date.now() - apiStartTime;
          sendDebug(`AI responded in ${apiDuration}ms`);
          fastify.log.info(`[${reqId}] STEP 3b: Provider responded in ${apiDuration}ms`);

          tokensInput += response.tokensInput;
          tokensOutput += response.tokensOutput;

          if (response.content) {
            let content = response.content;
            // Fix AI-hallucinated download links
            if (generatedDownloads.length > 0) {
              content = content.replace(
                /\[([^\]]*)\]\(\/api\/tools\/download\/[^)]+\)/g,
                () => {
                  const dl = generatedDownloads[generatedDownloads.length - 1];
                  return `[Scarica ${dl.displayName}](${dl.downloadUrl})`;
                }
              );
            }
            fullResponse += content;
            reply.raw.write(`data: ${JSON.stringify({ content, done: false, iteration })}\n\n`);
          }

          // Process tool calls
          const toolCalls = response.toolCalls;
          if (toolCalls && toolCalls.length > 0) {
            sendDebug(`Processing ${toolCalls.length} tool calls...`);
            fastify.log.info(`[${reqId}] STEP 4: Tool calls detected: ${toolCalls.length}`);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
            const toolResults: any[] = [];

            messages.push({
              role: 'assistant',
              content: response.content || '',
              tool_calls: toolCalls
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
            } as any);

            for (const toolCall of toolCalls) {
              const name = toolCall.function?.name || toolCall.name;
              const input = typeof toolCall.function?.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : (toolCall.function?.arguments || toolCall.input);
              const id = toolCall.id;

              sendDebug(`Tool: ${name}`);

              reply.raw.write(`data: ${JSON.stringify({
                toolUse: { name, input },
                done: false,
                iteration
              })}\n\n`);

              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
              let result: { success: boolean; output?: any; error?: string };
              try {
                resetWatchdog(`tool_${name}`);
                result = await executeTool(name, input, toolContext);
                resetWatchdog(`tool_${name}_done`);
                sendDebug(`${name} result: ${result.success ? 'Success' : 'Error'}`);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
              } catch (toolError: any) {
                sendDebug(`${name} crashed: ${toolError.message}`);
                result = { success: false, error: toolError.message };
              }

              // Track download URLs from document generation tools
              if (result.success && result.output?.downloadUrl && result.output?.downloadFilename) {
                generatedDownloads.push({
                  downloadUrl: result.output.downloadUrl,
                  downloadFilename: result.output.downloadFilename,
                  displayName: result.output.path ? path.basename(result.output.path) : result.output.downloadFilename
                });
              }

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

            messages.push(...toolResults);
          } else {
            // No tool calls, loop finished
            break;
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (error: any) {
          clearWatchdog();
          const isAbort = error.name === 'AbortError' || error.message?.includes('abort');

          if (isAbort) {
            const timeoutMsg = `TIMEOUT: Request aborted after ${TIMEOUT_MS / 1000}s - AI model did not respond`;
            sendDebug(timeoutMsg);
            fastify.log.error({
              msg: timeoutMsg,
              reqId,
              iteration,
              source: 'backend',
              type: 'HARD_TIMEOUT'
            });
            // DEBT-83-A: use writeSseDone for consistent SSE done structure
            writeSseDone(reply, { error: 'REQUEST_TIMEOUT_30S', finishReason: null });
          } else {
            sendDebug(`ERROR in iteration ${iteration}: ${error.message}`);
            fastify.log.error({
              msg: `Agentic error in iteration ${iteration}: ${error.message}`,
              reqId,
              source: 'backend',
              error: error.stack
            });
            // DEBT-83-A: use writeSseDone for consistent SSE done structure
            writeSseDone(reply, { error: error.message, finishReason: null });
          }

          reply.raw.end();
          return;
        }
      }

      clearWatchdog();

      sendDebug(`AGENT COMPLETE - ${iteration} iterations, ${tokensInput + tokensOutput} tokens used`);
      // DEBT-83-A: use writeSseDone for consistent SSE done structure with finish_reason
      writeSseDone(reply, { conversationId, iterations: iteration, finishReason: 'stop' });

      // Save assistant message
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
