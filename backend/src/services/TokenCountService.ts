/**
 * TokenCountService — Pre-send token estimation
 * Uses Anthropic count_tokens API (free) or char-based estimation for others.
 */

export interface TokenCountResult {
  inputTokens: number;
  source: 'api' | 'estimate';
}

/**
 * Count tokens using Anthropic's free count_tokens API endpoint.
 * Returns exact token count for the given model/messages combination.
 */
export async function countTokensAnthropic(
  apiKey: string,
  model: string,
  messages: any[],
  system?: string,
  tools?: any[]
): Promise<TokenCountResult> {
  const body: any = { model, messages };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;

  const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic count_tokens failed (${response.status}): ${errText}`);
  }

  const data = await response.json() as { input_tokens: number };
  return { inputTokens: data.input_tokens, source: 'api' };
}

/**
 * Fast character-based token estimation (~4 chars per token).
 * Used as fallback for non-Anthropic providers.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/**
 * Check if input is approaching the context window limit.
 * Returns the percentage of context used.
 */
export function contextUsagePercent(inputTokens: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0;
  return (inputTokens / contextWindow) * 100;
}
