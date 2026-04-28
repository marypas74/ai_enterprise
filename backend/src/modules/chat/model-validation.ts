import type { Pool } from 'mysql2/promise';
import { findOne, findMany } from '../../database/index.js';

/**
 * Outcome of the chat pre-flight model validation.
 *
 * `enabledChatModels` is the list of `model_id`s whose owning provider is
 * also enabled and whose `model_type` is `chat` or `completion`. It is
 * always populated (best-effort) so the caller can return it both in the
 * 400 error response and in the context-aware streaming error message
 * when the provider later returns a 404.
 */
export interface ModelPreflightResult {
  ok: boolean;
  providerType: string | null;
  enabledChatModels: string[];
}

const CHAT_MODEL_TYPES = ['chat', 'completion'];

/**
 * Validates that `modelId` is registered in `ai_models`, that the row is
 * enabled, and that the owning provider is enabled. Returns the list of
 * usable chat models (best-effort, capped) so callers can surface helpful
 * error messages without re-querying.
 *
 * Does NOT contact the upstream provider — that check belongs to the
 * admin "verify" endpoint (separate user story).
 */
export async function validateChatModel(
  db: Pool,
  modelId: string,
): Promise<ModelPreflightResult> {
  const enabledChatModels = await loadEnabledChatModels(db);
  const row = await findOne<{ provider_type: string; is_enabled: number; provider_enabled: number; model_type: string }>(
    db,
    `SELECT p.provider_type AS provider_type,
            m.is_enabled    AS is_enabled,
            p.is_enabled    AS provider_enabled,
            m.model_type    AS model_type
       FROM ai_models m
       JOIN ai_providers p ON p.id = m.provider_id
      WHERE m.model_id = ?
      LIMIT 1`,
    [modelId],
  );
  if (!row) {
    return { ok: false, providerType: null, enabledChatModels };
  }
  const enabled = Number(row.is_enabled) === 1 && Number(row.provider_enabled) === 1;
  const isChat = CHAT_MODEL_TYPES.includes(row.model_type);
  return {
    ok: enabled && isChat,
    providerType: row.provider_type,
    enabledChatModels,
  };
}

async function loadEnabledChatModels(db: Pool): Promise<string[]> {
  try {
    const rows = await findMany<{ model_id: string }>(
      db,
      `SELECT m.model_id
         FROM ai_models m
         JOIN ai_providers p ON p.id = m.provider_id
        WHERE m.is_enabled = TRUE
          AND p.is_enabled = TRUE
          AND m.model_type IN ('chat', 'completion')
        ORDER BY m.sort_order ASC
        LIMIT 100`,
    );
    return rows.map(r => r.model_id);
  } catch {
    return [];
  }
}
