// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing requires a running backend mock server.

import * as vscode from 'vscode';
import * as assert from 'assert';

const TIMEOUT = 15000;

suite('Agent Module E2E', () => {
  const EXTENSION_ID = 'enterprise-ai.enterprise-ai-chat';

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('newAgentSession command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.newAgentSession'),
      'newAgentSession command should be registered'
    );
  });

  test('viewAgentSessions command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.viewAgentSessions'),
      'viewAgentSessions command should be registered'
    );
  });

  test('newAgentSession command should create a panel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.newAgentSession');

    await new Promise(resolve => setTimeout(resolve, 1000));

    const tabGroups = vscode.window.tabGroups;
    const hasAgentTab = tabGroups.all.some(group =>
      group.tabs.some(tab =>
        tab.label.toLowerCase().includes('agent') ||
        tab.label.toLowerCase().includes('enterprise')
      )
    );
    assert.ok(hasAgentTab, 'An agent session panel should have been created');
  });
});
