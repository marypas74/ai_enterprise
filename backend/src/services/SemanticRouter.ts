/**
 * SemanticRouter — FASE 8.4: Embedding-based task classification.
 *
 * Uses cosine similarity against pre-computed route embeddings to classify
 * incoming queries into routing tiers WITHOUT making LLM calls.
 * Latency: ~1-5ms (embedding lookup + cosine similarity).
 */
import mysql from 'mysql2/promise';
import type { RoutingTier } from './ModelRouter.js';

// ─── Types ──────────────────────────────────────────────────────────
interface SemanticRoute {
  name: string;
  tier: RoutingTier;
  examples: string[];
  embeddings?: number[][];  // Pre-computed embeddings
}

interface SemanticMatch {
  route: string;
  tier: RoutingTier;
  similarity: number;
}

// ─── Route definitions ──────────────────────────────────────────────
const ROUTING_ROUTES: SemanticRoute[] = [
  {
    name: 'greeting',
    tier: 'fast',
    examples: [
      'ciao', 'buongiorno', 'come stai', 'hello', 'hi',
      'grazie', 'ok perfetto', 'va bene', 'grazie mille',
      'a dopo', 'buona giornata', 'arrivederci',
    ],
  },
  {
    name: 'simple_question',
    tier: 'fast',
    examples: [
      'che ore sono', 'qual è la capitale della Francia',
      'traduci questa frase in inglese', 'come si dice ciao in tedesco',
      'riassumi in una riga', 'quanti abitanti ha Roma',
      'che giorno è oggi', 'dimmi una curiosità',
    ],
  },
  {
    name: 'formatting',
    tier: 'fast',
    examples: [
      'metti in maiuscolo', 'correggi gli errori grammaticali',
      'riformula questa frase', 'cambia il tono in formale',
      'converti in lista puntata', 'formatta come tabella',
    ],
  },
  {
    name: 'coding_simple',
    tier: 'balanced',
    examples: [
      'scrivi una funzione che calcola il fattoriale',
      'correggi questo bug nel codice', 'spiega questo codice',
      'aggiungi un test unitario', 'refactoring di questo metodo',
      'come faccio un fetch in javascript', 'come uso useEffect',
    ],
  },
  {
    name: 'analysis',
    tier: 'balanced',
    examples: [
      'analizza questo documento', 'confronta queste opzioni',
      'quali sono i pro e contro', 'spiega la differenza tra',
      'fai un riassunto dettagliato', 'analizza i dati',
      'recensisci questo testo', 'valuta questa proposta',
    ],
  },
  {
    name: 'writing',
    tier: 'balanced',
    examples: [
      'scrivi una email professionale', 'redigi una lettera',
      'crea un post per il blog', 'scrivi una descrizione prodotto',
      'genera un comunicato stampa', 'scrivi una proposta commerciale',
    ],
  },
  {
    name: 'complex_reasoning',
    tier: 'powerful',
    examples: [
      'progetta un\'architettura per un sistema distribuito',
      'scrivi un business plan completo',
      'analizza criticamente questo paper scientifico',
      'valuta i rischi di questa strategia aziendale',
      'proponi una strategia di migrazione del database',
      'crea una roadmap di sviluppo per 6 mesi',
      'confronta in dettaglio le architetture microservizi vs monolite',
    ],
  },
  {
    name: 'complex_coding',
    tier: 'powerful',
    examples: [
      'progetta il database schema per un e-commerce',
      'implementa un sistema di autenticazione completo',
      'scrivi un parser per questo formato custom',
      'crea un sistema di caching distribuito',
      'implementa un algoritmo di ricerca full-text',
      'refactoring complesso del modulo di pagamento',
    ],
  },
  {
    name: 'multi_step_agent',
    tier: 'powerful',
    examples: [
      'cerca sul web e poi analizza i risultati',
      'scarica il file e processalo', 'esegui questa pipeline',
      'usa gli strumenti per completare il task',
      'fai una ricerca approfondita su questo argomento',
      'analizza il codice e proponi miglioramenti con test',
    ],
  },
];

// ─── Cosine similarity ──────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Semantic Router Class ──────────────────────────────────────────
export class SemanticRouter {
  private routes: SemanticRoute[] = ROUTING_ROUTES;
  private initialized = false;
  private readonly SIMILARITY_THRESHOLD = 0.65;

  constructor(private db: mysql.Pool) {}

  /**
   * Initialize by computing embeddings for all route examples.
   * Call once at startup (cached in memory).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { generateEmbedding } = await import('./EmbeddingService.js');

      for (const route of this.routes) {
        const embeddings: number[][] = [];
        for (const example of route.examples) {
          const result = await generateEmbedding(this.db, example);
          if (result?.embedding) {
            embeddings.push(result.embedding);
          }
        }
        route.embeddings = embeddings;
      }
      this.initialized = true;
    } catch (err) {
      // Embedding service not available — semantic routing disabled
      console.warn('[SemanticRouter] Failed to initialize embeddings, semantic routing disabled:', err);
    }
  }

  /**
   * Classify a query by finding the most similar route.
   * Returns null if no route exceeds the similarity threshold.
   */
  async classify(query: string): Promise<SemanticMatch | null> {
    if (!this.initialized) return null;

    try {
      const { generateEmbedding } = await import('./EmbeddingService.js');
      const queryResult = await generateEmbedding(this.db, query);
      if (!queryResult?.embedding) return null;

      let bestMatch: SemanticMatch | null = null;
      let bestSimilarity = this.SIMILARITY_THRESHOLD;

      for (const route of this.routes) {
        if (!route.embeddings || route.embeddings.length === 0) continue;

        // Average similarity across all examples in the route
        let maxSim = 0;
        for (const emb of route.embeddings) {
          const sim = cosineSimilarity(queryResult.embedding, emb);
          if (sim > maxSim) maxSim = sim;
        }

        if (maxSim > bestSimilarity) {
          bestSimilarity = maxSim;
          bestMatch = {
            route: route.name,
            tier: route.tier,
            similarity: maxSim,
          };
        }
      }

      return bestMatch;
    } catch {
      return null;
    }
  }

  get isReady(): boolean {
    return this.initialized;
  }
}

// Singleton
let semanticRouterInstance: SemanticRouter | null = null;

export function getSemanticRouter(db: mysql.Pool): SemanticRouter {
  if (!semanticRouterInstance) {
    semanticRouterInstance = new SemanticRouter(db);
  }
  return semanticRouterInstance;
}
