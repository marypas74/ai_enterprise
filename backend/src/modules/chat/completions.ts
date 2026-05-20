import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, insertOne, updateOne } from '../../database/index.js';
import { AIProviderFactory, calculateCost, Message } from '../ai/providers.js';
import { ParlantProviderFactory, checkParlantHealth } from '../../services/ParlantProvider.js';
import { selectTools } from '../../services/ToolSelectionService.js';
import { MemoryService } from '../memory/service.js';
import { eventBus } from '../../services/EventBusService.js';
import { storeEpisodic } from '../../services/VectorMemoryService.js';
import { ConversationalFormService } from '../../services/ConversationalFormService.js';
import { ModelConfigService } from '../../services/ModelConfigService.js';
import { recordProviderSuccess } from '../../services/CircuitBreakerService.js';
import { ContentSafetyService } from '../compliance/contentSafety.js';
import { completionSchema, SafetyResult, ToolContext } from './types.js';
import { validateChatModel } from './model-validation.js';
import {
  createSseWriter, writeSseHeaders, sendInitialSseEvents, sendFastReply,
  recordTokenComponents, recordUsageAndAudit,
  isDirectConversionRequest, directConvertAttachment, detectDocumentFormat
} from './streaming.js';
import {
  prepareToolContext, loadOrCreateConversation, injectFormContext,
  processAttachments, injectSystemPrompts, ensureItalianSystemPrompt,
  injectRAGSystemPrompt, injectBrainstormSystemPrompt
} from './context-builder.js';
import { getModelRouter, type RoutingDecision } from '../../services/ModelRouter.js';
import { estimateMessageTokens, ASYNC_TOKEN_THRESHOLD, MAX_TOKEN_LIMIT } from '../../utils/tokenEstimator.js';
// DEBT-80-D: extracted runners
import { runToolLoop, type ToolLoopRunnerOptions } from './runners/ToolLoopRunner.js';
import { createStreamState } from './runners/ChatStreamRunner.js';
// DEBT-81-D: additional extracted runners
import { runAutoRouting } from './runners/AutoRoutingRunner.js';
import { applyRagGuard } from './runners/RagGuard.js';
import { maybeDispatchToAsyncQueue } from './runners/AsyncQueueRunner.js';
import { runFallbackChain } from './runners/FallbackChain.js';
// HIGH-1: escalation + embedded tool fallback + post-processing extracted from completions.ts
import { runEmptyResponseEscalation } from './runners/EscalationRunner.js';
import { runEmbeddedToolFallback } from './runners/EmbeddedToolFallback.js';
import { runPostProcessing } from './runners/PostProcessingRunner.js';

export async function completionRoutes(fastify: FastifyInstance) {
  const contentSafetyService = new ContentSafetyService(fastify);
  const modelRouter = getModelRouter(fastify.db);

  fastify.post('/completions', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          // Per-user rate limit using real IP behind Cloudflare Tunnel
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          const user = (request as any).user;
          return user?.id ? `user:${user.id}` : (request.headers['cf-connecting-ip'] as string) || request.ip;
        }
      }
    },
    schema: {
      description: 'Send message and get AI response (streaming)',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const parsedBody = completionSchema.parse(request.body);

      fastify.log.debug({ model: parsedBody.model, messageLength: parsedBody.message?.length || 0, userId: user.id, attachmentIds: parsedBody.attachmentIds || [] }, '[Chat] Request start');

      // ── Model Orchestrator: auto-routing ─────────────────────────
      // DEBT-81-D: delegated to AutoRoutingRunner
      let routingDecision: RoutingDecision | null = null;
      let routedModel = parsedBody.model;
      if (parsedBody.model === 'auto') {
        const autoResult = await runAutoRouting(fastify, modelRouter, {
          model: parsedBody.model,
          message: parsedBody.message,
          conversationId: parsedBody.conversationId,
          attachmentIds: parsedBody.attachmentIds,
          use_rag: parsedBody.use_rag,
          document_ids: parsedBody.document_ids,
          force_web_search: parsedBody.force_web_search,
          userId: user.id,
        }, reply);
        if (!autoResult) return; // 503 already sent
        routingDecision = autoResult.routingDecision;
        routedModel = autoResult.routedModel;
      }
      const body = { ...parsedBody, model: routedModel };

      // ── PERF-79-B3: force_short_output flag ──────────────────────────
      // When force_short_output=TRUE the routing tier requests compact answers.
      // Applied later (after ModelConfigService) to override maxOutputTokens and prepend prompt.
      const applyForceShortOutput = routingDecision?.forceShortOutput === true;
      if (applyForceShortOutput) {
        fastify.log.debug(`[Chat] PERF-79-B3: force_short_output active for model ${body.model}`);
      }

      // ── RAG mode guard + vLLM-first routing ──────────────────────
      // DEBT-81-D: delegated to RagGuard
      const ragGuardMode = body.chat_mode || (body.use_rag ? 'rag' : 'free');
      if (ragGuardMode === 'rag') {
        const ragResult = await applyRagGuard(fastify, reply, {
          ragGuardMode,
          originalModel: parsedBody.model,
          routedModel: body.model,
          userId: user.id,
        });
        if (ragResult.abort) return;
        if (ragResult.model !== body.model) body.model = ragResult.model;
      }

      fastify.log.info(`[Chat] Request for model: ${body.model}`);

      // Check if this is a Parlant agent
      const isParlantAgent = body.model.startsWith('parlant:');

      // ── Pre-flight model validation ──────────────────────────────
      // Reject unknown / disabled models BEFORE hitting the upstream
      // provider, so the user gets a useful error instead of a generic
      // "Modello AI non trovato" coming back from a provider 404.
      // Parlant agents have their own registry and are validated below.
      let preflightAvailableModels: string[] = [];
      if (!isParlantAgent) {
        const preflight = await validateChatModel(fastify.db, body.model);
        preflightAvailableModels = preflight.enabledChatModels;
        if (!preflight.ok) {
          fastify.log.warn(`[Chat] Pre-flight rejected model="${body.model}" (not registered or disabled)`);
          return reply.status(400).send({
            error: `Il modello \`${body.model}\` non è registrato o non è abilitato.`,
            supportedModels: preflightAvailableModels,
          });
        }
      }
      let provider;
      let providerName: string;

      if (isParlantAgent) {
        const agentId = body.model.split(':')[1];
        if (!agentId || agentId.trim() === '') {
          return reply.status(400).send({ error: 'Invalid Parlant model format', message: 'Expected format: parlant:{agentId}' });
        }
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
        fastify.log.info(`[Chat] Using ${providerName} provider for model: ${body.model}`);
        provider = AIProviderFactory.getProvider(body.model);
        fastify.log.debug(`[Chat] Provider instance created: ${provider?.name || 'NULL'}`);
      }

      // Check if model supports tools
      let supportsTools = false;
      if (!isParlantAgent) {
        try {
          const modelInfo = await findOne<{ supports_functions: number }>(fastify.db, 'SELECT supports_functions FROM ai_models WHERE model_id = ?', [body.model]);
          supportsTools = modelInfo?.supports_functions === 1;
          fastify.log.info(`[Chat] Model ${body.model} tool support: ${supportsTools}`);
        } catch (err) {
          fastify.log.warn(`[Chat] Failed to check model capabilities: ${err}`);
        }
      }

      // Prepare tool context
      let toolContext: ToolContext | null = null;
      if (supportsTools) {
        try {
          toolContext = await prepareToolContext(fastify, user.id);
        } catch (err) {
          fastify.log.warn(`[Chat] Failed to load or create tool context: ${err}`);
        }
      }

      // Load or create conversation
      let result;
      try {
        result = await loadOrCreateConversation(fastify, {
          userId: user.id, conversationId: body.conversationId,
          model: parsedBody.model, providerName,
          systemPrompt: body.systemPrompt, messageText: body.message,
          chatMode: body.chat_mode || (body.use_rag ? 'rag' : 'free'),
          documentIds: body.document_ids
        });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
        throw err;
      }
      let { conversationId, messages, conversation } = result;

      const hookCtx = Object.freeze({ userId: user.id, conversationId });

      // Content safety check
      let safetyResult: SafetyResult = { is_sensitive: false, topics: [], disclaimer: null, safety_flags: null };
      try { safetyResult = await contentSafetyService.checkMessage(body.message); }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      catch (safetyErr: any) { fastify.log.warn(`[AI-Act] Content safety check failed: ${safetyErr.message}`); }

      // Hook: fast_reply
      const fastReplyResult = await eventBus.pipe('fast_reply', null, hookCtx);
      if (fastReplyResult.short_circuited && fastReplyResult.data) {
        sendFastReply(reply, { conversationId, model: body.model, providerName, safetyResult, content: fastReplyResult.data });
        return;
      }

      // ── Edit-PDF intent short-circuit ──
      // If user asks to "modifica pdf" / "edit pdf" with a PDF attachment in the
      // current turn, return an open_pdf_editor event instead of streaming an LLM response.
      if (body.attachmentIds && body.attachmentIds.length > 0) {
        const { detectEditPdfIntent } = await import('../tools/onlyofficeService.js');
        if (detectEditPdfIntent(body.message)) {
          const pdfAttachmentRow = await findOne<{ id: number; original_name: string; mime_type: string }>(
            fastify.db,
            `SELECT id, original_name, mime_type FROM chat_attachments
             WHERE id IN (${body.attachmentIds.map(() => '?').join(',')}) AND user_id = ? AND mime_type = 'application/pdf'
             LIMIT 1`,
            [...body.attachmentIds, user.id],
          );
          if (pdfAttachmentRow) {
            fastify.log.info(`[Chat] Edit-PDF intent detected, opening editor for attachment ${pdfAttachmentRow.id}`);
            await insertOne(fastify.db,
              'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
              [conversationId, 'user', body.message]);
            const reply_text = `Apertura editor PDF per "${pdfAttachmentRow.original_name}". Modifica il documento e clicca "Salva" per persistere come bozza.`;
            await insertOne(fastify.db,
              'INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?)',
              [conversationId, 'assistant', reply_text, false, 'pdf-editor-intent', 'system']);
            await updateOne(fastify.db, 'UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);
            sendFastReply(reply, {
              conversationId,
              model: body.model,
              providerName,
              safetyResult,
              content: reply_text,
              extra: { open_pdf_editor: { attachmentId: pdfAttachmentRow.id, filename: pdfAttachmentRow.original_name } },
            });
            return;
          }
        }
      }

      // ── Direct format conversion short-circuit (bypass LLM entirely) ──
      if (body.attachmentIds && body.attachmentIds.length > 0) {
        const detectedFormat = detectDocumentFormat(body.message, body.attachmentIds);
        if (detectedFormat && (detectedFormat === 'docx' || detectedFormat === 'pdf')
          && isDirectConversionRequest(body.message, true)) {
          fastify.log.info(`[Chat] Direct conversion: "${body.message.substring(0, 80)}" -> ${detectedFormat}, bypassing LLM`);

          // Wait for attachment processing (up to 60s)
          for (let attempt = 0; attempt < 60; attempt++) {
            const att = await findOne<{ processing_status: string }>(fastify.db,
              'SELECT processing_status FROM chat_attachments WHERE id = ? AND user_id = ?',
              [body.attachmentIds[0], user.id]);
            if (!att || att.processing_status === 'completed' || att.processing_status === 'failed') break;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          const directResult = await directConvertAttachment(
            reply, fastify.db, user.id, body.attachmentIds, detectedFormat, body.message, fastify.log
          );

          if (directResult) {
            // Save user message
            await insertOne(fastify.db,
              'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
              [conversationId, 'user', body.message]);
            // Save conversion response (not AI-generated)
            await insertOne(fastify.db,
              'INSERT INTO messages (conversation_id, role, content, is_ai_generated, ai_model, ai_provider) VALUES (?, ?, ?, ?, ?, ?)',
              [conversationId, 'assistant', directResult, false, 'direct-conversion', 'system']);
            await updateOne(fastify.db, 'UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);

            sendFastReply(reply, { conversationId, model: body.model, providerName, safetyResult, content: directResult });
            return;
          }
          fastify.log.info(`[Chat] Direct conversion returned null, falling through to LLM`);
        }
      }

      // Process user message through hooks
      let userMessage = body.message;
      const msgHook = await eventBus.pipe('before_message_read', userMessage, hookCtx);
      userMessage = msgHook.data || userMessage;
      await eventBus.emit('after_message_read', { message: userMessage, userId: user.id, conversationId }, hookCtx);

      // Conversational Form injection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      let activeFormSession: any = null;
      try {
        if (conversationId) {
          activeFormSession = await injectFormContext(fastify, user.id, conversationId, userMessage, messages);
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (formErr: any) {
        fastify.log.warn(`[Form] Form check failed: ${formErr.message}`);
      }

      // Handle attachments
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      let nativeDocBlocks: any[] = [];
      if (body.attachmentIds && body.attachmentIds.length > 0) {
        const attachResult = await processAttachments(fastify, {
          attachmentIds: body.attachmentIds, userId: user.id,
          model: body.model, originalMessage: body.message, userMessage
        });
        nativeDocBlocks = attachResult.nativeDocBlocks;
        userMessage = attachResult.userMessage;
      }

      messages.push({ role: 'user', content: userMessage });
      await insertOne(fastify.db, 'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [conversationId, 'user', userMessage]);

      // ── RAG-only mode short circuit ──────────────────────────────────
      // When use_rag is true, skip web search / agent chain / tools and
      // inject a document-only system prompt before streaming.
      // Inject system prompts (coding, web search, tools, doc gen, memory)
      // Skip in RAG mode to avoid overwriting the constrained prompt.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      let recalledVectorMemories: { episodic: any[]; declarative: any[]; procedural: any[] } | null = null;
      let webSearchPerformed = false;
      let autoGenerateDoc: false | 'docx' | 'pptx' | 'xlsx' | 'pdf' = false;

      const effectiveChatMode = body.chat_mode
        || (body.use_rag ? 'rag' : undefined)
        || conversation?.chat_mode
        || 'free';

      if (effectiveChatMode === 'brainstorm') {
        fastify.log.info(`[Chat] Brainstorm mode active for user ${user.id}`);
        await injectBrainstormSystemPrompt(fastify, messages, user.id);

        // Detect document generation even in brainstorm mode so tool forcing works
        autoGenerateDoc = detectDocumentFormat(body.message, body.attachmentIds);
        if (autoGenerateDoc) {
          fastify.log.info(`[Chat] Brainstorm + DocGen detected: format=${autoGenerateDoc}`);
          const formatName = autoGenerateDoc === 'pptx' ? 'presentazione PowerPoint' :
            autoGenerateDoc === 'xlsx' ? 'foglio Excel' :
              autoGenerateDoc === 'pdf' ? 'PDF' : 'documento Word';
          const toolName = autoGenerateDoc === 'pptx' ? 'generate_powerpoint_document' :
            autoGenerateDoc === 'xlsx' ? 'generate_excel_document' :
              autoGenerateDoc === 'docx' ? 'generate_word_document' : null;

          let docGenPrompt: string;
          if (toolName && supportsTools) {
            docGenPrompt = `\n\n[ISTRUZIONI GENERAZIONE DOCUMENTO]\nHai a disposizione il tool "${toolName}". DEVI usarlo per generare il ${formatName}.\nREGOLA CRITICA: Usa SEMPRE il tool passando il contenuto come parametro "content".\n- NON scrivere il contenuto intero nella chat — usa DIRETTAMENTE il tool.\nSe per qualche motivo non riesci a usare il tool, scrivi il contenuto nella risposta come fallback.`;
          } else {
            docGenPrompt = `\n\n[ISTRUZIONI GENERAZIONE DOCUMENTO]\nL'utente vuole un ${formatName}. Scrivi il contenuto COMPLETO nella risposta.\nIl sistema genererà automaticamente il ${formatName} dalla tua risposta.\nNON suggerire codice o librerie esterne — scrivi DIRETTAMENTE il contenuto.`;
          }

          const systemIndex = messages.findIndex(m => m.role === 'system');
          if (systemIndex >= 0) {
            messages[systemIndex].content += docGenPrompt;
          } else {
            messages.unshift({ role: 'system', content: docGenPrompt });
          }
        }
      } else if (effectiveChatMode === 'rag') {
        fastify.log.info(`[Chat] RAG mode active for user ${user.id}`);
        const ragMemories = await injectRAGSystemPrompt(fastify, messages, {
          userMessage: body.message,
          userId: user.id,
          documentIds: body.document_ids,
        });

        // Map RAG results to declarative memory for display in MemoryPanel
        recalledVectorMemories = {
          episodic: [],
          declarative: ragMemories.map(r => ({
            id: r.id,
            content: r.content,
            score: r.score,
            metadata: r.metadata || {}
          })),
          procedural: []
        };
      } else {
        const injectResults = await injectSystemPrompts(fastify, messages, {
          model: body.model, userMessage: body.message, userId: user.id,
          supportsTools, toolContext, attachmentIds: body.attachmentIds,
          forceWebSearch: body.force_web_search,
        });
        webSearchPerformed = injectResults.webSearchPerformed;
        autoGenerateDoc = injectResults.autoGenerateDoc;

        // When web search was performed, show web sources instead of vector memories
        if (webSearchPerformed && injectResults.webSearchResults?.length) {
          fastify.log.info(`[Chat] Using ${injectResults.webSearchResults.length} web search results as sources instead of vector memories`);
          recalledVectorMemories = {
            episodic: [],
            declarative: injectResults.webSearchResults.map((r, idx) => ({
              id: idx + 1,
              content: r.snippet || r.title,
              score: 1 - (idx * 0.05), // Decreasing score by rank position
              metadata: { originalName: r.source || (() => { try { return new URL(r.url).hostname; } catch { return r.url || 'web'; } })(), url: r.url, title: r.title, type: 'web_search' },
            })),
            procedural: [],
          };
        }

        // Agent Chain: memory recall + prompt templates (skip memory recall when web search was used)
        try {
          const { AgentChainService } = await import('../../services/AgentChainService.js');
          const agentChain = new AgentChainService(fastify, fastify.db);
          const chainResult = await agentChain.execute({
            userId: user.id, conversationId, userMessage: body.message, messages, model: body.model, hookCtx,
          });
          if (chainResult.skippedByFastReply && chainResult.fastReplyContent) {
            sendFastReply(reply, { conversationId, model: body.model, providerName, safetyResult, content: chainResult.fastReplyContent });
            return;
          }
          messages = chainResult.messages;
          // Only use vector memories if web search did NOT provide sources
          if (!webSearchPerformed) {
            const totalRecalled = (chainResult.workingMemory.episodicMemories?.length || 0) + (chainResult.workingMemory.declarativeMemories?.length || 0) + (chainResult.workingMemory.proceduralMemories?.length || 0);
            if (totalRecalled > 0) {
              fastify.log.info(`[AgentChain] Injected ${totalRecalled} memory results via agent chain for user ${user.id}`);
              recalledVectorMemories = {
                episodic: chainResult.workingMemory.episodicMemories || [],
                declarative: chainResult.workingMemory.declarativeMemories || [],
                procedural: chainResult.workingMemory.proceduralMemories || [],
              };
            }
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (chainErr: any) {
          fastify.log.warn(`[AgentChain] Agent chain failed, continuing without: ${chainErr.message}`);
        }
      }

      ensureItalianSystemPrompt(messages);

      // ── Async document queue: intercept large requests ──────────────
      const estimatedTokens = estimateMessageTokens(messages);

      // C2: Reject documents exceeding the model's context limit
      if (estimatedTokens > MAX_TOKEN_LIMIT) {
        reply.hijack();
        writeSseHeaders(reply, { conversationId, webSearchPerformed: false, model: body.model, providerName });
        const sseWrite = createSseWriter(reply);
        sendInitialSseEvents(sseWrite, { model: body.model, providerName, safetyResult, recalledVectorMemories });
        sseWrite(`data: ${JSON.stringify({
          content: `Il documento è troppo lungo per essere elaborato (${estimatedTokens.toLocaleString('it-IT')} token stimati, limite ${MAX_TOKEN_LIMIT.toLocaleString('it-IT')}). Per favore, dividi il documento in sezioni più piccole (massimo ~200 pagine o ~50.000 parole ciascuna) e invia ogni sezione separatamente.`,
          done: true,
          conversationId,
        })}\n\n`);
        fastify.log.warn({ estimatedTokens, limit: MAX_TOKEN_LIMIT, userId: user.id }, '[Chat] Document exceeds MAX_TOKEN_LIMIT, rejected');
        return;
      }

      if (estimatedTokens > ASYNC_TOKEN_THRESHOLD) {
        // DEBT-81-D: delegated to AsyncQueueRunner
        const queueResult = await maybeDispatchToAsyncQueue(fastify, reply, {
          userId: user.id,
          conversationId,
          model: body.model,
          providerName,
          originalModel: parsedBody.model,
          estimatedTokens,
          messages,
          safetyResult,
          recalledVectorMemories,
        });
        if (queueResult.dispatched) return;
        body.model = queueResult.model;
        providerName = queueResult.providerName;
      }
      // ── End async queue check ────────────────────────────────────────

      // Set up SSE streaming
      reply.hijack();
      writeSseHeaders(reply, { conversationId, webSearchPerformed, model: body.model, providerName });
      const streamStartTime = Date.now();

      // SECURITY: Abort upstream LLM stream when client disconnects to prevent resource exhaustion
      const abortController = new AbortController();
      let clientDisconnected = false;
      request.raw.on('close', () => {
        clientDisconnected = true;
        abortController.abort();
      });

      let fullResponse = '';
      let toolDefs: ReturnType<typeof selectTools> | undefined;
      let costModel = body.model; // Tracks actual model used (may change on escalation)
      // CRITICAL-3: streamState is immutably updated via loopResult.state — never mutated in-place
      let streamState = createStreamState();
      // DEBT-82-D: final finish_reason for SSE done event (stop|length|tool_calls|content_filter|null)
      let finalFinishReason: string | null = null;
      const sseWrite = createSseWriter(reply);

      sendInitialSseEvents(sseWrite, { model: body.model, providerName, safetyResult, recalledVectorMemories });

      // Send routing decision to frontend if auto-routed
      if (routingDecision) {
        sseWrite(`data: ${JSON.stringify({ routing: { tier: routingDecision.tier, model: body.model, reason: routingDecision.reason, confidence: routingDecision.confidence, effort: routingDecision.effort }, done: false })}\n\n`);
      }

      // Hook: before_llm_call
      try {
        const modelConfig = await ModelConfigService.getConfig(fastify.db, body.model);
        const llmHookData = { messages, model: body.model, temperature: modelConfig.temperature, maxTokens: modelConfig.maxOutputTokens };
        const llmHookResult = await eventBus.pipe('before_llm_call', llmHookData, hookCtx);
        if (llmHookResult.data?.messages) messages = llmHookResult.data.messages;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (hookErr: any) { fastify.log.warn(`[Hook] before_llm_call failed: ${hookErr.message}`); }

      // DEBT-80-D: token components read from streamState after loop completes

      try {
        const modelConfig = await ModelConfigService.getConfig(fastify.db, body.model);
        toolDefs = toolContext ? selectTools(body.message) : undefined;
        const MAX_TOOL_ROUNDS = 5;

        const isAnthropic = providerName === 'anthropic';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const completionExtras: Record<string, any> = {};

        if (modelConfig.supportsThinking) {
          if (isAnthropic) {
            const isOpus = body.model.includes('opus');
            const maxOut = modelConfig.maxOutputTokens || 4096;
            // Adaptive thinking only for opus-4-5+ and opus-4-6+ models
            const supportsAdaptive = isOpus && (body.model.includes('opus-4-5') || body.model.includes('opus-4-6'));
            if (supportsAdaptive) {
              completionExtras.thinking = { type: 'adaptive' as const };
            } else if (isOpus) {
              // Older opus models (e.g. claude-opus-4-20250514) use budget-based thinking
              const budgetTokens = Math.min(16000, maxOut - 1024);
              if (budgetTokens >= 1024) completionExtras.thinking = { type: 'enabled' as const, budgetTokens };
            } else {
              const budgetTokens = Math.min(16000, maxOut - 1024);
              if (budgetTokens >= 1024) completionExtras.thinking = { type: 'enabled' as const, budgetTokens };
            }
          } else if (providerName === 'ollama') {
            // Ollama models use think: true flag — OllamaProvider reads options.thinking
            completionExtras.thinking = true;
          }
          // vLLM handles thinking natively via reasoning_content — no workarounds needed
        }

        if (isAnthropic) {
          completionExtras.cacheControl = modelConfig.supportsCaching;
          if (nativeDocBlocks.length > 0) completionExtras.documentBlocks = nativeDocBlocks;
        }

        // B1: Force tool usage when document generation is expected
        if (autoGenerateDoc && typeof autoGenerateDoc === 'string' && /^(docx|xlsx|pptx)$/i.test(autoGenerateDoc) && toolDefs && toolDefs.length > 0) {
           
          completionExtras.toolChoice = 'any';
           
          fastify.log.info(`[Chat] Forcing tool_choice=any for document generation (${autoGenerateDoc})`);
        }

        // PERF-79-B3: force_short_output override — applies AFTER modelConfig is loaded
        // so we override only the specific fields, not the entire config object.
        // DEBT-81-G: tier-level max_output_tokens cap (fast=512, balanced=1500, powerful=3000).
        // Takes minimum vs modelConfig to never exceed provider limit.
        const tierTokenCap = routingDecision?.maxOutputTokens ?? null;
        const baseMaxTokens = modelConfig.maxOutputTokens ?? 4096;
        const effectiveMaxTokens = applyForceShortOutput
            ? Math.min(baseMaxTokens, 512)
            : tierTokenCap !== null
              ? Math.min(baseMaxTokens, tierTokenCap)
              : baseMaxTokens;
        const effectiveTemperature = applyForceShortOutput ? 0 : modelConfig.temperature;
        if (applyForceShortOutput) {
          // Prepend concise-output instruction as first system message
          const conciseInstruction: Message = {
            role: 'system',
            content: 'You are a concise assistant. Answer in maximum 3 sentences unless the user explicitly asks for more.',
          };
          if (!messages.some(m => m.role === 'system' && m.content?.toString().includes('concise assistant'))) {
            messages = [conciseInstruction, ...messages];
          }
        }

        // DEBT-80-D: delegate stream+tool loop to ToolLoopRunner
        const toolLoopOpts: ToolLoopRunnerOptions = {
          maxRounds: MAX_TOOL_ROUNDS,
          toolContext,
          hookCtx,
          rawWrite: (ev) => reply.raw.write(ev),
          sseWrite,
          log: fastify.log,
          clientDisconnected: () => clientDisconnected,
          streamStartTime,
          state: streamState,
          buildStream: (msgs) => provider.streamComplete({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
            model: costModel, messages: msgs as any, maxTokens: effectiveMaxTokens,
            temperature: effectiveTemperature, stream: true, tools: toolDefs,
            signal: abortController.signal,
            ...completionExtras,
          }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const loopResult = await runToolLoop(messages as any, toolLoopOpts);
        fullResponse = loopResult.fullResponse;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        messages = loopResult.messages as any;
        // CRITICAL-3: reassign streamState from loopResult — immutable update, no mutation
        streamState = loopResult.state;
        // DEBT-82-D: capture finish_reason for SSE done event
        finalFinishReason = loopResult.finishReason ?? null;

        // Empty response recovery — HIGH-1: delegated to EscalationRunner
        if (fullResponse.trim().length === 0) {
          fastify.log.warn(`[Chat] Empty response from ${body.model}, attempting escalation to balanced tier`);
          const escResult = await runEmptyResponseEscalation({
            model: body.model,
            messages,
            toolDefs,
            abortSignal: abortController.signal,
            reply,
            sseWrite,
            log: fastify.log,
            db: fastify.db,
          });
          fullResponse = escResult.fullResponse;
          costModel = escResult.costModel;
          providerName = escResult.providerName;
        } else {
          recordProviderSuccess(body.model);
        }
        // Only estimate tokens if real usage wasn't provided by the stream
        // CRITICAL-3: immutable update — create new object instead of mutating streamState
        const estimatedInput = streamState.tokensInput === 0
          ? Math.ceil(messages.reduce((acc, m) => {
              const contentLen = typeof m.content === 'string' ? m.content.length : 0;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
              const toolCallsLen = (m as any).tool_calls ? JSON.stringify((m as any).tool_calls).length : 0;
              return acc + (contentLen + toolCallsLen) / 4;
            }, 0))
          : streamState.tokensInput;
        const estimatedOutput = streamState.tokensOutput === 0
          ? Math.ceil(fullResponse.length / 4)
          : streamState.tokensOutput;
        if (estimatedInput !== streamState.tokensInput || estimatedOutput !== streamState.tokensOutput) {
          streamState = { ...streamState, tokensInput: estimatedInput, tokensOutput: estimatedOutput };
        }

        // B2: Fallback — HIGH-1: delegated to EmbeddedToolFallback
        if (autoGenerateDoc && toolContext && fullResponse.length > 0) {
          const b2Result = await runEmbeddedToolFallback({
            fullResponse, toolContext, reply, log: fastify.log,
          });
          fullResponse = b2Result.fullResponse;
        }

        // Post-processing: document generation + code auto-save — HIGH-1: delegated to PostProcessingRunner
        const ppResult = await runPostProcessing({
          fullResponse, autoGenerateDoc, originalMessage: body.message,
          model: body.model, conversationId, reply, log: fastify.log,
        });
        fullResponse = ppResult.fullResponse;

      } catch (streamError: unknown) {
        // DEBT-81-D: delegated to FallbackChain runner
        const fbResult = await runFallbackChain(fastify, {
          error: streamError,
          model: body.model,
          providerName,
          isParlantAgent,
          preflightAvailableModels,
          messages,
          streamState,
          abortSignal: abortController.signal,
          reply,
          request,
        });
        if (fbResult.abort) return;
        fullResponse = fbResult.fullResponse;
        providerName = fbResult.providerName;
        // CRITICAL-3: immutable update
        streamState = {
          ...streamState,
          tokensInput: fbResult.tokensInput > 0 ? fbResult.tokensInput : streamState.tokensInput,
          tokensOutput: fbResult.tokensOutput > 0 ? fbResult.tokensOutput : streamState.tokensOutput,
        };
      }

            // Hook: after_llm_response
      try {
        const afterLlmResult = await eventBus.pipe('after_llm_response', fullResponse, hookCtx);
        if (afterLlmResult.data && typeof afterLlmResult.data === 'string') fullResponse = afterLlmResult.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (hookErr: any) { fastify.log.warn(`[Hook] after_llm_response failed: ${hookErr.message}`); }

      // Conversational Form: extract JSON from LLM response
      if (activeFormSession && activeFormSession.state !== 'closed') {
        try {
          const formService = new ConversationalFormService(fastify.db);
          const jsonMatch = fullResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || fullResponse.match(/(\{[\s\S]*?\})/);
          if (jsonMatch) {
            const extracted = JSON.parse(jsonMatch[1].trim());
            const formResult = await formService.updateWithExtraction(activeFormSession.id, extracted);
            fastify.log.info(`[Form] Updated session ${activeFormSession.id}: state=${formResult.state}, missing=${formResult.missing_fields.length}`);
            if (formResult.completed) {
              const completeNotice = `\n\n---\n**Form "${activeFormSession.form_name || 'form'}" completed.** Data collected successfully.`;
              reply.raw.write(`data: ${JSON.stringify({ content: completeNotice, done: false, formCompleted: true })}\n\n`);
              fullResponse += completeNotice;
              formService.executeCompleteAction(activeFormSession.form_id, formResult.collected_data, user.id)
                .then(r => { if (r.success) fastify.log.info(`[Form] on_complete_action executed: ${JSON.stringify(r.result)}`); else fastify.log.warn(`[Form] on_complete_action failed: ${r.error}`); })
                .catch(err => fastify.log.warn(`[Form] on_complete_action error: ${err.message}`));
            }
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (formErr: any) { fastify.log.warn(`[Form] Extraction from LLM response failed: ${formErr.message}`); }
      }

      // Hook: before_message_send
      try {
        const sendHookResult = await eventBus.pipe('before_message_send', fullResponse, hookCtx);
        if (sendHookResult.data && typeof sendHookResult.data === 'string') fullResponse = sendHookResult.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (hookErr: any) { fastify.log.warn(`[Hook] before_message_send failed: ${hookErr.message}`); }

      // DEBT-80-D: destructure token values from streamState for readability
      const { tokensInput, tokensOutput, cacheCreationTokens, cacheReadTokens, thinkingTokens, firstTokenMs } = streamState;

      // Save assistant message (use costModel which may be the escalated model)
      // OBS-77: Populate latency_ms, first_token_ms, provider columns
      const latencyMsTotal = Date.now() - streamStartTime;
      const assistantMsgId = await insertOne(fastify.db,
        'INSERT INTO messages (conversation_id, role, content, tokens_input, tokens_output, is_ai_generated, ai_model, ai_provider, latency_ms, first_token_ms, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [conversationId, 'assistant', fullResponse, tokensInput, tokensOutput, true, costModel, providerName, latencyMsTotal, firstTokenMs, providerName]);

      const cost = calculateCost(costModel, tokensInput, tokensOutput);

      const usageId = await recordUsageAndAudit(fastify, {
        userId: user.id, conversationId, providerName, model: costModel,
        tokensInput, tokensOutput, cost, cacheCreationTokens, cacheReadTokens, thinkingTokens,
        assistantMsgId, userMessage, fullResponse, streamStartTime, safetyResult
      });

      try {
        await recordTokenComponents(fastify, { usageId, conversationId, userId: user.id, messages, fullResponse, toolContext, toolDefs });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (compErr: any) { fastify.log.warn(`[Chat] Component token tracking failed: ${compErr.message}`); }

      await updateOne(fastify.db, 'UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);

      // Record routing decision (async, non-blocking)
      if (routingDecision) {
        const latencyMs = Date.now() - streamStartTime;
        modelRouter.recordDecision(routingDecision, {
          query: body.message, conversationLength: messages.length,
          hasAttachments: (body.attachmentIds?.length || 0) > 0,
          attachmentCount: body.attachmentIds?.length || 0,
          hasVisionAttachments: false, toolsRequested: !!toolDefs, userId: user.id,
        }, { latencyMs, tokensInput, tokensOutput, costUsd: cost, conversationId }).catch(err =>
          fastify.log.warn(`[Router] Failed to record routing decision: ${err.message}`)
        );
      }

      // Auto-capture memory (async, non-blocking)
      try {
        const memoryService = new MemoryService(fastify.db);
        memoryService.autoCapture(user.id, conversationId, userMessage, fullResponse).catch(err => fastify.log.warn(`[Memory] Auto-capture failed: ${err.message}`));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (memErr: any) { fastify.log.warn(`[Memory] Auto-capture init failed: ${memErr.message}`); }

      // Episodic vector memory store
      try {
        const memData = { userMessage: body.message, assistantResponse: fullResponse };
        const memHook = await eventBus.pipe('before_memory_store', memData, hookCtx);
        const finalMem = memHook.data || memData;
        storeEpisodic(fastify.db, user.id, conversationId, finalMem.userMessage, finalMem.assistantResponse).catch(err => fastify.log.warn(`[VectorMemory] Episodic store failed: ${err.message}`));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (memErr: any) { fastify.log.warn(`[VectorMemory] Store hook failed: ${memErr.message}`); }

      eventBus.emit('after_message_send', { userMessage: body.message, assistantResponse: fullResponse, model: body.model, provider: providerName, tokensInput, tokensOutput, cost }, hookCtx).catch(() => { });

      // DEBT-82-D: include finish_reason in the final SSE done event
      reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId, finish_reason: finalFinishReason })}\n\n`);
      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      throw err;
    }
  });
}
