import * as vscode from 'vscode';
import { CONFIG_SECTION, CONFIG_KEYS, DEFAULTS } from '../utils/constants';
import type { EventBus } from './EventBus';

export class ConfigService {
  private readonly disposable: vscode.Disposable;

  constructor(private readonly eventBus: EventBus) {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        this.eventBus.emit('config:changed', {
          key: CONFIG_SECTION,
          value: this.getAll(),
        });
      }
    });
  }

  getServerUrl(): string {
    return this.get<string>(CONFIG_KEYS.SERVER_URL, DEFAULTS.SERVER_URL);
  }

  getAllowSelfSigned(): boolean {
    return this.get<boolean>(CONFIG_KEYS.ALLOW_SELF_SIGNED, DEFAULTS.ALLOW_SELF_SIGNED);
  }

  getBotIconStyle(): string {
    return this.get<string>(CONFIG_KEYS.BOT_ICON_STYLE, 'default');
  }

  getOrchestratorPollingInterval(): number {
    return this.get<number>(CONFIG_KEYS.ORCHESTRATOR_POLLING, DEFAULTS.ORCHESTRATOR_POLLING);
  }

  getOrchestratorShowStatusBar(): boolean {
    return this.get<boolean>(CONFIG_KEYS.ORCHESTRATOR_SHOW, DEFAULTS.ORCHESTRATOR_SHOW);
  }

  getWorktreePollingInterval(): number {
    return this.get<number>(CONFIG_KEYS.WORKTREE_POLLING, DEFAULTS.WORKTREE_POLLING);
  }

  private get<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, defaultValue);
  }

  private getAll(): Record<string, unknown> {
    return {
      serverUrl: this.getServerUrl(),
      allowSelfSigned: this.getAllowSelfSigned(),
      botIconStyle: this.getBotIconStyle(),
      orchestratorPolling: this.getOrchestratorPollingInterval(),
      orchestratorShow: this.getOrchestratorShowStatusBar(),
      worktreePolling: this.getWorktreePollingInterval(),
    };
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
