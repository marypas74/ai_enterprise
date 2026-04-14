import { describe, it, expect } from 'vitest';
import { mapStreamErrorToUserMessage } from './stream-error.js';

describe('mapStreamErrorToUserMessage', () => {
  it('returns generic message for unknown errors', () => {
    expect(mapStreamErrorToUserMessage('some unknown error')).toBe(
      'An error occurred while processing your request.'
    );
  });

  it('maps timeout errors', () => {
    const msg = mapStreamErrorToUserMessage('[vLLM] Request timed out after 300000ms');
    expect(msg).toContain('timed out');
  });

  it('maps 502 Bad Gateway to vLLM startup message', () => {
    const msg = mapStreamErrorToUserMessage('[vLLM] streamComplete() failed (Error/502): 502 Bad Gateway');
    expect(msg).toBe('Il modello AI è in fase di avvio, riprova tra qualche minuto.');
  });

  it('maps "Bad Gateway" string (no status code) to vLLM startup message', () => {
    const msg = mapStreamErrorToUserMessage('Bad Gateway from upstream');
    expect(msg).toBe('Il modello AI è in fase di avvio, riprova tra qualche minuto.');
  });

  it('maps ECONNREFUSED to service unavailable', () => {
    const msg = mapStreamErrorToUserMessage('ECONNREFUSED 127.0.0.1:8000');
    expect(msg).toContain('Could not connect');
  });

  it('maps fetch failed to service unavailable', () => {
    const msg = mapStreamErrorToUserMessage('fetch failed: network error');
    expect(msg).toContain('Could not connect');
  });

  it('maps Parlant error when isParlant=true', () => {
    const msg = mapStreamErrorToUserMessage('Parlant service error', true);
    expect(msg).toContain('Parlant');
  });

  it('ignores Parlant error when isParlant=false', () => {
    const msg = mapStreamErrorToUserMessage('Parlant service error', false);
    expect(msg).toBe('An error occurred while processing your request.');
  });

  it('prioritizes timeout over 502 when both present', () => {
    const msg = mapStreamErrorToUserMessage('timeout after 502 ms');
    expect(msg).toContain('timed out');
  });

  // HTTP status code mappings
  it('maps 401 Unauthorized to API key error', () => {
    const msg = mapStreamErrorToUserMessage('Error 401: 401 Unauthorized');
    expect(msg).toBe("API key non valida o mancante. Contatta l'amministratore.");
  });

  it('maps "unauthorized" (lowercase) to API key error', () => {
    const msg = mapStreamErrorToUserMessage('OpenAI API error: unauthorized access denied');
    expect(msg).toBe("API key non valida o mancante. Contatta l'amministratore.");
  });

  it('maps 429 to rate limit message', () => {
    const msg = mapStreamErrorToUserMessage('429 Too Many Requests - rate limit exceeded');
    expect(msg).toBe('Limite rate raggiunto. Riprova tra qualche momento.');
  });

  it('maps "rate limit" string to rate limit message', () => {
    const msg = mapStreamErrorToUserMessage('You exceeded your current quota, rate limit reached');
    expect(msg).toBe('Limite rate raggiunto. Riprova tra qualche momento.');
  });

  it('maps 404 to model not found message', () => {
    const msg = mapStreamErrorToUserMessage('404 Not Found: model does not exist');
    expect(msg).toBe("Modello AI non trovato. Contatta l'amministratore.");
  });

  it('maps 503 to service unavailable message', () => {
    const msg = mapStreamErrorToUserMessage('503 Service Unavailable from upstream');
    expect(msg).toBe('Servizio AI temporaneamente non disponibile. Riprova tra qualche minuto.');
  });

  it('maps Ollama 500 error to local model message', () => {
    const msg = mapStreamErrorToUserMessage('Ollama API error: 500 Internal Server Error');
    expect(msg).toBe('Il modello locale non è disponibile al momento. Prova un altro modello.');
  });

  it('returns generic message for plain 500 without Ollama prefix', () => {
    const msg = mapStreamErrorToUserMessage('500 Internal Server Error from vLLM');
    expect(msg).toBe('An error occurred while processing your request.');
  });
});
