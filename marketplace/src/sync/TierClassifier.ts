const TIER1_CATEGORIES: ReadonlySet<string> = new Set([
  'document-processing',
  'database',
  'security',
  'development-tools',
  'ai-research',
  'web-data',
  'browser_automation',
]);

const TIER2_CATEGORIES: ReadonlySet<string> = new Set([
  'deep-research-team',
  'data-ai',
  'enterprise-communication',
  'git-workflow',
  'monitoring',
]);

export function classifyTier(category: string): 'tier1' | 'tier2' | 'tier3' {
  if (TIER1_CATEGORIES.has(category)) {
    return 'tier1';
  }
  if (TIER2_CATEGORIES.has(category)) {
    return 'tier2';
  }
  return 'tier3';
}
