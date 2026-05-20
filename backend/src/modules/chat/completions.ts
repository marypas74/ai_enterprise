import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, insertOne, updateOne } from '../../database/index.js';
import { calculateCost } from '../ai/providers.js';
import { selectTools } from '../../services/ToolSelectionService.js';
import { ConversationalFormService } from '../../services/ConversationalFormService.js';
import { ModelConfigService } from '../../services/ModelConfigService.js';
import { recordProviderSuccess } from '../../services/CircuitBreakerService.js';
import { ContentSafetyService } from '../compliance/contentSafety.js';
import { completionSchema } from './types.js';
import {
  createSseWriter, writeSseHeaders, sendInitialSseEvents, sendFastReply,
  recordTokenComponents, recordUsageAndAudit,
  isDirectConversionRequest, directConvertAttachment, detectDocumentFormat,
  writeSseDone, sendRagSourcesEvent,
} from './streaming.js';
import { loadOrCreateConversation } from './context-builder.js';
import { getModelRouter, type RoutingDecision } from '../../services/ModelRouter.js';
import { eventBus } from '../../services/EventBusService.js';
// DEBT-80-D: extracted runners
import { runToolLoop, type ToolLoopRunnerOptions } from './runners/ToolLoopRunner.js';
import { createStreamState } from './runners/ChatStreamRunner.js';
// DEBT-81-D: additional extracted runners
import { runAutoRouting } from './runners/AutoRoutingRunner.js';
import { applyRagGuard } from './runners/RagGuard.js';
import { runFallbackChain } from './runners/FallbackChain.js';
// HIGH-1: escalation + embedded tool fallback + post-processing extracted from completions.ts
import { runEmptyResponseEscalation } from './runners/EscalationRunner.js';
import { runEmbeddedToolFallback } from './runners/EmbeddedToolFallback.js';
import { runPostProcessing } from './runners/PostProcessingRunner.js';
// DEBT-83-G: new runners extracted from completions.ts
import { resolveRoutedModel } from './runners/RoutedModelResolver.js';
import { runSafetyAndContentInjection, checkContentSafety } from './runners/SafetyContentRunner.js';
import { runMemoryHooks } from './runners/MemoryHooksRunner.js';
// DEBT-84-A: new runners extracted from completions.ts (T5)
import { runEditPdfShortCircuit } from './runners/EditPdfShortCircuit.js';
import { runCompletionExtras } from './runners/CompletionExtras.js';
import { runAsyncTokenGuard } from './runners/AsyncTokenGuard.js';
import { buildCompletionExtras, applyForceShortOutputMessages } from './runners/CompletionExtrasBuilder.js';
// HOTFIX 2.1.86: Layer 2 — no-info detection + web retry
import { detectNoInfoResponse, buildWebSummary, triggerWebFallback } from './runners/RagWebFallback.js';

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

      // DEBT-83-G: pre-flight + provider resolution + tool context via RoutedModelResolver
      const resolverResult = await resolveRoutedModel(fastify, reply, { model: body.model, userId: user.id });
      if (resolverResult.abort) return;
      const { provider, isParlantAgent, supportsTools, toolContext, preflightAvailableModels } = resolverResult;
      let { providerName } = resolverResult;

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
      const { conversationId, conversation } = result;
      let { messages } = result;

      const hookCtx = Object.freeze({ userId: user.id, conversationId });

      // DEBT-83-G: content safety via SafetyContentRunner
      const safetyResult = await checkContentSafety(contentSafetyService, body.message, fastify.log);

      // Hook: fast_reply
      const fastReplyResult = await eventBus.pipe('fast_reply', null, hookCtx);
      if (fastReplyResult.short_circuited && fastReplyResult.data) {
        sendFastReply(reply, { conversationId, model: body.model, providerName, safetyResult, content: fastReplyResult.data });
        return;
      }

      // ── Edit-PDF intent short-circuit — DEBT-84-A: delegated to EditPdfShortCircuit ──
      {
        const pdfResult = await runEditPdfShortCircuit(fastify, {
          message: body.message, attachmentIds: body.attachmentIds, userId: user.id,
          conversationId, model: body.model, providerName, safetyResult, reply,
        });
        if (pdfResult.handled) return;
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

      // DEBT-84-A: hooks + form + attachments + message persist — delegated to CompletionExtras
      const extrasResult = await runCompletionExtras(fastify, {
        userId: user.id, conversationId, model: body.model, message: body.message,
        attachmentIds: body.attachmentIds, hookCtx, reply,
      }, messages);
      const { userMessage } = extrasResult;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const activeFormSession: any = extrasResult.activeFormSession;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const nativeDocBlocks: any[] = extrasResult.nativeDocBlocks;
      messages = extrasResult.messages;

      // DEBT-83-G: chat mode system prompt injection via SafetyContentRunner
      const contentResult = await runSafetyAndContentInjection(fastify, {
        model: body.model,
        userMessage,
        userId: user.id,
        conversationId,
        chatMode: body.chat_mode,
        useRag: body.use_rag,
        documentIds: body.document_ids,
        attachmentIds: body.attachmentIds,
        forceWebSearch: body.force_web_search,
        supportsTools,
        toolContext,
        providerName,
        safetyResult,
        conversation,
        hookCtx,
        reply,
      }, messages);
      if (contentResult.abort) return;
      messages = contentResult.messages;
      const { recalledVectorMemories, webSearchPerformed, autoGenerateDoc } = contentResult;

      // ── Async document queue + MAX_TOKEN_LIMIT — DEBT-84-A: delegated to AsyncTokenGuard ──
      {
        const guardResult = await runAsyncTokenGuard(fastify, {
          userId: user.id, conversationId, model: body.model, providerName,
          originalModel: parsedBody.model, messages, safetyResult,
          recalledVectorMemories, webSearchPerformed, reply,
        });
        if (guardResult.abort) return;
        body.model = guardResult.model;
        providerName = guardResult.providerName;
      }

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

      // T4 (v2.1.85): emit sources event for RAG mode (documents + web fallback attribution)
      sendRagSourcesEvent(sseWrite, { recalledVectorMemories });

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

        // DEBT-84-A: build completion extras via CompletionExtrasBuilder
        const extrasBuilt = buildCompletionExtras({
          model: body.model, providerName, modelConfig, nativeDocBlocks,
          autoGenerateDoc, toolDefs, applyForceShortOutput, routingDecision,
        });
        const { completionExtras, effectiveMaxTokens, effectiveTemperature } = extrasBuilt;
        if (autoGenerateDoc && completionExtras.toolChoice === 'any') {
          fastify.log.info(`[Chat] Forcing tool_choice=any for document generation (${autoGenerateDoc})`);
        }
        if (applyForceShortOutput) {
          messages = applyForceShortOutputMessages(messages);
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
        // CRITICAL-3: estimate tokens if real usage not provided; immutable update
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const estimatedInput = streamState.tokensInput || Math.ceil(messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0) / 4 + ((m as any).tool_calls ? JSON.stringify((m as any).tool_calls).length / 4 : 0), 0));
        const estimatedOutput = streamState.tokensOutput || Math.ceil(fullResponse.length / 4);
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

      // HOTFIX 2.1.86: Layer 2 — detect "no info" pattern, retry web automatic
      // Activated only when: no prior web sources AND web fallback enabled AND LLM admits no-info
      {
        const existingWebSources = (recalledVectorMemories?.declarative || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          .filter((r: any) => r.metadata?.type === 'web_search');
        const webFallbackEnabled = body.force_web_search !== true && existingWebSources.length === 0;
        if (webFallbackEnabled && detectNoInfoResponse(fullResponse)) {
          fastify.log.info('[Layer2] Detected "no info" pattern, triggering web fallback retry');
          try {
            const retryWeb = await triggerWebFallback(body.message, [], 5);
            if (retryWeb.webResults && retryWeb.webResults.length > 0) {
              // Stream integration header + summary inline
              const webSummary = buildWebSummary(retryWeb.webResults);
              const integrationBlock = '\n\n🌐 **Integrazione dal web:**\n\n' + webSummary;
              sseWrite(`data: ${JSON.stringify({ content: integrationBlock, done: false })}\n\n`);
              // Update fullResponse BEFORE DB save for consistency
              fullResponse = fullResponse + integrationBlock;
              // Emit second sources event (Layer 2 web results)
              const webMemories = {
                declarative: retryWeb.webResults.map((r) => ({
                  content: r.snippet,
                  metadata: { type: 'web_search', url: r.url, title: r.title },
                })),
              };
              sendRagSourcesEvent(sseWrite, { recalledVectorMemories: webMemories });
              fastify.log.info(`[Layer2] Added ${retryWeb.webResults.length} web results to response`);
            }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          } catch (l2Err: any) {
            fastify.log.warn(`[Layer2] Web retry failed: ${l2Err.message}`);
          }
        }
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

      // DEBT-83-G: post-stream memory + event hooks via MemoryHooksRunner
      runMemoryHooks(fastify, {
        userId: user.id,
        conversationId,
        userMessage: body.message,
        fullResponse,
        model: body.model,
        providerName,
        tokensInput,
        tokensOutput,
        cost,
        hookCtx,
      });

      // DEBT-82-D / DEBT-83-A: use writeSseDone for consistent SSE done structure with finish_reason
      writeSseDone(reply, { conversationId, finishReason: finalFinishReason });
      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      throw err;
    }
  });
}
