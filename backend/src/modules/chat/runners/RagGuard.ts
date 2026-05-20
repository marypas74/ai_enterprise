/**
 * RagGuard — RAG mode data privacy enforcement.
 *
 * DEBT-81-D: Extracted from completions.ts as part of the T4 refactor.
 *
 * Enforces the policy that non-admin users may only use local inference models
 * in RAG/document mode (to keep document data on-premise).
 *
 * Also handles the RAG auto-routing priority:
 *   vLLM (fastest local) → ollama/custom → external API (fallback only)
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { findOne } from '../../../database/index.js';

export const LOCAL_PROVIDER_TYPES = new Set(['ollama', 'vllm', 'custom']);

export interface RagGuardOptions {
  readonly ragGuardMode: string;
  readonly originalModel: string; // parsedBody.model (before auto-routing)
  readonly routedModel: string;   // body.model (after auto-routing)
  readonly userId: number;
}

export interface RagGuardResult {
  /** Possibly updated model (RAG auto-route may override to vLLM/local). */
  readonly model: string;
  /** True if the caller should abort (error reply already sent). */
  readonly abort: boolean;
}

/**
 * Enforces RAG mode guard for non-admin users and applies vLLM-first routing
 * when the original model was 'auto'.
 *
 * Returns { model, abort: false } with possibly updated model, or
 * { model: '', abort: true } if a 403 was sent.
 */
export async function applyRagGuard(
  fastify: FastifyInstance,
  reply: FastifyReply,
  opts: RagGuardOptions,
): Promise<RagGuardResult> {
  const { ragGuardMode, originalModel, routedModel, userId } = opts;

  // ── RAG mode guard: non-admin users must use local models ──────────────
  if (ragGuardMode === 'rag' && originalModel !== 'auto') {
    const userInfo = await findOne<{ role: string }>(fastify.db, 'SELECT role FROM users WHERE id = ?', [userId]);
    const isAdmin = userInfo?.role === 'admin';

    const modelProvider = await findOne<{ provider_type: string }>(fastify.db,
      `SELECT p.provider_type FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id WHERE m.model_id = ?`,
      [routedModel]);
    const isLocalModel = modelProvider ? LOCAL_PROVIDER_TYPES.has(modelProvider.provider_type) : false;

    if (!isLocalModel && !isAdmin) {
      reply.status(403).send({
        error: 'Modello esterno non consentito in modalità documenti',
        message: 'Per la protezione dei dati, la modalità documenti utilizza solo modelli locali. Contatta un amministratore per abilitare modelli esterni.',
      });
      return { model: '', abort: true };
    }
  }

  // ── RAG auto-routing: prioritize vLLM → local → external API ──────────
  if (ragGuardMode === 'rag' && originalModel === 'auto') {
    // 1. Try vLLM first
    const vllmModel = await findOne<{ model_id: string }>(fastify.db,
      `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
         AND p.provider_type = 'vllm'
       ORDER BY m.sort_order ASC LIMIT 1`);
    if (vllmModel) {
      fastify.log.info(`[Chat] RAG mode: routed to vLLM model ${vllmModel.model_id}`);
      return { model: vllmModel.model_id, abort: false };
    }

    // 2. Fall back to other local models (ollama, custom)
    const localModel = await findOne<{ model_id: string }>(fastify.db,
      `SELECT m.model_id FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
         AND p.provider_type IN ('ollama','custom')
       ORDER BY m.sort_order ASC LIMIT 1`);
    if (localModel) {
      fastify.log.info(`[Chat] RAG mode: no vLLM available, routed to local model ${localModel.model_id}`);
      return { model: localModel.model_id, abort: false };
    }

    // 3. No local models — keep current model (external API fallback, warn)
    fastify.log.warn(`[Chat] RAG mode: no local models available, falling back to external model ${routedModel}`);
  }

  return { model: routedModel, abort: false };
}
