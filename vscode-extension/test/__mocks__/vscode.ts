import { vi } from 'vitest';

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
    fsPath: [base.fsPath, ...segments].join('/'),
    scheme: 'file',
    path: [base.fsPath, ...segments].join('/'),
  }),
  parse: (value: string) => ({ fsPath: value, scheme: 'file', path: value }),
};

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
};

export const window = {
  createWebviewPanel: vi.fn(() => ({
    webview: {
      html: '',
      onDidReceiveMessage: vi.fn(),
      postMessage: vi.fn(),
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      cspSource: 'https://test.csp',
    },
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
  })),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  activeTextEditor: undefined,
  createOutputChannel: vi.fn(() => ({
    name: 'Test',
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn(),
  })),
};

export const commands = {
  registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => ({
    dispose: vi.fn(),
  })),
  executeCommand: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
    update: vi.fn(),
    has: vi.fn(),
    inspect: vi.fn(),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const EventEmitter = vi.fn(() => ({
  event: vi.fn(),
  fire: vi.fn(),
  dispose: vi.fn(),
}));

export const Disposable = {
  from: vi.fn((...disposables: { dispose: () => void }[]) => ({
    dispose: () => disposables.forEach((d) => d.dispose()),
  })),
};
