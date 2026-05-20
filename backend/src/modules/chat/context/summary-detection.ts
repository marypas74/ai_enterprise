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

  // 8. "Contenuto / argomento / ... del documento|file|articolo|..."
  /\b(contenut[io]|argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|soggett[io]|tes[ei]|sostanz[ae])\s+(del|dei|della|delle|dell['’])\s*(documento|file|pdf|testo|articolo|paper|report|allegato|document[io]|scritto)\b/i,

  // 9. Imperativi: "descrivi/spiega/elenca/... + documento|argomenti|..."
  /\b(descrivi(mi)?|spiegami?|illustrami?|riassumimi?|dimmi|elencami?|esponi(mi)?|mostrami|parlami|raccontami)\s+.{0,20}?(contenut[io]|argoment[io]|tem[ai]|(tematich[ei]|tematic[ao])|soggett[io]|punt[io]|documento|file|pdf|testo|articolo|allegato|scritto)\b/i,

  // 10. Inglese: "what is this document about" e varianti
  /\bwhat(\s+is|'s|\s+does)\s+(this|the|it)\s+(document|file|pdf|text|article|paper)\s+(about|cover|contain|discuss)\b/i,

  // 11. TL;DR varianti (tldr / tl dr / tl-dr / tl;dr / tl.dr)
  /\btl[\s;:,.\-]?d[\s]?r\b/i,

  // 12. "in (N|due|poche|breve) (parole|righe|punti)"
  /\bin\s+(\d+|due|poche|breve|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(parole|righe|punti)\b/i,

  // 13. "in (sintesi|breve|soldoni|pillole)"
  /\bin\s+(sintesi|breve|soldoni|pillole)\b/i,

  // 14. "il (succo|nocciolo)"
  /\bil\s+(succo|nocciolo)\b/i,

  // 15. "che roba è" / "che roba e'"
  /\bche\s+roba\s+(è|e['’])(?!\w)/i,

  // 16. "fammi un punto"
  /\bfammi\s+un\s+punto\b/i,

  // 17. Slang regionali (accentate => no \b finale, usiamo lookahead)
  /\bfammi\s+cap(i|ì|i['’])(?!\w)/i,
  /\bdimme\s+['’]?n\s+po['’]?/i,
  /\bfamme\s+cap(i|ì|i['’])(?!\w)/i,
  /\bspiegheme\b/i,

  // 18. EN aggiuntivo: gist / brief me / in a nutshell / recap
  /\b(gist|brief\s+me|in\s+a\s+nutshell|recap)\b/i,
];

// Pattern di esclusione: la query si riferisce alla CONVERSAZIONE, non al
// documento. Se matcha, isSummaryQuery ritorna false anche con match positivo.
const CONVERSATION_REFERENCE_PATTERN =
  /\b(hai\s+detto|abbiamo\s+(detto|discusso|parlato)|conversazione|chat|risposta)\b/i;

export function isSummaryQuery(query: string): boolean {
  if (!query) return false;
  if (CONVERSATION_REFERENCE_PATTERN.test(query)) return false;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
): Promise<{ content: string; metadata: Record<string, any> }[]> {
  const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const filter: any = { must: [{ key: 'user_id', match: { value: userId } }] };
  if (documentIds && documentIds.length > 0) {
    filter.must.push({
      key: 'attachment_id',
       
      match: { any: documentIds },
    });
  }

  // Scroll ALL points for this user/document (no vector search)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  const allPoints: any[] = [];
  let nextOffset: string | number | null = null;

  for (let i = 0; i < 10; i++) { // max 10 scroll pages (2000 points)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
