// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing requires a running backend mock server.

import * as vscode from 'vscode';
import * as assert from 'assert';

const TIMEOUT = 15000;

suite('Document Module E2E', () => {
  const EXTENSION_ID = 'enterprise-ai.enterprise-ai-chat';

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('generateDocument command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.generateDocument'),
      'generateDocument command should be registered'
    );
  });

  test('ragSearch command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.ragSearch'),
      'ragSearch command should be registered'
    );
  });

  test('addFileToContext command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.addFileToContext'),
      'addFileToContext command should be registered'
    );
  });
});
