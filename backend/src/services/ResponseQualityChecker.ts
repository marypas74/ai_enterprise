/**
 * ResponseQualityChecker — FASE 8.3: Cascade pattern quality assessment.
 *
 * Evaluates LLM responses WITHOUT making additional LLM calls.
 * Determines if a response from a cheaper model needs escalation to a more powerful one.
 */

// ─── Types ──────────────────────────────────────────────────────────
export interface QualityAssessment {
  score: number;            // 0-1 (1 = excellent)
  shouldEscalate: boolean;
  reason: string;
  metrics: {
    responseLength: number;
    containsRefusal: boolean;
    containsUncertainty: boolean;
    isTruncated: boolean;
    questionAnswered: boolean;
  };
}

// ─── Refusal / uncertainty patterns ────────────────────────────────
const REFUSAL_PATTERNS_IT = [
  'non posso', 'non sono in grado', 'non ho la capacità',
  'mi dispiace, non', 'non è possibile per me',
  'non ho accesso a', 'non ho informazioni su',
  'come modello linguistico', 'come assistente ai',
];

const REFUSAL_PATTERNS_EN = [
  "i can't", "i cannot", "i'm not able to", "i am not able to",
  "i don't have access", "i don't have the ability",
  "as a language model", "as an ai assistant",
  "i'm sorry, but i can't",
];

const UNCERTAINTY_PATTERNS = [
  'non sono sicuro', 'potrebbe essere', 'forse',
  "i'm not sure", 'might be', 'perhaps', 'possibly',
  'non ne sono certo', 'probabilmente', 'presumably',
];

// ─── Assessment logic ──────────────────────────────────────────────
export function assessResponseQuality(
  query: string,
  response: string,
): QualityAssessment {
  const responseLower = response.toLowerCase();
  const queryLower = query.toLowerCase();

  // 1. Check for refusal patterns
  const containsRefusal = [
    ...REFUSAL_PATTERNS_IT,
    ...REFUSAL_PATTERNS_EN,
  ].some(p => responseLower.includes(p));

  // 2. Check for high uncertainty
  const uncertaintyCount = UNCERTAINTY_PATTERNS.filter(p => responseLower.includes(p)).length;
  const containsUncertainty = uncertaintyCount >= 2;

  // 3. Check if response is too short relative to query complexity
  const queryWords = query.split(/\s+/).length;
  const responseWords = response.split(/\s+/).length;
  const isVeryShort = responseWords < Math.max(10, queryWords * 0.5);

  // 4. Check for truncation (incomplete sentences, code blocks)
  const openCodeBlocks = (response.match(/```/g) || []).length;
  const isTruncated = openCodeBlocks % 2 !== 0
    || (response.length > 100 && !response.trimEnd().match(/[.!?:;\n`)\]}]$/));

  // 5. Check if the query's main question seems answered
  const hasQuestion = queryLower.includes('?');
  const questionAnswered = !hasQuestion || responseWords > 20;

  // ─── Score calculation ──────────────────────────────────────────
  let score = 1.0;

  if (containsRefusal) score -= 0.5;
  if (containsUncertainty) score -= 0.2;
  if (isVeryShort) score -= 0.3;
  if (isTruncated) score -= 0.3;
  if (!questionAnswered) score -= 0.2;

  score = Math.max(0, Math.min(1, score));

  // ─── Escalation decision ────────────────────────────────────────
  const shouldEscalate = score < 0.5;

  const reasons: string[] = [];
  if (containsRefusal) reasons.push('refusal detected');
  if (containsUncertainty) reasons.push('high uncertainty');
  if (isVeryShort) reasons.push('too short');
  if (isTruncated) reasons.push('truncated');
  if (!questionAnswered) reasons.push('question unanswered');

  return {
    score,
    shouldEscalate,
    reason: reasons.length > 0 ? reasons.join(', ') : 'adequate quality',
    metrics: {
      responseLength: response.length,
      containsRefusal,
      containsUncertainty,
      isTruncated,
      questionAnswered,
    },
  };
}
