import { describe, it, expect } from 'vitest';
import { isSummaryQuery } from '../summary-detection.js';

describe('isSummaryQuery — pattern originali', () => {
  const positives = [
    'riassumi il documento',
    'riassumimi questo pdf',
    'fammi una sintesi',
    'sintetizzami il file',
    'summary please',
    'summarize this',
    'overview of the doc',
    'tl;dr',
    'panoramica del file',
    'punti chiave del documento',
    'main topics covered',
    'cosa dice il documento',
    'di cosa parla il pdf',
    'quali argomenti tratta',
    "qual è il contenuto del documento",
    "contenuto dell'articolo",
    'descrivimi gli argomenti del documento',
    'what is this document about',
  ];

  for (const q of positives) {
    it(`positive: "${q}"`, () => {
      expect(isSummaryQuery(q)).toBe(true);
    });
  }
});

describe('isSummaryQuery — nuovi pattern (slang IT, EN, abbreviazioni)', () => {
  const positives = [
    // TL;DR varianti
    'tldr',
    'tl dr',
    'tl-dr',
    'TL.DR',
    // "in X parole/righe/punti"
    'in 2 parole',
    'in due parole',
    'in poche parole',
    'in breve parole',
    'in 3 righe',
    'in cinque punti',
    // "in sintesi/breve/soldoni/pillole"
    'in sintesi',
    'in breve',
    'in soldoni',
    'in pillole',
    // "il succo / il nocciolo"
    'qual è il succo',
    'dimmi il nocciolo',
    // "che roba è"
    'che roba è',
    // "fammi un punto"
    'fammi un punto',
    // Slang regionali
    'fammi capì',
    "dimme 'n po'",
    'famme capì sto coso',
    'spiegheme',
    // EN extra
    'gist of the document',
    'brief me',
    'in a nutshell',
    'recap please',
  ];

  for (const q of positives) {
    it(`positive: "${q}"`, () => {
      expect(isSummaryQuery(q)).toBe(true);
    });
  }
});

describe('isSummaryQuery — esclusioni (riferimenti alla conversazione)', () => {
  const negatives = [
    'riassumi quello che hai detto',
    'riassumi la conversazione',
    'sintetizza la chat',
    'dimmi cosa abbiamo detto',
    'di che cosa abbiamo discusso',
    'di cosa abbiamo parlato',
    'riassumi la tua risposta',
  ];

  for (const q of negatives) {
    it(`negative (conversation ref): "${q}"`, () => {
      expect(isSummaryQuery(q)).toBe(false);
    });
  }
});

describe('isSummaryQuery — non-summary queries', () => {
  const negatives = [
    'ciao',
    'che ore sono',
    'come stai oggi',
    'calcola 2+2',
    'scrivi una poesia',
    'aprimi il browser',
  ];
  for (const q of negatives) {
    it(`negative: "${q}"`, () => {
      expect(isSummaryQuery(q)).toBe(false);
    });
  }
});
