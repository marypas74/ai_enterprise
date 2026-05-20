import { FastifyInstance } from 'fastify';
import { Message } from '../../ai/providers.js';
import { searchCollection } from '../../../services/VectorMemoryService.js';
import { findOne } from '../../../database/index.js';
import { isSummaryQuery, fetchDocumentChunksForSummary } from './summary-detection.js';
import { evaluateRagSufficiency, triggerWebFallback, buildAttributionContext } from '../runners/RagWebFallback.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RagWebResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
export interface RagInjectionResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  readonly chunks: any[];
  readonly webResults: RagWebResult[];
}

/**
 * Inject the user's guardrail/roadmap policy into the system prompt.
 * Called from ALL chat modes (free, RAG, brainstorm) to ensure AI ACT EU compliance.
 */
export async function injectGuardrailPolicy(
  fastify: FastifyInstance,
  messages: Message[],
  userId: number
): Promise<boolean> {
  const userPolicyResult = await findOne<{ guardrail_policy: string | null }>(
    fastify.db,
    'SELECT guardrail_policy FROM users WHERE id = ?',
    [userId]
  );

  if (userPolicyResult?.guardrail_policy) {
    const policyPrompt = `\n\n[USER GUARDRAIL POLICY]
You must strictly enforce the following policy defined by the user. If this policy requires data obfuscation or redaction (for instance, hiding names of people, companies, or industrial machinery), you must redact the output accordingly BEFORE showing it:

${userPolicyResult.guardrail_policy}`;

    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      messages[systemIndex].content += policyPrompt;
    } else {
      messages.unshift({ role: 'system', content: policyPrompt });
    }

    fastify.log.info(`[Chat] Injected User Guardrail/Roadmap Policy for user ${userId}`);
    return true;
  }
  return false;
}

/**
 * Inject RAG-only system prompt, constraining AI strictly to document context.
 * Performs semantic search on declarative_memory filtered by user (optionally by document IDs).
 */
export async function injectRAGSystemPrompt(
  fastify: FastifyInstance,
  messages: Message[],
  opts: {
    userMessage: string;
    userId: number;
    documentIds?: number[];
  }
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
): Promise<RagInjectionResult> {
  try {
    const summaryMode = isSummaryQuery(opts.userMessage);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    let results: { content: string; metadata: Record<string, any>; score?: number; id?: any; collection?: string }[];
    let contextBlock: string;
    let webFallbackResults: RagWebResult[] = [];

    if (summaryMode) {
      // -- Summary mode: fetch distributed chunks covering the entire document --
      fastify.log.info(`[RAG] Summary intent detected for user ${opts.userId}, fetching full document coverage`);
      const chunks = await fetchDocumentChunksForSummary(opts.userId, opts.documentIds, 40);
      results = chunks.map((c, i) => ({ ...c, score: 1, id: i, collection: 'declarative_memory' as const }));

      if (chunks.length === 0) {
        contextBlock = '[Nessun contenuto rilevante trovato nei documenti caricati.]';
      } else {
        contextBlock = chunks
          .map((c, i) => `[Sezione ${i + 1}/${chunks.length}]\n${c.content}`)
          .join('\n\n---\n\n');
      }
    } else {
      // -- Specific query mode: semantic search as before --
      // Read score threshold from system_settings (default 0.35). The DB value overrides the
      // previous hardcoded 0.25 — we keep the search threshold slightly lower (0.20) to maximise
      // recall, and apply the configurable threshold only when evaluating fallback necessity.
      const thresholdRow = await findOne<{ setting_value: string }>(
        fastify.db,
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        ['rag_score_threshold']
      );
      const ragScoreThreshold = thresholdRow ? parseFloat(thresholdRow.setting_value) : 0.35;

      const rawResults = await searchCollection(
        fastify.db,
        'declarative_memory',
        opts.userMessage,
        10,  // top-k
        0.20, // lower threshold for retrieval recall; fallback logic uses ragScoreThreshold
        opts.userId
      );

      // [RAG-DIAG] log dimensione/forma del payload PRIMA del filter
      const sampleMeta = rawResults[0]?.metadata || null;
      fastify.log.info(
        `[RAG-DIAG] searchCollection: rawCount=${rawResults.length}, ` +
        `documentIds=${JSON.stringify(opts.documentIds)}, ` +
        `sample_keys=${sampleMeta ? JSON.stringify(Object.keys(sampleMeta)) : 'none'}, ` +
        `sample_attachment_id=${sampleMeta?.attachment_id ?? 'N/A'}, ` +
        `sample_user_id=${sampleMeta?.user_id ?? 'N/A'}`
      );

      // Filter by document_ids if specified
      // NOTE: VectorMemoryService.searchCollection returns metadata: hit.payload (the full Qdrant
      // payload). VectorStoreService indexes chunks with 'attachment_id' as the top-level payload
      // field (not 'document_id'). documentIds passed here are attachment IDs.
      let filtered = rawResults;
      if (opts.documentIds && opts.documentIds.length > 0) {
        filtered = rawResults.filter(r => {
          const meta = r.metadata || {};
          const docId = meta.attachment_id;
          return docId !== undefined && opts.documentIds!.includes(Number(docId));
        });
      }

      // [RAG-DIAG] mismatch detection: rawResults>0 ma filtered=0 => ID mismatch
      if (opts.documentIds?.length && filtered.length === 0 && rawResults.length > 0) {
        const payloadAttachmentIds = rawResults
          .map(r => r.metadata?.attachment_id)
          .filter((v): v is number | string => v !== undefined && v !== null);
        fastify.log.warn(
          `[RAG-DIAG] FILTER MISMATCH: ${rawResults.length} rawResults but 0 after filter. ` +
          `Payload attachment_ids=${JSON.stringify(payloadAttachmentIds)} ` +
          `vs requested documentIds=${JSON.stringify(opts.documentIds)}`
        );
      }

      results = filtered;

      // \u2500\u2500 RAG Web Fallback (v2.1.85) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      // Check if RAG context is sufficient; if not, augment with web search.
      let usingWebFallback = false;

      const { sufficient: ragSufficient } = evaluateRagSufficiency(filtered, ragScoreThreshold);

      if (!ragSufficient && !summaryMode) {
        // Read fallback settings from DB
        const [fallbackEnabledRow, maxResultsRow] = await Promise.all([
          findOne<{ setting_value: string }>(
            fastify.db,
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            ['rag_web_fallback_enabled']
          ),
          findOne<{ setting_value: string }>(
            fastify.db,
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            ['rag_web_max_results']
          ),
        ]);

        const fallbackEnabled = (fallbackEnabledRow?.setting_value ?? 'true') === 'true';
        const maxWebResults = maxResultsRow ? parseInt(maxResultsRow.setting_value, 10) : 5;

        if (fallbackEnabled) {
          fastify.log.info(
            `[RAG-Fallback] Insufficient RAG context (${filtered.length} chunks, threshold=${ragScoreThreshold}), triggering web search for user ${opts.userId}`
          );

          // Trigger web search in parallel with building the partial RAG context
          const fallbackData = await triggerWebFallback(opts.userMessage, filtered, maxWebResults);
          webFallbackResults = [...fallbackData.webResults];
          usingWebFallback = webFallbackResults.length > 0;

          if (usingWebFallback) {
            fastify.log.info(
              `[RAG-Fallback] Web search returned ${webFallbackResults.length} results for user ${opts.userId}`
            );
          }
        }
      }

      // Build context block \u2014 use combined attribution context if web fallback is active
      if (usingWebFallback) {
        contextBlock = buildAttributionContext(filtered, webFallbackResults);
      } else if (filtered.length === 0) {
        contextBlock = '[Nessun contenuto rilevante trovato nei documenti caricati.]';
      } else {
        contextBlock = filtered
          .map((r, i) => `[Estratto ${i + 1}]\n${r.content}`)
          .join('\n\n---\n\n');
      }
    }

    // Use a different system prompt for summary vs specific queries
    const isWebAugmented = typeof contextBlock === 'string' && contextBlock.includes('[WEB');
    const ragSystemPrompt = summaryMode
      ? `[MODALIT\u00c0 DOCUMENTI \u2014 RIASSUNTO]
Hai ricevuto sezioni distribuite dall'intero documento dell'utente (campionate uniformemente per coprire tutto il contenuto).
Il tuo compito \u00e8 produrre un riassunto completo e strutturato del documento basandoti sulle sezioni fornite.
Organizza il riassunto con titoli e punti chiave. Copri tutti gli argomenti principali presenti nelle sezioni.
Non inventare informazioni non presenti nelle sezioni.

--- CONTENUTO DEL DOCUMENTO (${results.length} sezioni) ---
${contextBlock}
--- FINE CONTENUTO ---

IMPORTANT: Rispondi SEMPRE in italiano.`
      : isWebAugmented
      ? `[MODALIT\u00c0 DOCUMENTI + RICERCA WEB ATTIVA]
I documenti dell'utente non contenevano informazioni sufficienti per questa domanda.
Hai a disposizione sia estratti dai documenti (marcati [DOCUMENTO N]) sia risultati di ricerca web (marcati [WEB N]).
Usa entrambe le fonti per rispondere in modo completo. Cita esplicitamente le fonti utilizzate.
Non inventare informazioni. Per informazioni non trovate n\u00e9 nei documenti n\u00e9 sul web, dillo chiaramente.

${contextBlock}

IMPORTANT: Rispondi SEMPRE in italiano.`
      : `[MODALIT\u00c0 DOCUMENTI ATTIVA]
Rispondi ESCLUSIVAMENTE usando il contesto estratto dai documenti dell'utente qui sotto.
Se l'informazione richiesta non \u00e8 presente nel contesto, rispondi esattamente con:
"Non trovo questa informazione nei documenti."
Non inventare informazioni. Non attingere a conoscenze esterne.

--- CONTESTO DAI DOCUMENTI ---
${contextBlock}
--- FINE CONTESTO ---

IMPORTANT: Rispondi SEMPRE in italiano.`;

    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      messages[systemIndex].content = ragSystemPrompt + '\n\n' + messages[systemIndex].content;
    } else {
      messages.unshift({ role: 'system', content: ragSystemPrompt });
    }

    // Inject guardrail policy AFTER RAG context (applies to all modes for AI ACT compliance)
    await injectGuardrailPolicy(fastify, messages, opts.userId);

    fastify.log.info(`[RAG] Injected ${results.length} chunks (${summaryMode ? 'summary' : 'specific'} mode) into system prompt for user ${opts.userId}`);
    return { chunks: results, webResults: webFallbackResults };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (ragErr: any) {
    fastify.log.warn(`[RAG] System prompt injection failed: ${ragErr.message}`);
    return { chunks: [], webResults: [] };
  }
}
