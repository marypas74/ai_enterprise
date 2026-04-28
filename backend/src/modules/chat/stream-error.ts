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
 *
 * The optional second argument supports two shapes for backward
 * compatibility: a plain boolean (legacy `isParlant` flag) or a context
 * object that may include the requested `model`, `provider`, the list of
 * `availableModels` (used to enrich the 404 message), and `isParlant`.
 */
export interface StreamErrorContext {
  model?: string;
  provider?: string;
  availableModels?: string[];
  isParlant?: boolean;
}

export function mapStreamErrorToUserMessage(
  errorMessage: string,
  contextOrIsParlant: StreamErrorContext | boolean = false,
): string {
  const context: StreamErrorContext = typeof contextOrIsParlant === 'boolean'
    ? { isParlant: contextOrIsParlant }
    : contextOrIsParlant;
  const isParlant = context.isParlant === true;

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
  if (/\b404\b/.test(errorMessage)) {
    return buildModelNotFoundMessage(context);
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

function buildModelNotFoundMessage(context: StreamErrorContext): string {
  const { model, provider, availableModels } = context;
  if (!model && !provider) {
    return "Modello AI non trovato. Contatta l'amministratore.";
  }
  const modelLabel = model ? `\`${model}\`` : 'richiesto';
  const providerSuffix = provider ? ` dal provider \`${provider}\`` : '';
  const base = `Il modello ${modelLabel} non è riconosciuto${providerSuffix}.`;
  const list = Array.isArray(availableModels) && availableModels.length > 0
    ? ` Modelli disponibili: ${availableModels.join(', ')}.`
    : '';
  return `${base}${list} Contatta l'amministratore.`;
}
