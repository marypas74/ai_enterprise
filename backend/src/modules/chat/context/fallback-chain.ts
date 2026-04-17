/**
 * Fallback model chain map and logic for retriable errors.
 */
export const FALLBACK_MAP: Record<string, string[]> = {
  // vLLM — fallback to OpenAI then Anthropic
  'qwen25vl:32b': ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4-20250514'],
  // OpenAI
  'gpt-4o': ['gpt-4o-mini', 'gemini-2.0-flash'],
  'gpt-4-turbo': ['gpt-4o-mini', 'gemini-2.0-flash'],
  'gpt-4.1': ['gpt-4.1-mini', 'claude-sonnet-4-20250514'],
  'gpt-4.1-mini': ['gpt-4.1-nano', 'gemini-2.0-flash'],
  // Anthropic
  'claude-opus-4-6': ['claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'gpt-4o'],
  'claude-opus-4-20250514': ['claude-sonnet-4-20250514', 'gpt-4o'],
  'claude-sonnet-4-6': ['claude-sonnet-4-20250514', 'gpt-4o-mini'],
  'claude-sonnet-4-20250514': ['claude-haiku-4-5-20251001', 'gpt-4o-mini'],
  // Google
  'gemini-1.5-pro': ['gemini-2.0-flash', 'gpt-4o-mini'],
  'gemini-2.0-flash-thinking': ['gemini-2.0-flash'],
};

/**
 * Check if an error is retriable for the fallback chain.
 */
export function isRetriableError(errorMessage: string): boolean {
  return errorMessage.includes('timeout')
    || errorMessage.includes('ECONNREFUSED')
    || errorMessage.includes('fetch failed')
    || errorMessage.includes('400')
    || errorMessage.includes('500')
    || errorMessage.includes('502')
    || errorMessage.includes('503')
    || errorMessage.includes('Bad Gateway')
    || errorMessage.includes('overloaded')
    || errorMessage.includes('tool choice requires');
}
