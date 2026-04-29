// ---- Intent Detection (cascade classifier) ----
//
// Classifica una query utente in 4 intent disgiunti, con priorità:
//   WEB_SEARCH > DOC_SEARCH > SUMMARY > FREE_SEARCH
//
// Rif: research-first-agent brief — copertura ~80-90% slang IT (formali,
// informali, regionali, abbreviazioni) + EN fallback.

import { isSummaryQuery } from './summary-detection.js';

export type ChatIntent = 'WEB_SEARCH' | 'DOC_SEARCH' | 'SUMMARY' | 'FREE_SEARCH';

// Pattern che indicano riferimento ad un DOCUMENTO (usato sia per DOC_SEARCH
// sia come override su WEB quando entrambi i segnali compaiono).
const DOC_REFERENCE_PATTERN =
  /\b(documento|doc|pdf|allegato|file\s+caricato|file|testo|fonte|articolo|paper|report)\b/i;

const WEB_PATTERNS: RegExp[] = [
  // Verbi/sostantivi tipici di "google"
  /\b(googl\w*|gugol)\b/i,
  // "cerca/ricerca/trova/guarda/vedi/consulta ... online/in rete/web/internet/google/bing"
  /\b(cerca|ricerca|trova|guarda|vedi|consulta)\b.*\b(online|in\s+rete|sul?\s+(web|internet|google|bing)|in\s+internet)\b/i,
  // "ultime notizie / news recenti / che si dice online / trending"
  /\b(ultim\w+\s+notizi\w+|news\s+recenti|che\s+(si\s+dice|dicono)\s+(online|in\s+giro|sul\s+web)|trending)\b/i,
  // EN fallback
  /\b(search\s+online|web\s+search|look\s+it\s+up|latest\s+news)\b/i,
];

const DOC_PATTERNS: RegExp[] = [
  // Verbi di ricerca/estrazione + riferimento a documento
  /\b(cerc|trov|individu|localizz|estra|cita|citaz|riport|mostr|evidenzi|scov|pesc)\w*\b.*\b(documento|doc|pdf|file|allegato|testo|fonte|nei?\s+(doc|file))/i,
  // "dove dice / dove sta scritto / dove si trova / dove c'è (scritto)? / in quale punto|parte|pagina / a che pagina"
  /\bdove\s+(dice|sta\s+scritto|si\s+trova)\b/i,
  /\bdove\s+c['’]?(è|e['’])(\s+scritto)?/i,
  /\bin\s+quale\s+(punto|parte|pagina)\b/i,
  /\ba\s+che\s+pagina\b/i,
  // EN fallback
  /\b(find|search|where\s+does\s+it\s+say|show\s+me\s+where|extract|cite|quote)\b/i,
];

function matchesAny(query: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(query));
}

/**
 * Classifica l'intent della query secondo la cascata di priorità.
 * Regola critica: se la query matcha sia WEB sia un riferimento a documento
 * (es. "cerca online nel pdf"), prevale DOC_SEARCH.
 */
export function detectIntent(query: string): ChatIntent {
  const q = (query || '').trim();
  if (!q) return 'FREE_SEARCH';

  const isWeb = matchesAny(q, WEB_PATTERNS);
  const isDoc = matchesAny(q, DOC_PATTERNS);
  const hasDocRef = DOC_REFERENCE_PATTERN.test(q);

  // Override critico: WEB + riferimento documento => DOC_SEARCH
  if (isWeb && hasDocRef) return 'DOC_SEARCH';

  if (isWeb) return 'WEB_SEARCH';
  if (isDoc) return 'DOC_SEARCH';

  if (isSummaryQuery(q)) return 'SUMMARY';

  return 'FREE_SEARCH';
}

export const __TESTING__ = { WEB_PATTERNS, DOC_PATTERNS, DOC_REFERENCE_PATTERN };
