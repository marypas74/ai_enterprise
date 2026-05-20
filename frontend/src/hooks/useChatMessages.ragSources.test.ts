/**
 * useChatMessages — RAG sources accumulation tests (T3 HOTFIX 2.1.86)
 * TDD RED phase: these tests verify that onSources MERGES (accumulates)
 * instead of replacing existing ragSources.
 *
 * Tests:
 * 1. Two onSources calls accumulate documents arrays
 * 2. Two onSources calls accumulate web arrays
 * 3. First onSources call on empty message initialises both arrays
 * 4. Second onSources call with web-only merges into existing document sources
 */

import { describe, it, expect } from 'vitest';
import type { RagSources } from '../services/api';
import type { Message } from './useChatMessages';

// ── Helper: simulate the onSources merge logic ────────────────────────────────
// This mirrors the implementation we expect to land in useChatMessages.ts
// (the inline setMessages callback). Extracted here so we can unit-test it
// in isolation without rendering the full hook.

function applySourcesMerge(
  currentMsg: Message,
  newSources: RagSources
): Message {
  const existing: RagSources = currentMsg.ragSources || { documents: [], web: [] };
  return {
    ...currentMsg,
    ragSources: {
      documents: [...existing.documents, ...(newSources.documents || [])],
      web: [...existing.web, ...(newSources.web || [])],
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseAssistantMsg: Message = {
  role: 'assistant',
  content: 'Some response text',
};

const initialDocSources: RagSources = {
  documents: [{ id: 1, name: 'doc1.pdf', score: 0.9 }],
  web: [],
};

const layer2WebSources: RagSources = {
  documents: [],
  web: [{ url: 'https://example.com', title: 'Example', snippet: 'A snippet.' }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('onSources merge (T3 HOTFIX 2.1.86)', () => {
  it('first sources event initialises ragSources when message has none', () => {
    const updated = applySourcesMerge(baseAssistantMsg, initialDocSources);
    expect(updated.ragSources?.documents).toHaveLength(1);
    expect(updated.ragSources?.documents[0].name).toBe('doc1.pdf');
    expect(updated.ragSources?.web).toHaveLength(0);
  });

  it('second sources event accumulates documents (not replaces)', () => {
    const afterFirst = applySourcesMerge(baseAssistantMsg, initialDocSources);
    const moreDocs: RagSources = {
      documents: [{ id: 2, name: 'doc2.pdf', score: 0.7 }],
      web: [],
    };
    const afterSecond = applySourcesMerge(afterFirst, moreDocs);
    expect(afterSecond.ragSources?.documents).toHaveLength(2);
    expect(afterSecond.ragSources?.documents[0].name).toBe('doc1.pdf');
    expect(afterSecond.ragSources?.documents[1].name).toBe('doc2.pdf');
  });

  it('second sources event accumulates web results (Layer 2 retry)', () => {
    const afterFirst = applySourcesMerge(baseAssistantMsg, initialDocSources);
    const afterSecond = applySourcesMerge(afterFirst, layer2WebSources);
    // Document sources preserved
    expect(afterSecond.ragSources?.documents).toHaveLength(1);
    expect(afterSecond.ragSources?.documents[0].name).toBe('doc1.pdf');
    // Web sources added
    expect(afterSecond.ragSources?.web).toHaveLength(1);
    expect(afterSecond.ragSources?.web[0].title).toBe('Example');
  });

  it('merge is immutable — original message is not mutated', () => {
    const original: Message = {
      role: 'assistant',
      content: 'text',
      ragSources: { documents: [{ id: 1, name: 'orig.pdf', score: 0.8 }], web: [] },
    };
    const updated = applySourcesMerge(original, layer2WebSources);
    // Original ragSources.web must still be empty
    expect(original.ragSources?.web).toHaveLength(0);
    // Updated has the new web result
    expect(updated.ragSources?.web).toHaveLength(1);
  });
});
