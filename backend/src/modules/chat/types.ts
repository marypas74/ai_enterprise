import { z } from 'zod';

// Validation schemas
export const completionSchema = z.object({
  conversationId: z.number().optional(),
  model: z.string().max(100),
  message: z.string().min(1).max(100000),
  systemPrompt: z.string().max(10000).optional(),
  attachmentIds: z.array(z.number()).optional(),
  use_rag: z.boolean().optional(),
  document_ids: z.array(z.number()).optional(),
  chat_mode: z.enum(['free', 'rag', 'brainstorm']).optional(),
});

export const agenticSchema = z.object({
  conversationId: z.number().optional(),
  projectId: z.number(),
  model: z.string().max(100),
  message: z.string().min(1).max(100000),
  systemPrompt: z.string().max(10000).optional(),
  enableTools: z.boolean().optional().default(true)
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
