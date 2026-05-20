import { z } from 'zod';

// Validation schemas

// DEBT-80-C: completionSchema accepts both `force_web_search` (canonical) and
// `webSearch` (camelCase alias from frontend/SDK clients).
// z.preprocess maps `webSearch` → `force_web_search` before Zod validation.
// `force_web_search` always wins if both are present.
// The parsed output type is unchanged — `webSearch` is normalized away.
export const completionSchema = z.preprocess(
  (raw: unknown) => {
    if (raw !== null && typeof raw === 'object') {
      const input = raw as Record<string, unknown>;
      if ('webSearch' in input && !('force_web_search' in input)) {
        const { webSearch, ...rest } = input;
        return { ...rest, force_web_search: webSearch };
      }
    }
    return raw;
  },
  z.object({
    conversationId: z.number().optional(),
    model: z.string().max(100),
    message: z.string().min(1).max(100000),
    systemPrompt: z.string().max(10000).optional(),
    attachmentIds: z.array(z.number()).optional(),
    use_rag: z.boolean().optional(),
    document_ids: z.array(z.number()).optional(),
    chat_mode: z.enum(['free', 'rag', 'brainstorm']).optional(),
    force_web_search: z.boolean().optional(),
    maxInferenceMs: z.number().int().positive().optional(),
  }),
);

export const agenticSchema = z.object({
  conversationId: z.number().optional(),
  projectId: z.number(),
  model: z.string().max(100),
  message: z.string().min(1).max(100000),
  systemPrompt: z.string().max(10000).optional(),
  enableTools: z.boolean().optional().default(true),
  maxInferenceMs: z.number().int().positive().optional(),
});

// Types
export interface Conversation {
  id: number;
  user_id: number;
  title: string;
  model: string;
  provider: string;
  system_prompt: string;
  is_archived: boolean;
  chat_mode: 'free' | 'rag' | 'brainstorm';
  document_ids: number[] | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbMessage {
  id: number;
  conversation_id: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  tokens_input: number;
  tokens_output: number;
  created_at: Date;
}

export interface NativeDocBlock {
  type: 'document';
  source: { type: 'base64'; media_type: string; data: string };
  title?: string;
  citations?: { enabled: boolean };
  cache_control?: { type: 'ephemeral' };
}

export interface SafetyResult {
  is_sensitive: boolean;
  topics: string[];
  disclaimer: string | null;
  safety_flags: Record<string, boolean> | null;
}

export type { ToolContext } from '../../types/index.js';
