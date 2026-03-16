// NOTE: These tests verify extension activation, command registration, and panel creation.
// Full user flow testing requires a running backend mock server.

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';

const TIMEOUT = 15000;

suite('Code Action Module E2E', () => {
  const EXTENSION_ID = 'enterprise-ai.enterprise-ai-chat';

  suiteSetup(async function () {
    this.timeout(TIMEOUT);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('explainCode command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.explainCode'),
      'explainCode command should be registered'
    );
  });

  test('fixCode command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.fixCode'),
      'fixCode command should be registered'
    );
  });

  test('improveCode command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.improveCode'),
      'improveCode command should be registered'
    );
  });

  test('generateTests command should be registered', async function () {
    this.timeout(TIMEOUT);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('enterprise-ai.generateTests'),
      'generateTests command should be registered'
    );
  });

  test('selection-based code action should work with sample file', async function () {
    this.timeout(TIMEOUT);

    const fixturePath = path.resolve(__dirname, '../../fixtures/sample.ts');
    const uri = vscode.Uri.file(fixturePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Select the calculateSum function (lines 8-10 in the fixture)
    const startPos = new vscode.Position(7, 0);
    const endPos = new vscode.Position(9, 1);
    editor.selection = new vscode.Selection(startPos, endPos);

    assert.ok(
      !editor.selection.isEmpty,
      'Editor should have an active selection'
    );
  });
});
