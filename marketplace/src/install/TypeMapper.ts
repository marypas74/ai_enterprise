type MarketplaceType = 'skill' | 'agent' | 'mcp' | 'hook';
type TargetType = 'skill' | 'mcp_server' | 'hook_handler';

const TYPE_MAP: Readonly<Record<MarketplaceType, TargetType>> = {
  skill: 'skill',
  agent: 'skill',
  mcp: 'mcp_server',
  hook: 'hook_handler',
};

const CATEGORY_MAP: Readonly<Record<string, string>> = {
  'document-processing': 'technical',
  'database': 'technical',
  'devops-infrastructure': 'technical',
  'security': 'technical',
  'development-tools': 'coding',
  'programming-languages': 'coding',
  'ai-research': 'analysis',
  'data-ai': 'analysis',
  'deep-research-team': 'research',
  'enterprise-communication': 'communication',
  'creative-design': 'creative',
  'media': 'creative',
};

const APPROVAL_REQUIRED: ReadonlySet<MarketplaceType> = new Set(['mcp', 'hook']);

export function mapTargetType(type: MarketplaceType): TargetType {
  return TYPE_MAP[type];
}

export function mapCategory(marketplaceCategory: string): string {
  return CATEGORY_MAP[marketplaceCategory] ?? 'other';
}

export function requiresApproval(type: MarketplaceType): boolean {
  return APPROVAL_REQUIRED.has(type);
}
