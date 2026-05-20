/**
 * ChatStreamRunner.test.ts — DEBT-81-IMMUT + CRITICAL-2
 *
 * Verifica che runChatStream restituisca delta immutabili invece di mutare
 * lo state in-place. Lo state del caller deve essere aggiornato tramite
 * accumulo immutabile (spread/reassign), non tramite mutation diretta.
 *
 * CRITICAL-2: applyStreamRoundDelta deve SOMMARE i token, non sostituire.
 * Copertura semantica per:
 *   - usage per-round (Anthropic): ogni round emette delta parziali
 *   - usage running-total (OpenAI): chunk intermedi emettono 0, chunk finale emette totale
 */
import { describe, it, expect, vi } from 'vitest';
import { runChatStream, applyStreamRoundDelta, createStreamState, type StreamChunk } from './ChatStreamRunner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function* makeStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

function makeOpts(
  stream: AsyncIterable<StreamChunk>,
  state = createStreamState(),
) {
  const writes: string[] = [];
  return {
    opts: {
      stream,
      streamStartTime: Date.now(),
      clientDisconnected: () => false,
      sseWrite: (e: string) => { writes.push(e); },
      rawWrite: (e: string) => { writes.push(e); },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      userId: 1,
      state,
    },
    writes,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChatStreamRunner — DEBT-81-IMMUT delta-based state', () => {
  it('runChatStream returns roundContent with streamed text', async () => {
    const chunks: StreamChunk[] = [
      { content: 'Hello ' },
      { content: 'world' },
    ];
    const { opts } = makeOpts(makeStream(chunks));
    const result = await runChatStream(opts);
    expect(result.roundContent).toBe('Hello world');
  });

  it('runChatStream returns deltaTokensInput from usage chunk', async () => {
    const chunks: StreamChunk[] = [
      { usage: { inputTokens: 42, outputTokens: 17 } },
      { content: 'test' },
    ];
    const { opts } = makeOpts(makeStream(chunks));
    const result = await runChatStream(opts);
    expect(result.deltaTokensInput).toBe(42);
    expect(result.deltaTokensOutput).toBe(17);
  });

  it('runChatStream returns deltaContent length matching roundContent', async () => {
    const chunks: StreamChunk[] = [
      { content: 'abc' },
      { content: 'def' },
    ];
    const { opts } = makeOpts(makeStream(chunks));
    const result = await runChatStream(opts);
    expect(result.deltaContent).toBe('abcdef');
    expect(result.roundContent).toBe(result.deltaContent);
  });

  it('runChatStream does NOT mutate the passed state object', async () => {
    const state = createStreamState();
    const originalRef = state;
    const chunks: StreamChunk[] = [
      { usage: { inputTokens: 10, outputTokens: 5 } },
      { content: 'hi' },
    ];
    const { opts } = makeOpts(makeStream(chunks), state);
    await runChatStream(opts);
    // State reference must be unchanged — runChatStream must NOT mutate it
    expect(opts.state).toBe(originalRef);
    expect(opts.state.tokensInput).toBe(0);
    expect(opts.state.tokensOutput).toBe(0);
  });

  it('caller accumulates delta immutably (spread pattern)', async () => {
    const chunks: StreamChunk[] = [
      { usage: { inputTokens: 20, outputTokens: 8 } },
      { content: 'response' },
    ];
    const state = createStreamState();
    const { opts } = makeOpts(makeStream(chunks), state);
    const result = await runChatStream(opts);

    // Caller accumulates via immutable spread — no mutation of original state
    const updatedState = {
      ...state,
      tokensInput: state.tokensInput + (result.deltaTokensInput ?? 0),
      tokensOutput: state.tokensOutput + (result.deltaTokensOutput ?? 0),
    };

    expect(state.tokensInput).toBe(0); // original unchanged
    expect(updatedState.tokensInput).toBe(20); // new value in new object
    expect(updatedState.tokensOutput).toBe(8);
  });

  it('runChatStream returns isComplete=true when stream ends normally', async () => {
    const chunks: StreamChunk[] = [{ content: 'done' }];
    const { opts } = makeOpts(makeStream(chunks));
    const result = await runChatStream(opts);
    expect(result.isComplete).toBe(true);
  });

  it('runChatStream returns isComplete=false when client disconnects', async () => {
    // Stream that produces content but client disconnects after first chunk
    let yielded = 0;
    async function* slowStream(): AsyncIterable<StreamChunk> {
      yield { content: 'first' };
      yielded++;
      yield { content: 'second' };
      yielded++;
    }
    const state = createStreamState();
    let disconnected = false;
    const opts = {
      stream: slowStream(),
      streamStartTime: Date.now(),
      clientDisconnected: () => {
        // Disconnect after first chunk processed
        if (yielded >= 1) disconnected = true;
        return disconnected;
      },
      sseWrite: vi.fn(),
      rawWrite: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      userId: 1,
      state,
    };
    const result = await runChatStream(opts);
    expect(result.isComplete).toBe(false);
  });

  it('runChatStream accumulates tool calls and returns them', async () => {
    const chunks: StreamChunk[] = [
      { toolCalls: [{ id: 'tc1', function: { name: 'my_tool', arguments: '' } }] },
      { toolCalls: [{ function: { arguments: '{"a":1}' } }] },
    ];
    const { opts } = makeOpts(makeStream(chunks));
    const result = await runChatStream(opts);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('my_tool');
    expect(result.toolCalls[0].arguments).toBe('{"a":1}');
  });

  it('createStreamState returns a default zero state', () => {
    const s = createStreamState();
    expect(s.tokensInput).toBe(0);
    expect(s.tokensOutput).toBe(0);
    expect(s.firstTokenMs).toBeNull();
  });
});

// ─── CRITICAL-2: applyStreamRoundDelta semantica SOMMA ───────────────────────

describe('applyStreamRoundDelta — CRITICAL-2 multi-round accumulation', () => {
  /**
   * Scenario: provider per-round (Anthropic).
   * Round 1 emette 100 input token, round 2 emette 50 input token.
   * Il totale accumulato deve essere 150 (somma), NON 50 (sostituzione).
   */
  it('accumula usage per-round (Anthropic): 100 + 50 = 150 tokensInput', () => {
    const initial = createStreamState();

    const afterRound1 = applyStreamRoundDelta(initial, {
      deltaTokensInput: 100,
      deltaTokensOutput: 40,
      deltaCacheCreationTokens: 0,
      deltaCacheReadTokens: 0,
      deltaThinkingTokens: 0,
      firstTokenMs: 120,
    });

    const afterRound2 = applyStreamRoundDelta(afterRound1, {
      deltaTokensInput: 50,
      deltaTokensOutput: 20,
      deltaCacheCreationTokens: 0,
      deltaCacheReadTokens: 0,
      deltaThinkingTokens: 0,
      firstTokenMs: null,
    });

    // SOMMA: 100 + 50 = 150
    expect(afterRound2.tokensInput).toBe(150);
    expect(afterRound2.tokensOutput).toBe(60);
    // firstTokenMs: preserva il primo valore non-null
    expect(afterRound2.firstTokenMs).toBe(120);
  });

  /**
   * Scenario: provider running-total (OpenAI).
   * Chunk intermedi emettono delta=0 per i token input; il chunk finale emette
   * il running total: 200. Il totale accumulato deve essere 200 (somma con 0s).
   * In un secondo round con delta=300, il totale finale è 500.
   */
  it('accumula running-total (OpenAI): 200 + 300 = 500 tokensInput', () => {
    let state = createStreamState();

    // Chunk intermedi: delta=0 (OpenAI non emette usage nei chunk stream)
    state = applyStreamRoundDelta(state, {
      deltaTokensInput: 0,
      deltaTokensOutput: 0,
      deltaCacheCreationTokens: 0,
      deltaCacheReadTokens: 0,
      deltaThinkingTokens: 0,
      firstTokenMs: 80,
    });
    expect(state.tokensInput).toBe(0); // 0 + 0 = 0 (chunk intermedio)

    // Chunk finale round 1: delta=200 (running total inviato da OpenAI)
    state = applyStreamRoundDelta(state, {
      deltaTokensInput: 200,
      deltaTokensOutput: 80,
      deltaCacheCreationTokens: 0,
      deltaCacheReadTokens: 0,
      deltaThinkingTokens: 0,
      firstTokenMs: null,
    });
    expect(state.tokensInput).toBe(200);

    // Round 2: delta=300
    state = applyStreamRoundDelta(state, {
      deltaTokensInput: 300,
      deltaTokensOutput: 120,
      deltaCacheCreationTokens: 0,
      deltaCacheReadTokens: 0,
      deltaThinkingTokens: 0,
      firstTokenMs: null,
    });
    // SOMMA: 200 + 300 = 500
    expect(state.tokensInput).toBe(500);
    expect(state.tokensOutput).toBe(200);
  });
});
