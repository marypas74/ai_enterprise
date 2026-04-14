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
});
