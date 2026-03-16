// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing requires a running backend mock server.

import * as vscode from 'vscode';
import * as assert from 'assert';

const TIMEOUT = 15000;

suite('Chat Module E2E', () => {
  const EXTENSION_ID = 'enterprise-ai.enterprise-ai-chat';

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('extension should activate successfully', async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'Extension should be found');
    assert.strictEqual(ext!.isActive, true, 'Extension should be active');
  });

  test('openChat command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.openChat'),
      'openChat command should be registered'
    );
  });

  test('login command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.login'),
      'login command should be registered'
    );
  });

  test('logout command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.logout'),
      'logout command should be registered'
    );
  });

  test('newChat command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.newChat'),
      'newChat command should be registered'
    );
  });

  test('showLogs command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.showLogs'),
      'showLogs command should be registered'
    );
  });

  test('openChat command should create a webview panel', async function () {
    this.timeout(TIMEOUT);
    await vscode.commands.executeCommand('enterprise-ai.openChat');

    // Give the panel a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify a webview panel was created by checking active tab groups
    const tabGroups = vscode.window.tabGroups;
    const hasWebviewTab = tabGroups.all.some(group =>
      group.tabs.some(tab => tab.label.toLowerCase().includes('chat') || tab.label.toLowerCase().includes('enterprise'))
    );
    assert.ok(hasWebviewTab, 'A chat panel should have been created');
  });
});
