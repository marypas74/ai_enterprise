import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '../../src/core/ConfigService';
import { EventBus } from '../../src/core/EventBus';
import { DEFAULTS } from '../../src/utils/constants';

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
