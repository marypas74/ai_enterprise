// ---- Summary Intent Detection ----

const SUMMARY_PATTERNS = [
  // 1. Riassunto / sintesi espliciti (IT + EN)
  /\b(riassum(i|imi|ilo|ere)|riassunto|sintetizza(mi|re)?|sintesi|compendio)\b/i,
  /\b(summarize|summary|overview|abstract|tl;?dr|gist)\b/i,

  // 2. Panoramica / punti / argomenti principali
  /\b(panoramic[ao]|punti\s+(principali|chiave|salient[ei]|trattati|cardine))\b/i,
  /\b(argoment[io]|tem[ai]|(tematich[ei]|tematic[ao]))\s+(principali|trattati|chiave|salient[ei])\b/i,
  /\b(main|key|primary|core)\s+(topics?|themes?|subjects?|points?|ideas?|takeaways?)\b/i,

  // 3. "(Che) cosa + verbo di contenuto"
  /\b(che\s+)?cosa\s+(dice|contiene|tratta|parla|riguarda|concerne|discute|affronta|analizza|descrive|spiega|presenta|illustra|racconta|espone|menziona|copre|include|approfondisce)\b/i,

  // 4. "Di (che) cosa + verbo di contenuto"
  /\bdi\s+(che\s+)?cosa\s+(parla|tratta|si\s+(occupa|parla|discute|tratta)|discute|scrive|ragiona|racconta)\b/i,

  // 5. "Di/Su che|quali + sinonimi-di-argomento"
  /\b(di|su|sopra|circa)\s+(che|quali)\s+(argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|contenut[io]|materi[ae]|question[ei]|soggett[io]|assunt[io]|punt[io]|cose?)\b/i,

  // 6. "Che|quali + sinonimi-di-argomento"
  /\b(che|quali)\s+(argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|contenut[io]|materi[ae]|question[ei]|soggett[io]|assunt[io]|punt[io])\b/i,

  // 7. "Qual(e) è / quali sono + sinonimi-di-argomento"
  /\b(qual[eì]?'?\s*[èe]|qual[ei]?\s+sono|qual[ei]?\s+sarebb(e|ero))\s+(il|la|lo|l['i]|i|gli|le)?\s*(argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|contenut[io]|materi[ae]|soggett[io]|tes[ei]|assunt[io])\b/i,

  // 8. "Contenuto / argomento / ... del documento|file|..."
  /\b(contenut[io]|argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|soggett[io]|tes[ei]|sostanz[ae])\s+(del|dei|della|delle|dell')\s+(documento|file|pdf|testo|articolo|paper|report|allegato|document[io]|scritto)\b/i,

  // 9. Imperativi: "descrivi/spiega/elenca/... + documento|argomenti|..."
  /\b(descrivi(mi)?|spiegami?|illustrami?|riassumimi?|dimmi|elencami?|esponi(mi)?|mostrami|parlami|raccontami)\s+.{0,20}?(contenut[io]|argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|soggett[io]|punt[io]|documento|file|pdf|testo|articolo|allegato|scritto)\b/i,

  // 10. Inglese: "what is this document about" e varianti
  /\bwhat(\s+is|'s|\s+does)\s+(this|the|it)\s+(document|file|pdf|text|article|paper)\s+(about|cover|contain|discuss)\b/i,
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
