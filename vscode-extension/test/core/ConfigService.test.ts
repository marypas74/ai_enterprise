import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';
import { DEFAULTS } from '../../src/utils/constants';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((key: string, defaultValue: unknown) => defaultValue),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('ConfigService', () => {
  let configService: ConfigService;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    configService = new ConfigService(eventBus);
  });

  it('should return default server URL', () => {
    expect(configService.getServerUrl()).toBe(DEFAULTS.SERVER_URL);
  });

  it('should return default allowSelfSigned', () => {
    expect(configService.getAllowSelfSigned()).toBe(DEFAULTS.ALLOW_SELF_SIGNED);
  });

  it('should return orchestrator polling interval', () => {
    expect(configService.getOrchestratorPollingInterval()).toBe(DEFAULTS.ORCHESTRATOR_POLLING);
  });

  it('should return orchestrator show status bar', () => {
    expect(configService.getOrchestratorShowStatusBar()).toBe(DEFAULTS.ORCHESTRATOR_SHOW);
  });
});

describe('ConfigService — edge cases', () => {
  let eventBus: EventBus;
  let changeHandler: ((e: { affectsConfiguration: (section: string) => boolean }) => void) | null;

  beforeEach(() => {
    changeHandler = null;
    // Capture the onDidChangeConfiguration callback
    (vscode.workspace.onDidChangeConfiguration as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (e: { affectsConfiguration: (section: string) => boolean }) => void) => {
        changeHandler = handler;
        return { dispose: vi.fn() };
      },
    );
    // Restore default getConfiguration mock
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
    });
    eventBus = new EventBus();
  });

  it('should emit config:changed when enterprise-ai config changes', () => {
    const listener = vi.fn();
    eventBus.on('config:changed', listener);
    new ConfigService(eventBus);
    changeHandler?.({ affectsConfiguration: (section: string) => section === 'enterprise-ai' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'enterprise-ai' }),
    );
  });

  it('should NOT emit config:changed for unrelated config sections', () => {
    const listener = vi.fn();
    eventBus.on('config:changed', listener);
    new ConfigService(eventBus);
    changeHandler?.({ affectsConfiguration: (section: string) => section === 'editor' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('should return custom server URL when configured', () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string, defaultValue: unknown) => {
        if (key === 'serverUrl') { return 'https://custom.example.com'; }
        return defaultValue;
      }),
    });
    const configService = new ConfigService(eventBus);
    expect(configService.getServerUrl()).toBe('https://custom.example.com');
  });

  it('should clean up disposable on dispose()', () => {
    const disposeFn = vi.fn();
    (vscode.workspace.onDidChangeConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose: disposeFn,
    });
    const configService = new ConfigService(eventBus);
    configService.dispose();
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });
});
