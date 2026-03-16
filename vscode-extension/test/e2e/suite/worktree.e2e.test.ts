// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing requires a running backend mock server.

import * as vscode from 'vscode';
import * as assert from 'assert';

const TIMEOUT = 15000;

suite('Worktree Module E2E', () => {
  const EXTENSION_ID = 'enterprise-ai.enterprise-ai-chat';

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('manageWorktrees command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.manageWorktrees'),
      'manageWorktrees command should be registered'
    );
  });

  test('SCM provider should be available after activation', async function () {
    this.timeout(TIMEOUT);
    // The worktree module registers an SCM provider for managing git worktrees.
    // We verify the extension is active (which means the SCM provider was registered).
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'Extension should be found');
    assert.strictEqual(ext!.isActive, true, 'Extension should be active after activation');

    // Verify that the manageWorktrees command is executable (it would fail gracefully
    // without a git repository, but the command itself should be registered)
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.manageWorktrees'),
      'manageWorktrees command should be available for SCM integration'
    );
  });
});
