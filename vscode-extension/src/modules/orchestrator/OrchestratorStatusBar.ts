import * as vscode from 'vscode';
import type { OrchestratorService } from './OrchestratorService';
import type { ConfigService } from '../../core/ConfigService';
import type { EventBus } from '../../core/EventBus';

export class OrchestratorStatusBar {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBarItem.command = 'enterprise-ai.openOrchestrator';
    this.statusBarItem.tooltip = 'Orchestrator Status';

    this.disposables.push(
      this.eventBus.on('auth:login', () => {
        if (this.configService.getOrchestratorShowStatusBar()) {
          this.statusBarItem.show();
          this.orchestratorService.startPolling();
        }
      }),
    );

    this.disposables.push(
      this.eventBus.on('auth:logout', () => {
        this.statusBarItem.hide();
        this.orchestratorService.stopPolling();
      }),
    );

    this.disposables.push(
      this.eventBus.on('orchestrator:update', ({ activeSlots, totalSlots }) => {
        this.updateDisplay(activeSlots, totalSlots);
      }),
    );

    this.disposables.push(
      this.eventBus.on('config:changed', () => {
        const show = this.configService.getOrchestratorShowStatusBar();
        if (show) {
          this.statusBarItem.show();
        } else {
          this.statusBarItem.hide();
        }
      }),
    );
  }

  onPanelOpened(): void {
    this.orchestratorService.stopPolling();
  }

  onPanelClosed(): void {
    this.orchestratorService.startPolling();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.statusBarItem.dispose();
  }

  private updateDisplay(activeSlots: number, totalSlots: number): void {
    this.statusBarItem.text = `$(pulse) ${activeSlots}/${totalSlots} slots`;
    const usage = totalSlots > 0 ? activeSlots / totalSlots : 0;

    if (usage > 0.8) {
      this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (usage >= 0.5) {
      this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.color = undefined;
    }
  }
}
