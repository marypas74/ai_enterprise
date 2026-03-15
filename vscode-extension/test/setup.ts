import * as vscode from 'vscode';

export function createMockExtensionContext(): vscode.ExtensionContext {
  const globalState = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: (key: string) => globalState.get(key),
      update: (key: string, value: unknown) => {
        globalState.set(key, value);
        return Promise.resolve();
      },
      keys: () => [...globalState.keys()],
      setKeysForSync: () => {},
    },
    extensionPath: '/mock/extension',
    extensionUri: vscode.Uri.file('/mock/extension'),
  } as unknown as vscode.ExtensionContext;
}

export function createMockOutputChannel(): vscode.OutputChannel {
  return {
    name: 'Test',
    append: () => {},
    appendLine: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
    replace: () => {},
  } as vscode.OutputChannel;
}
