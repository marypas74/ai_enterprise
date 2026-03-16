import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCodeActionCommands } from '../../../src/modules/code-actions/CodeActionCommands';
import * as vscode from 'vscode';

const mockRegisterCommand = vi.fn().mockReturnValue({ dispose: () => {} });
const mockShowWarningMessage = vi.fn();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (...args: unknown[]) => mockRegisterCommand(...args),
  },
  window: {
    showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    activeTextEditor: undefined as unknown,
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p })),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      scheme: 'file',
      path: [base.fsPath, ...segments].join('/'),
    }),
  },
  ViewColumn: { Beside: -2 },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
  },
}));

describe('CodeActionCommands integration', () => {
  let mockPanel: { show: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
  let getPanel: () => typeof mockPanel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPanel = {
      show: vi.fn(),
      postMessage: vi.fn(),
    };
    getPanel = () => mockPanel as any;
  });

  it('should register all 4 code action commands', () => {
    const disposables = registerCodeActionCommands(getPanel as any);

    const registeredCommands = mockRegisterCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(registeredCommands).toContain('enterprise-ai.explainCode');
    expect(registeredCommands).toContain('enterprise-ai.fixCode');
    expect(registeredCommands).toContain('enterprise-ai.improveCode');
    expect(registeredCommands).toContain('enterprise-ai.generateTests');
    expect(disposables).toHaveLength(4);
  });

  it('should show warning when no code selected', () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue(''),
        fileName: '/test/file.ts',
        languageId: 'typescript',
      },
      selection: {},
    };

    registerCodeActionCommands(getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.explainCode',
    )![1];
    handler();

    expect(mockShowWarningMessage).toHaveBeenCalledWith('Select code first');
    expect(mockPanel.show).not.toHaveBeenCalled();
  });

  it('should open panel and prefill message for explainCode', () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue('const x = 1;'),
        fileName: '/test/file.ts',
        languageId: 'typescript',
      },
      selection: {},
    };

    registerCodeActionCommands(getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.explainCode',
    )![1];
    handler();

    expect(mockPanel.show).toHaveBeenCalled();
    expect(mockPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'prefillMessage',
        payload: expect.objectContaining({
          text: expect.stringContaining('Explain the following code'),
        }),
      }),
    );
  });

  it('should include language id in code block', () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue('def hello(): pass'),
        fileName: '/test/file.py',
        languageId: 'python',
      },
      selection: {},
    };

    registerCodeActionCommands(getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.explainCode',
    )![1];
    handler();

    const sentPayload = mockPanel.postMessage.mock.calls[0][0].payload.text;
    expect(sentPayload).toContain('```python');
  });

  it('should not open panel when no active editor', () => {
    (vscode.window as any).activeTextEditor = undefined;

    registerCodeActionCommands(getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.explainCode',
    )![1];
    handler();

    expect(mockPanel.show).not.toHaveBeenCalled();
    expect(mockShowWarningMessage).not.toHaveBeenCalled();
  });
});
