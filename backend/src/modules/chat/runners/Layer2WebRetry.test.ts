/**
 * Layer2WebRetry.test.ts — DEBT-87-C+E TDD
 *
 * Tests:
 *  1. detection: detectNoInfoResponse triggers retry path
 *  2. retry: web results appended to response + streamed
 *  3. no-detection: normal response returns unchanged
 *  4. force_web_search guard: skips when force_web_search=true
 *  5. existing sources guard: skips when existingWebSources non-empty
 *  6. layer2 disabled: skips when rag_layer2_enabled=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock RagWebFallback dependencies
vi.mock('./RagWebFallback.js', () => ({
  detectNoInfoResponse: vi.fn(),
  buildWebSummary: vi.fn(),
  triggerWebFallback: vi.fn(),
  readSettingCached: vi.fn(),
}));

import {
  detectNoInfoResponse,
  buildWebSummary,
  triggerWebFallback,
  readSettingCached,
} from './RagWebFallback.js';

import { runLayer2WebRetry } from './Layer2WebRetry.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpts(overrides: Partial<Parameters<typeof runLayer2WebRetry>[0]> = {}) {
  const captured: string[] = [];
  return {
    fullResponse: 'I don\'t know the answer.',
    body: { message: 'What is Kubernetes?', force_web_search: false },
    sseWrite: (ev: string) => { captured.push(ev); },
    existingWebSources: [],
    fastify: {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    } as unknown as Parameters<typeof runLayer2WebRetry>[0]['fastify'],
    db: {},
    ...overrides,
    _captured: captured,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runLayer2WebRetry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: feature enabled
    vi.mocked(readSettingCached).mockResolvedValue('true');
  });

  it('detection: appends web results when no-info detected', async () => {
    vi.mocked(detectNoInfoResponse).mockReturnValue(true);
    vi.mocked(triggerWebFallback).mockResolvedValue({
      webResults: [{ title: 'K8s docs', url: 'https://k8s.io', snippet: 'K8s is...' }],
    });
    vi.mocked(buildWebSummary).mockReturnValue('**Fonte 1**: [K8s docs](https://k8s.io)\nK8s is...\n');

    const opts = makeOpts();
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toContain('Integrazione dal web');
    expect(result.updatedResponse).toContain(opts.fullResponse);
    expect(result.webResults).toHaveLength(1);
    // SSE write was called
    expect(opts._captured.length).toBeGreaterThan(0);
  });

  it('retry: original response preserved before integration block', async () => {
    vi.mocked(detectNoInfoResponse).mockReturnValue(true);
    vi.mocked(triggerWebFallback).mockResolvedValue({
      webResults: [{ title: 'Example', url: 'https://ex.com', snippet: 'info' }],
    });
    vi.mocked(buildWebSummary).mockReturnValue('summary text');

    const opts = makeOpts({ fullResponse: 'Purtroppo non trovo informazioni.' });
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toMatch(/^Purtroppo non trovo informazioni\./);
  });

  it('no-detection: returns unchanged response when no pattern matched', async () => {
    vi.mocked(detectNoInfoResponse).mockReturnValue(false);

    const opts = makeOpts({ fullResponse: 'Kubernetes is an orchestration platform.' });
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toBe('Kubernetes is an orchestration platform.');
    expect(result.webResults).toHaveLength(0);
    expect(vi.mocked(triggerWebFallback)).not.toHaveBeenCalled();
  });

  it('force_web_search guard: skips when force_web_search=true', async () => {
    const opts = makeOpts({ body: { message: 'query', force_web_search: true } });
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toBe(opts.fullResponse);
    expect(vi.mocked(detectNoInfoResponse)).not.toHaveBeenCalled();
  });

  it('existing sources guard: skips when existingWebSources non-empty', async () => {
    const opts = makeOpts({
      existingWebSources: [{ metadata: { type: 'web_search', url: 'https://x.com' } }],
    });
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toBe(opts.fullResponse);
    expect(vi.mocked(detectNoInfoResponse)).not.toHaveBeenCalled();
  });

  it('layer2 disabled: skips when rag_layer2_enabled=false', async () => {
    vi.mocked(readSettingCached).mockResolvedValue('false');

    const opts = makeOpts();
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toBe(opts.fullResponse);
    expect(vi.mocked(detectNoInfoResponse)).not.toHaveBeenCalled();
  });

  it('triggerWebFallback returns empty: response unchanged', async () => {
    vi.mocked(detectNoInfoResponse).mockReturnValue(true);
    vi.mocked(triggerWebFallback).mockResolvedValue({ webResults: [] });

    const opts = makeOpts();
    const result = await runLayer2WebRetry(opts);

    expect(result.updatedResponse).toBe(opts.fullResponse);
    expect(result.webResults).toHaveLength(0);
  });
});
