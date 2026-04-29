import { describe, it, expect } from 'vitest';
import { detectIntent, type ChatIntent } from '../intent-detection.js';

type Case = [string, ChatIntent];

const WEB_CASES: Case[] = [
  ['cerca su google', 'WEB_SEARCH'],
  ['googla questo', 'WEB_SEARCH'],
  ['gugol per favore', 'WEB_SEARCH'],
  ['cerca online ultime news', 'WEB_SEARCH'],
  ['ricerca in rete questa cosa', 'WEB_SEARCH'],
  ['trova sul web informazioni', 'WEB_SEARCH'],
  ['guarda sul web', 'WEB_SEARCH'],
  ['vedi su internet', 'WEB_SEARCH'],
  ['consulta online', 'WEB_SEARCH'],
  ['cerca in internet', 'WEB_SEARCH'],
  ['cerca sul google', 'WEB_SEARCH'],
  ['cerca su bing', 'WEB_SEARCH'],
  ['ultime notizie su questo argomento', 'WEB_SEARCH'],
  ['news recenti per favore', 'WEB_SEARCH'],
  ['che si dice online', 'WEB_SEARCH'],
  ['che dicono in giro sul web', 'WEB_SEARCH'],
  ['trending oggi', 'WEB_SEARCH'],
  ['search online for latest news', 'WEB_SEARCH'],
  ['web search this please', 'WEB_SEARCH'],
  ['look it up please', 'WEB_SEARCH'],
  ['latest news on AI', 'WEB_SEARCH'],
];

const DOC_CASES: Case[] = [
  ['cerca nel documento', 'DOC_SEARCH'],
  ['trova nel pdf', 'DOC_SEARCH'],
  ['individua nel file', 'DOC_SEARCH'],
  ['localizza nel documento', 'DOC_SEARCH'],
  ['estrai dal pdf', 'DOC_SEARCH'],
  ['cita dal documento', 'DOC_SEARCH'],
  ['citazione dal testo', 'DOC_SEARCH'],
  ['riporta dal file', 'DOC_SEARCH'],
  ['mostra nel documento', 'DOC_SEARCH'],
  ['evidenzia nel pdf', 'DOC_SEARCH'],
  ['scova nel documento', 'DOC_SEARCH'],
  ['pesca dal pdf', 'DOC_SEARCH'],
  ['dove dice questo', 'DOC_SEARCH'],
  ['dove sta scritto', 'DOC_SEARCH'],
  ['dove si trova', 'DOC_SEARCH'],
  ["dove c'è scritto", 'DOC_SEARCH'],
  ['in quale punto', 'DOC_SEARCH'],
  ['in quale parte', 'DOC_SEARCH'],
  ['in quale pagina', 'DOC_SEARCH'],
  ['a che pagina', 'DOC_SEARCH'],
  ['find in the document', 'DOC_SEARCH'],
  ['search the pdf', 'DOC_SEARCH'],
  ['where does it say', 'DOC_SEARCH'],
  ['show me where in the file', 'DOC_SEARCH'],
  ['extract from the document', 'DOC_SEARCH'],
  ['cite from the pdf', 'DOC_SEARCH'],
  ['quote from the document', 'DOC_SEARCH'],
  // Caso borderline: "online" + "pdf" => DOC_SEARCH
  ['cerca online nel pdf', 'DOC_SEARCH'],
  ['cerca online nel documento allegato', 'DOC_SEARCH'],
];

const SUMMARY_CASES: Case[] = [
  ['riassumi il documento', 'SUMMARY'],
  ['fammi una sintesi', 'SUMMARY'],
  ['summary please', 'SUMMARY'],
  ['tl;dr', 'SUMMARY'],
  ['tldr', 'SUMMARY'],
  ['in 2 parole', 'SUMMARY'],
  ['in poche parole di che parla', 'SUMMARY'],
  ['in soldoni', 'SUMMARY'],
  ['in pillole', 'SUMMARY'],
  ['cosa contiene il documento', 'SUMMARY'],
  ['di cosa parla il pdf', 'SUMMARY'],
  ['quali argomenti tratta', 'SUMMARY'],
  ['punti chiave del documento', 'SUMMARY'],
  ['panoramica del file', 'SUMMARY'],
  ['fammi capì', 'SUMMARY'],
  ['spiegheme sto documento', 'SUMMARY'],
  ['gist of the document', 'SUMMARY'],
  ['brief me', 'SUMMARY'],
  ['in a nutshell', 'SUMMARY'],
  ['recap please', 'SUMMARY'],
  ['overview please', 'SUMMARY'],
  ['what is this document about', 'SUMMARY'],
];

const FREE_CASES: Case[] = [
  ['ciao come stai', 'FREE_SEARCH'],
  ['che ore sono', 'FREE_SEARCH'],
  ['scrivimi una poesia', 'FREE_SEARCH'],
  ['calcola 2+2', 'FREE_SEARCH'],
  ['raccontami una barzelletta', 'FREE_SEARCH'],
  ['traduci ciao in inglese', 'FREE_SEARCH'],
  ['spiegami la teoria della relatività', 'FREE_SEARCH'],
  ['aiutami a scrivere una mail', 'FREE_SEARCH'],
  ['quale è la capitale della Francia', 'FREE_SEARCH'],
  ['ok grazie', 'FREE_SEARCH'],
  ['sì', 'FREE_SEARCH'],
  ['no, ho cambiato idea', 'FREE_SEARCH'],
  // borderline: "riassumi la chat" => FREE per esclusione
  ['riassumi la chat', 'FREE_SEARCH'],
  ['riassumi quello che hai detto', 'FREE_SEARCH'],
  ['riassumi la conversazione', 'FREE_SEARCH'],
];

describe('detectIntent — WEB_SEARCH', () => {
  for (const [q, expected] of WEB_CASES) {
    it(`"${q}" -> ${expected}`, () => {
      expect(detectIntent(q)).toBe(expected);
    });
  }
});

describe('detectIntent — DOC_SEARCH', () => {
  for (const [q, expected] of DOC_CASES) {
    it(`"${q}" -> ${expected}`, () => {
      expect(detectIntent(q)).toBe(expected);
    });
  }
});

describe('detectIntent — SUMMARY', () => {
  for (const [q, expected] of SUMMARY_CASES) {
    it(`"${q}" -> ${expected}`, () => {
      expect(detectIntent(q)).toBe(expected);
    });
  }
});

describe('detectIntent — FREE_SEARCH (default + esclusioni)', () => {
  for (const [q, expected] of FREE_CASES) {
    it(`"${q}" -> ${expected}`, () => {
      expect(detectIntent(q)).toBe(expected);
    });
  }
});

describe('detectIntent — priorità (WEB > DOC > SUMMARY > FREE)', () => {
  it('WEB ha priorità su SUMMARY puro', () => {
    expect(detectIntent('cerca online le ultime notizie')).toBe('WEB_SEARCH');
  });
  it('DOC ha priorità su WEB quando entrambi compaiono ("cerca online nel pdf")', () => {
    expect(detectIntent('cerca online nel pdf le info')).toBe('DOC_SEARCH');
  });
  it('SUMMARY se nessun WEB/DOC matcha', () => {
    expect(detectIntent('riassumi il documento allegato')).toBe('SUMMARY');
  });
  it('FREE come fallback', () => {
    expect(detectIntent('ciao')).toBe('FREE_SEARCH');
  });
});
