// ---- Summary Intent Detection ----

const SUMMARY_PATTERNS = [
  /\b(riassumi|riassunto|riassumimi|sintetizza|sintesi)\b/i,
  /\b(summarize|summary|overview|abstract)\b/i,
  /\b(panoramica|punti\s+principali|argomenti\s+principali)\b/i,
  /\b(cosa\s+(dice|contiene|tratta|parla|riguarda))\b/i,
  /\b(di\s+cosa\s+(parla|tratta|si\s+occupa))\b/i,
  /\b(contenuto\s+del\s+documento)\b/i,
  /\b(descrivi(mi)?|spiegami)\s+(il\s+)?(documento|file|pdf|testo)\b/i,
];

export function isSummaryQuery(query: string): boolean {
  return SUMMARY_PATTERNS.some(p => p.test(query));
}

/**
 * Fetch all document chunks from Qdrant using scroll (no vector search).
 * Returns chunks sorted by chunk_index for document order, spread-sampled to fit context.
 */
export async function fetchDocumentChunksForSummary(
  userId: number,
  documentIds?: number[],
  maxChunks: number = 40,
): Promise<{ content: string; metadata: Record<string, any> }[]> {
  const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

  const filter: any = { must: [{ key: 'user_id', match: { value: userId } }] };
  if (documentIds && documentIds.length > 0) {
    filter.must.push({
      key: 'attachment_id',
      match: { any: documentIds },
    });
  }

  // Scroll ALL points for this user/document (no vector search)
  const allPoints: any[] = [];
  let nextOffset: string | number | null = null;

  for (let i = 0; i < 10; i++) { // max 10 scroll pages (2000 points)
    const body: any = {
      filter,
      limit: 200,
      with_payload: true,
      with_vector: false,
    };
    if (nextOffset !== null) body.offset = nextOffset;

    try {
      const resp = await fetch(`${QDRANT_URL}/collections/declarative_memory/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) break;
      const data = await resp.json() as any;
      const points = data.result?.points || [];
      allPoints.push(...points);
      nextOffset = data.result?.next_page_offset ?? null;
      if (!nextOffset || points.length === 0) break;
    } catch {
      break;
    }
  }

  if (allPoints.length === 0) return [];

  // Sort by chunk_index to maintain document order
  allPoints.sort((a, b) => {
    const ai = a.payload?.chunk_index ?? 0;
    const bi = b.payload?.chunk_index ?? 0;
    return ai - bi;
  });

  // Spread-sample: take evenly distributed chunks to cover the entire document
  let selected: any[];
  if (allPoints.length <= maxChunks) {
    selected = allPoints;
  } else {
    const step = allPoints.length / maxChunks;
    selected = [];
    for (let i = 0; i < maxChunks; i++) {
      selected.push(allPoints[Math.floor(i * step)]);
    }
  }

  return selected.map(p => ({
    content: p.payload?.content || '',
    metadata: p.payload || {},
  }));
}

export { SUMMARY_PATTERNS };
