// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing requires a running backend mock server.

import * as vscode from 'vscode';
import * as assert from 'assert';

const TIMEOUT = 15000;

suite('Orchestrator Module E2E', () => {
  const EXTENSION_ID = 'enterprise-ai.enterprise-ai-chat';

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('openOrchestrator command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.openOrchestrator'),
      'openOrchestrator command should be registered'
    );
  });

  test('openOrchestrator command should create a panel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.openOrchestrator');

    await new Promise(resolve => setTimeout(resolve, 1000));

    const tabGroups = vscode.window.tabGroups;
    const hasOrchestratorTab = tabGroups.all.some(group =>
      group.tabs.some(tab =>
        tab.label.toLowerCase().includes('orchestrator') ||
        tab.label.toLowerCase().includes('enterprise')
      )
    );
    assert.ok(hasOrchestratorTab, 'An orchestrator panel should have been created');
  });

  test('orchestrator polling interval config should exist', function () {
    this.timeout(TIMEOUT);
    const config = vscode.workspace.getConfiguration('enterprise-ai');
    const pollingInterval = config.get<number>('orchestrator.pollingInterval');
    assert.strictEqual(
      pollingInterval,
      10000,
      'Default polling interval should be 10000ms'
    );
  });

  test('orchestrator showStatusBar config should exist', function () {
    this.timeout(TIMEOUT);
    const config = vscode.workspace.getConfiguration('enterprise-ai');
    const showStatusBar = config.get<boolean>('orchestrator.showStatusBar');
    assert.strictEqual(
      showStatusBar,
      true,
      'Default showStatusBar should be true'
    );
  });
});
