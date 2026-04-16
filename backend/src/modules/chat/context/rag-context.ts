import { FastifyInstance } from 'fastify';
import { Message } from '../../ai/providers.js';
import { searchCollection } from '../../../services/VectorMemoryService.js';
import { findOne } from '../../../database/index.js';
import { isSummaryQuery, fetchDocumentChunksForSummary } from './summary-detection.js';

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
): Promise<any[]> {
  try {
    const summaryMode = isSummaryQuery(opts.userMessage);

    let results: { content: string; metadata: Record<string, any>; score?: number; id?: any; collection?: string }[];
    let contextBlock: string;

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
      const rawResults = await searchCollection(
        fastify.db,
        'declarative_memory',
        opts.userMessage,
        10,  // top-k
        0.25, // lower threshold to maximise recall in doc-only mode
        opts.userId
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
      results = filtered;

      if (filtered.length === 0) {
        contextBlock = '[Nessun contenuto rilevante trovato nei documenti caricati.]';
      } else {
        contextBlock = filtered
          .map((r, i) => `[Estratto ${i + 1}]\n${r.content}`)
          .join('\n\n---\n\n');
      }
    }

    // Use a different system prompt for summary vs specific queries
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
    return results;
  } catch (ragErr: any) {
    fastify.log.warn(`[RAG] System prompt injection failed: ${ragErr.message}`);
    return [];
  }
}
