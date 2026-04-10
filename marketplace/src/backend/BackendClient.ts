import { generateServiceToken } from '../auth/serviceToken.js';
import { config } from '../config.js';
import { mapCategory } from '../install/TypeMapper.js';

interface CatalogItem {
  readonly name: string;
  readonly display_name: string | null;
  readonly description: string | null;
  readonly category: string | null;
  readonly metadata: string | null;
}

interface CreateSkillPayload {
  readonly name: string;
  readonly display_name: string;
  readonly description: string;
  readonly category: string;
  readonly system_prompt?: string;
  readonly is_default: boolean;
  readonly is_active: boolean;
}

function buildSystemPrompt(item: CatalogItem, meta: Record<string, unknown>): string | undefined {
  if (typeof meta.system_prompt === 'string' && meta.system_prompt.length > 0) {
    return meta.system_prompt;
  }
  // Auto-generate system prompt from description when catalog doesn't provide one
  if (item.description) {
    const displayName = item.display_name ?? item.name;
    return `Sei un assistente AI specializzato: ${displayName}. ${item.description} Usa queste competenze per fornire risposte precise e pertinenti.`;
  }
  return undefined;
}

function buildSkillPayload(item: CatalogItem): CreateSkillPayload {
  const parsedMeta = parseMetadata(item.metadata);
  const systemPrompt = buildSystemPrompt(item, parsedMeta);
  const payload: CreateSkillPayload = {
    name: item.name,
    display_name: item.display_name ?? item.name,
    description: item.description ?? '',
    category: mapCategory(item.category ?? ''),
    is_default: true,
    is_active: true,
  };
  if (systemPrompt) {
    return { ...payload, system_prompt: systemPrompt };
  }
  return payload;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getAuthHeaders(): Record<string, string> {
  const token = generateServiceToken(config.jwtSecret);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function createSkillInBackend(item: CatalogItem): Promise<number> {
  const payload = buildSkillPayload(item);
  const response = await fetch(`${config.backendUrl}/api/skills`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Backend skill creation failed (${response.status}): ${errorBody}`,
    );
  }

  const body = (await response.json()) as { id?: number; data?: { id?: number } };
  const skillId = body.data?.id ?? body.id;
  if (skillId == null) {
    throw new Error('Backend returned success but no skill ID');
  }
  return skillId;
}

export async function deleteSkillInBackend(targetId: number): Promise<void> {
  const token = generateServiceToken(config.jwtSecret);
  const response = await fetch(`${config.backendUrl}/api/skills/${targetId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Backend skill deletion failed (${response.status}): ${errorBody}`,
    );
  }
}
