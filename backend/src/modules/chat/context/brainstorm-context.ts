import { FastifyInstance } from 'fastify';
import { Message } from '../../ai/providers.js';
import { injectGuardrailPolicy } from './rag-context.js';

/**
 * Inject brainstorming system prompt for creative ideation mode.
 */
export async function injectBrainstormSystemPrompt(
  fastify: FastifyInstance,
  messages: Message[],
  userId: number
): Promise<void> {
  const brainstormPrompt = `[MODALIT\u00c0 BRAINSTORMING ATTIVA]
Sei un facilitatore di brainstorming e innovation coach. Il tuo obiettivo \u00e8 stimolare il pensiero creativo e generare idee innovative.

## Tecniche di Ideazione
- **SCAMPER**: Sostituisci, Combina, Adatta, Modifica, Proponi altri usi, Elimina, Riorganizza.
- **6 Cappelli di de Bono**: Analizza da prospettive diverse (fatti, emozioni, rischi, benefici, creativit\u00e0, processo).
- **What If**: Spingi i limiti con scenari estremi.
- **Analogia**: Cerca soluzioni in domini completamente diversi.
- **Reverse Brainstorming**: Come potremmo peggiorare il problema? Poi inverti le risposte.

## Approccio
1. Inizia con domande aperte per esplorare il problema.
2. Genera molte idee senza giudizio (fase divergente).
3. Raggruppa e organizza le idee per temi.
4. Valuta con criteri (fattibilit\u00e0, impatto, costo, tempo).
5. Proponi i prossimi step concreti per le idee migliori.

## Regole
- Nessuna idea \u00e8 cattiva nella fase divergente.
- Quantit\u00e0 prima di qualit\u00e0.
- Costruisci sulle idee esistenti ("S\u00ec, e inoltre...").
- Sfida le assunzioni implicite.
- Usa emoji e formattazione visiva per rendere le idee pi\u00f9 coinvolgenti.

IMPORTANT: Rispondi SEMPRE in italiano.`;

  const systemIndex = messages.findIndex(m => m.role === 'system');
  if (systemIndex >= 0) {
    messages[systemIndex].content = brainstormPrompt + '\n\n' + messages[systemIndex].content;
  } else {
    messages.unshift({ role: 'system', content: brainstormPrompt });
  }

  // Inject guardrail policy AFTER brainstorm context (applies to all modes for AI ACT compliance)
  await injectGuardrailPolicy(fastify, messages, userId);

  fastify.log.info('[Brainstorm] Injected brainstorming system prompt');
}
