import { classifyTier } from './TierClassifier.js';

export interface CatalogItemInput {
  source_id: string;
  type: 'skill' | 'agent' | 'mcp' | 'hook';
  tier: 'tier1' | 'tier2' | 'tier3';
  name: string;
  display_name: string;
  description: string;
  category: string;
  metadata: Record<string, unknown>;
  version: string;
}

const MAX_DESCRIPTION_LENGTH = 2000;

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

function sanitizeDescription(raw: string): string {
  const stripped = stripHtmlTags(raw);
  return stripped.length > MAX_DESCRIPTION_LENGTH
    ? stripped.slice(0, MAX_DESCRIPTION_LENGTH)
    : stripped;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  return typeof val === 'string' ? val : '';
}

export function parseCatalogItem(
  raw: unknown,
  type: 'skill' | 'agent' | 'mcp' | 'hook',
): CatalogItemInput {
  const obj = raw !== null && typeof raw === 'object'
    ? (raw as Record<string, unknown>)
    : {} as Record<string, unknown>;

  const name = getString(obj, 'name');
  const category = getString(obj, 'category');

  return {
    source_id: `${type}:${name}`,
    type,
    tier: classifyTier(category),
    name,
    display_name: getString(obj, 'display_name'),
    description: sanitizeDescription(getString(obj, 'description')),
    category,
    metadata: toRecord(obj['metadata']),
    version: getString(obj, 'version'),
  };
}

export function parseRawCatalog(
  rawItems: unknown[],
  type: 'skill' | 'agent' | 'mcp' | 'hook',
): CatalogItemInput[] {
  return rawItems.map((item) => parseCatalogItem(item, type));
}
