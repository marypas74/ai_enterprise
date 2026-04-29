/**
 * Tests for the v2.1.64 `is_manually_enabled` flag in LLMSyncWorker.
 *
 * Behaviour under test (private method `disableIncompatibleModels`):
 *   - A model whose model_id is NOT chat-completions-compatible AND
 *     is_manually_enabled=true must NOT be auto-disabled.
 *   - A model that is incompatible AND not manually enabled MUST be disabled.
 *   - A model that is compatible AND was previously auto-disabled (not by admin)
 *     must still be re-enabled — the new flag does not break the existing path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMSyncWorker } from './LLMSyncWorker.js';

// Mock the chat-completions filter to a deterministic shape
vi.mock('./LLMSyncWorker.filter.js', () => ({
  isChatCompletionsCompatible: (id: string) => !id.startsWith('audio-') && !id.includes('tts'),
}));

// Mock database helpers
const findAllMock = vi.fn();
vi.mock('../database/index.js', () => ({
  findAll: (...args: any[]) => findAllMock(...args),
  findOne: vi.fn(),
}));

describe('LLMSyncWorker.disableIncompatibleModels — is_manually_enabled', () => {
  let executeMock: ReturnType<typeof vi.fn>;
  let worker: LLMSyncWorker;
  let logInfo: ReturnType<typeof vi.fn>;
  let logDebug: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findAllMock.mockReset();
    executeMock = vi.fn().mockResolvedValue([{}, {}]);
    logInfo = vi.fn();
    logDebug = vi.fn();
    const fakeFastify: any = {
      db: { execute: executeMock },
      log: { info: logInfo, debug: logDebug, warn: vi.fn(), error: vi.fn() },
    };
    worker = new LLMSyncWorker(fakeFastify);
  });

  it('does NOT auto-disable an incompatible model that is_manually_enabled=true', async () => {
    findAllMock.mockResolvedValue([
      // Incompatible (audio-*) but admin-forced — must remain enabled.
      { id: 1, model_id: 'audio-realtime-v1', is_enabled: true, is_manually_disabled: false, is_manually_enabled: true },
    ]);

    // Invoke the private method via cast (test seam)
    await (worker as any).disableIncompatibleModels([{ id: 10 }]);

    expect(executeMock).not.toHaveBeenCalled();
    expect(logDebug).toHaveBeenCalledWith(
      expect.stringContaining('Skipped auto-disable for admin-forced model')
    );
  });

  it('auto-disables an incompatible model when is_manually_enabled=false', async () => {
    findAllMock.mockResolvedValue([
      { id: 2, model_id: 'audio-tts-1', is_enabled: true, is_manually_disabled: false, is_manually_enabled: false },
    ]);

    await (worker as any).disableIncompatibleModels([{ id: 10 }]);

    expect(executeMock).toHaveBeenCalledWith(
      'UPDATE ai_models SET is_enabled = FALSE WHERE id = ?',
      [2]
    );
  });

  it('still re-enables a compatible, previously auto-disabled model', async () => {
    findAllMock.mockResolvedValue([
      { id: 3, model_id: 'gpt-4o-mini', is_enabled: false, is_manually_disabled: false, is_manually_enabled: false },
    ]);

    await (worker as any).disableIncompatibleModels([{ id: 10 }]);

    expect(executeMock).toHaveBeenCalledWith(
      'UPDATE ai_models SET is_enabled = TRUE WHERE id = ?',
      [3]
    );
  });

  it('does NOT touch a model the admin manually disabled even if compatible', async () => {
    findAllMock.mockResolvedValue([
      { id: 4, model_id: 'gpt-4o', is_enabled: false, is_manually_disabled: true, is_manually_enabled: false },
    ]);

    await (worker as any).disableIncompatibleModels([{ id: 10 }]);

    expect(executeMock).not.toHaveBeenCalled();
  });
});
