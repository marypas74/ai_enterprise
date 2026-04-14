/**
 * Maps a raw stream error message to a user-facing message.
 *
 * Extracted from the completions route error handler to enable
 * isolated testing. Covers: Parlant agent errors, timeouts, vLLM 502
 * cold-start, HTTP status codes (401/429/404/503), Ollama GPU crash,
 * and connection failures.
 *
 * Priority order matters — timeout/502/specific codes checked before
 * generic patterns.
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
  if (/\b502\b/.test(errorMessage) || errorMessage.toLowerCase().includes('bad gateway')) {
    return 'Il modello AI è in fase di avvio, riprova tra qualche minuto.';
  }
  if (/\b401\b/.test(errorMessage) || errorMessage.toLowerCase().includes('unauthorized')) {
    return "API key non valida o mancante. Contatta l'amministratore.";
  }
  if (
    /\b429\b/.test(errorMessage) ||
    errorMessage.toLowerCase().includes('too many requests') ||
    errorMessage.toLowerCase().includes('rate limit')
  ) {
    return 'Limite rate raggiunto. Riprova tra qualche momento.';
  }
  if (/\b404\b/.test(errorMessage) || errorMessage.toLowerCase().includes('not found')) {
    return "Modello AI non trovato. Contatta l'amministratore.";
  }
  if (/\b503\b/.test(errorMessage) || errorMessage.toLowerCase().includes('service unavailable')) {
    return 'Servizio AI temporaneamente non disponibile. Riprova tra qualche minuto.';
  }
  if (errorMessage.includes('Ollama') && errorMessage.includes('500')) {
    return 'Il modello locale non è disponibile al momento. Prova un altro modello.';
  }
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
    return 'Could not connect to the AI service. Please try again later.';
  }
  return 'An error occurred while processing your request.';
}
