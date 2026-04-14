/**
 * Maps a raw stream error message to a user-facing message.
 *
 * Extracted from the completions route error handler to enable
 * isolated testing. The function covers all known error categories:
 * Parlant agent errors, timeouts, vLLM 502 cold-start, and connection failures.
 */
export function mapStreamErrorToUserMessage(
  errorMessage: string,
  isParlant = false,
): string {
  if (isParlant && errorMessage.includes('Parlant')) {
    return 'Parlant AI Agent service is temporarily unavailable. Please try again later.';
  }
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return 'Request timed out. The AI service took too long to respond.';
  }
  if (errorMessage.includes('502') || errorMessage.toLowerCase().includes('bad gateway')) {
    return 'Il modello AI è in fase di avvio, riprova tra qualche minuto.';
  }
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
    return 'Could not connect to the AI service. Please try again later.';
  }
  return 'An error occurred while processing your request.';
}
