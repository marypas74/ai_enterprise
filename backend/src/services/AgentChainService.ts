/**
 * Agent Chain Service — Multi-agent pipeline modeled after Cheshire Cat
 *
 * Pipeline:
 *   MainAgent.execute(context)
 *     ├─ hook: before_agent_starts     — edit agent input
 *     ├─ hook: agent_fast_reply        — short-circuit opportunity
 *     ├─ ProceduresAgent.execute()
 *     │   ├─ FormAgent: check active forms
 *     │   └─ If procedural memories recalled:
 *     │       ├─ hook: agent_allowed_tools  — filter tools
 *     │       ├─ Build tool selection prompt
 *     │       ├─ hook: agent_prompt_instructions — edit tool instructions
 *     │       └─ LLM Call #1: tool/form selection (JSON output)
 *     └─ MemoryAgent.execute()
 *         ├─ hook: agent_prompt_prefix  — edit personality
 *         ├─ hook: agent_prompt_suffix  — edit context
 *         └─ Build final system prompt with templates + memories
 *
 * The chain replaces the monolithic system prompt injection with a structured pipeline.
 */

import type { FastifyInstance } from 'fastify';
import type mysql from 'mysql2/promise';
import { eventBus, type HookContext } from './EventBusService.js';
import { WorkingMemoryService, type WorkingMemoryState, type AgentOutput } from './WorkingMemoryService.js';
import { PromptTemplateService, type TemplateContext } from './PromptTemplateService.js';
import { recall, getUserRecallSettings, type MemoryPoint } from './VectorMemoryService.js';
import { ConversationalFormService } from './ConversationalFormService.js';
import { ProceduralMemoryService } from './ProceduralMemoryService.js';
import type { Message } from '../modules/ai/providers.js';

export interface AgentChainInput {
  userId: number;
  conversationId: number;
  userMessage: string;
  messages: Message[];
  model: string;
  hookCtx: HookContext;
}

export interface AgentChainResult {
  messages: Message[];
  workingMemory: WorkingMemoryState;
  proceduresResult: {
    selectedAction: string | null;
    actionInput: string | null;
  } | null;
  skippedByFastReply: boolean;
  fastReplyContent: string | null;
}

export class AgentChainService {
  private wmService: WorkingMemoryService;
  private promptService: PromptTemplateService;
  private formService: ConversationalFormService;

  constructor(private fastify: FastifyInstance, private db: mysql.Pool) {
    this.wmService = new WorkingMemoryService(fastify);
    this.promptService = new PromptTemplateService(db);
    this.formService = new ConversationalFormService(db);
  }

  /**
   * Main entry point — runs the full agent chain
   */
  async execute(input: AgentChainInput): Promise<AgentChainResult> {
    const { userId, conversationId, userMessage, messages, hookCtx } = input;

    // Initialize working memory for this turn
    const wm = await this.wmService.initTurn(userId, conversationId);

    // ========== HOOK: before_agent_starts ==========
    const agentInput = { userMessage, messages, conversationId, userId };
    const beforeAgentResult = await eventBus.pipe('before_agent_starts', agentInput, hookCtx);
    const processedInput = beforeAgentResult.data || agentInput;

    // ========== HOOK: agent_fast_reply ==========
    const fastReplyResult = await eventBus.pipe('agent_fast_reply', null, hookCtx);
    if (fastReplyResult.short_circuited && fastReplyResult.data) {
      return {
        messages: processedInput.messages,
        workingMemory: wm,
        proceduresResult: null,
        skippedByFastReply: true,
        fastReplyContent: fastReplyResult.data,
      };
    }

    // ========== STEP 1: Memory Recall ==========
    const recallResults = await this.runMemoryRecall(userId, conversationId, processedInput.userMessage, hookCtx);
    await this.wmService.storeRecallResults(
      userId, conversationId, processedInput.userMessage,
      recallResults.episodic, recallResults.declarative, recallResults.procedural,
    );

    // ========== STEP 2: Procedures Agent ==========
    const proceduresResult = await this.runProceduresAgent(
      userId, conversationId, processedInput.userMessage, recallResults, hookCtx,
    );

    // Store agent output in working memory
    const agentOutput: AgentOutput = {
      proceduresResult: proceduresResult ? {
        selectedAction: proceduresResult.selectedAction,
        actionInput: proceduresResult.actionInput,
        toolOutput: null, // Will be filled after tool execution in the pipeline
      } : null,
      intermediateSteps: [],
      finalResponse: null,
    };
    await this.wmService.storeAgentOutput(userId, conversationId, agentOutput);

    // ========== STEP 3: Memory Agent — Build final system prompt ==========
    const finalMessages = await this.runMemoryAgent(
      userId, conversationId, processedInput.messages, recallResults, proceduresResult, hookCtx,
    );

    // Refresh working memory state
    const finalWm = await this.wmService.get(userId, conversationId) || wm;

    return {
      messages: finalMessages,
      workingMemory: finalWm,
      proceduresResult,
      skippedByFastReply: false,
      fastReplyContent: null,
    };
  }

  /**
   * Step 1: Memory Recall with hooks
   */
  private async runMemoryRecall(
    userId: number,
    _conversationId: number,
    userMessage: string,
    hookCtx: HookContext,
  ): Promise<{ episodic: MemoryPoint[]; declarative: MemoryPoint[]; procedural: MemoryPoint[] }> {
    const empty = { episodic: [], declarative: [], procedural: [] };

    try {
      const recallSettings = await getUserRecallSettings(this.db, userId);
      if (!recallSettings.autoRagEnabled) return empty;

      // Hook: cat_recall_query — edit the semantic search query
      const queryResult = await eventBus.pipe('cat_recall_query', userMessage, hookCtx);
      const recallQuery = queryResult.data || userMessage;

      // Hook: before_cat_recalls_memories
      await eventBus.emit('before_cat_recalls_memories', { query: recallQuery, userId }, hookCtx);

      // Hook: configure recall params per collection
      const episodicConfig = (await eventBus.pipe('before_cat_recalls_episodic_memories', {
        k: recallSettings.episodicK, threshold: recallSettings.episodicThreshold,
      }, hookCtx)).data;

      const declarativeConfig = (await eventBus.pipe('before_cat_recalls_declarative_memories', {
        k: recallSettings.declarativeK, threshold: recallSettings.declarativeThreshold,
      }, hookCtx)).data;

      const proceduralConfig = (await eventBus.pipe('before_cat_recalls_procedural_memories', {
        k: recallSettings.proceduralK, threshold: recallSettings.proceduralThreshold,
      }, hookCtx)).data;

      const recalled = await recall(this.db, {
        userId,
        query: recallQuery,
        episodicK: episodicConfig?.k ?? recallSettings.episodicK,
        episodicThreshold: episodicConfig?.threshold ?? recallSettings.episodicThreshold,
        declarativeK: declarativeConfig?.k ?? recallSettings.declarativeK,
        declarativeThreshold: declarativeConfig?.threshold ?? recallSettings.declarativeThreshold,
        proceduralK: proceduralConfig?.k ?? recallSettings.proceduralK,
        proceduralThreshold: proceduralConfig?.threshold ?? recallSettings.proceduralThreshold,
      });

      // Hook: after_cat_recalls_memories
      await eventBus.emit('after_cat_recalls_memories', recalled, hookCtx);

      return recalled;
    } catch (err: any) {
      this.fastify.log.warn(`[AgentChain] Memory recall failed: ${err.message}`);
      return empty;
    }
  }

  /**
   * Step 2: Procedures Agent — Form/tool detection
   * Returns tool selection if procedural memories matched, null otherwise
   */
  private async runProceduresAgent(
    userId: number,
    conversationId: number,
    userMessage: string,
    recallResults: { episodic: MemoryPoint[]; declarative: MemoryPoint[]; procedural: MemoryPoint[] },
    hookCtx: HookContext,
  ): Promise<{ selectedAction: string; actionInput: string | null } | null> {
    // Check for active form first
    try {
      const activeForm = await this.formService.getActiveSession(userId, conversationId);
      if (activeForm && activeForm.state !== 'closed') {
        await this.wmService.setActiveForm(userId, conversationId, activeForm.id);
        // Form agent doesn't do a separate LLM call — form handling is integrated in the chat pipeline
        return null;
      }
    } catch (err: any) {
      this.fastify.log.warn(`[AgentChain] Form check failed: ${err.message}`);
    }

    // If no procedural memories recalled, skip tool selection
    if (recallResults.procedural.length === 0) return null;

    // Hook: agent_allowed_tools — filter which tools reach the agent
    const toolsData = recallResults.procedural.map(p => ({
      name: p.metadata.name || 'unknown',
      description: p.content,
      type: p.metadata.type || 'tool',
      score: p.score,
    }));

    const filteredTools = (await eventBus.pipe('agent_allowed_tools', toolsData, hookCtx)).data || toolsData;
    if (filteredTools.length === 0) return null;

    this.fastify.log.info(`[AgentChain] ProceduresAgent found ${filteredTools.length} matching procedures: ${filteredTools.map((t: any) => t.name).join(', ')}`);

    // Use ProceduralMemoryService to build structured tool selection prompt
    const proceduralService = new ProceduralMemoryService(this.fastify, this.db);
    const toolSelectionPrompt = proceduralService.buildToolSelectionPrompt(
      recallResults.procedural, userMessage,
    );

    // Store the tool selection prompt in working memory for the Memory Agent to use
    if (toolSelectionPrompt) {
      await this.wmService.setCustomData(userId, conversationId, 'toolSelectionPrompt', toolSelectionPrompt);
    }

    // Return the best match as a suggestion (threshold-based, not auto-executing)
    const bestMatch = filteredTools[0];
    if (bestMatch.score >= 0.85) {
      return {
        selectedAction: bestMatch.name,
        actionInput: null,
      };
    }

    return null;
  }

  /**
   * Step 3: Memory Agent — Build final system prompt with templates + recalled context
   */
  private async runMemoryAgent(
    _userId: number,
    _conversationId: number,
    messages: Message[],
    recallResults: { episodic: MemoryPoint[]; declarative: MemoryPoint[]; procedural: MemoryPoint[] },
    proceduresResult: { selectedAction: string; actionInput: string | null } | null,
    hookCtx: HookContext,
  ): Promise<Message[]> {
    // Build context strings from recall results
    const episodicContext = recallResults.episodic.length > 0
      ? '## Relevant past conversations\n' + recallResults.episodic
          .map(m => `- (score ${m.score.toFixed(2)}) ${m.content.substring(0, 300)}`)
          .join('\n')
      : '';

    const declarativeContext = recallResults.declarative.length > 0
      ? '## Relevant knowledge\n' + recallResults.declarative
          .map(m => `- [${m.metadata.source || 'unknown'}] (score ${m.score.toFixed(2)}) ${m.content.substring(0, 400)}`)
          .join('\n')
      : '';

    const proceduralContext = recallResults.procedural.length > 0
      ? '## Available tools/procedures\n' + recallResults.procedural
          .map(m => `- ${m.metadata.name || 'tool'}: ${m.content.substring(0, 200)}`)
          .join('\n')
      : '';

    const toolOutput = proceduresResult
      ? `## Agent suggestion\nRecommended action: ${proceduresResult.selectedAction}`
      : '';

    // Build template context
    const templateCtx: TemplateContext = {
      episodicContext,
      declarativeContext,
      proceduralContext,
      toolOutput,
    };

    // Build system prompt from templates
    const prompt = await this.promptService.buildSystemPrompt(templateCtx);

    // Hook: agent_prompt_prefix — edit personality section
    const prefixResult = await eventBus.pipe('agent_prompt_prefix', prompt.prefix, hookCtx);
    const finalPrefix = prefixResult.data || prompt.prefix;

    // Hook: agent_prompt_suffix — edit context section
    const suffixResult = await eventBus.pipe('agent_prompt_suffix', prompt.suffix, hookCtx);
    const finalSuffix = suffixResult.data || prompt.suffix;

    // Hook: agent_prompt_instructions — edit instructions section
    const instructionsResult = await eventBus.pipe('agent_prompt_instructions', prompt.instructions, hookCtx);
    const finalInstructions = instructionsResult.data || prompt.instructions;

    // Assemble final system prompt
    const systemPrompt = [finalPrefix, finalSuffix, finalInstructions]
      .filter(s => s && s.trim())
      .join('\n\n');

    // Merge with existing messages
    const resultMessages = [...messages];
    if (systemPrompt) {
      const systemIndex = resultMessages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        // Prepend template prompt before existing system prompt
        resultMessages[systemIndex] = {
          ...resultMessages[systemIndex],
          content: systemPrompt + '\n\n' + resultMessages[systemIndex].content,
        };
      } else {
        resultMessages.unshift({ role: 'system', content: systemPrompt });
      }
    }

    return resultMessages;
  }
}
