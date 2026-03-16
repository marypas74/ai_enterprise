import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerChatCommands } from '../../../src/modules/chat/ChatCommands';
import type { ModuleContext } from '../../../src/core/types';
import { EventBus } from '../../../src/core/EventBus';
import { createMockExtensionContext, createMockOutputChannel } from '../../setup';
import * as vscode from 'vscode';

const mockRegisterCommand = vi.fn().mockReturnValue({ dispose: () => {} });
const mockShowInputBox = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockExecuteCommand = vi.fn();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (...args: unknown[]) => mockRegisterCommand(...args),
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
  window: {
    showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
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

describe('ChatCommands integration', () => {
  let context: ModuleContext;
  let mockPanel: { show: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
  let getPanel: () => typeof mockPanel;

  beforeEach(() => {
    vi.clearAllMocks();
    const eventBus = new EventBus();

    context = {
      extensionContext: createMockExtensionContext(),
      apiClient: {} as ModuleContext['apiClient'],
      authService: {
        login: vi.fn().mockResolvedValue(true),
        logout: vi.fn(),
        getUser: vi.fn(),
        isAuthenticated: vi.fn(),
      } as unknown as ModuleContext['authService'],
      configService: {} as ModuleContext['configService'],
      eventBus,
      outputChannel: createMockOutputChannel(),
    };

    mockPanel = {
      show: vi.fn(),
      postMessage: vi.fn(),
    };
    getPanel = () => mockPanel as any;
  });

  it('should register openChat command', () => {
    registerChatCommands(context, getPanel as any);

    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'enterprise-ai.openChat',
      expect.any(Function),
    );
  });

  it('should open panel on openChat', () => {
    registerChatCommands(context, getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.openChat',
    )![1];
    handler();

    expect(mockPanel.show).toHaveBeenCalled();
  });

  it('should register login and logout commands', () => {
    registerChatCommands(context, getPanel as any);

    const registeredCommands = mockRegisterCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(registeredCommands).toContain('enterprise-ai.login');
    expect(registeredCommands).toContain('enterprise-ai.logout');
  });

  it('should call authService.logout on logout command', () => {
    registerChatCommands(context, getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.logout',
    )![1];
    handler();

    expect(context.authService.logout).toHaveBeenCalled();
  });

  it('should register addToChat command', () => {
    registerChatCommands(context, getPanel as any);

    const registeredCommands = mockRegisterCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(registeredCommands).toContain('enterprise-ai.addToChat');
  });

  it('should not crash addToChat with no active editor', () => {
    (vscode.window as any).activeTextEditor = undefined;

    registerChatCommands(context, getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.addToChat',
    )![1];

    // Should not throw
    expect(() => handler()).not.toThrow();
    expect(mockPanel.show).not.toHaveBeenCalled();
  });

  it('should send context to panel when addToChat has selection', () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: vi.fn().mockReturnValue('selected code'),
        fileName: '/test/file.ts',
      },
      selection: { start: { line: 0 }, end: { line: 1 } },
    };

    registerChatCommands(context, getPanel as any);

    const handler = mockRegisterCommand.mock.calls.find(
      (call: unknown[]) => call[0] === 'enterprise-ai.addToChat',
    )![1];
    handler();

    expect(mockPanel.show).toHaveBeenCalled();
    expect(mockPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'addContext',
        payload: expect.objectContaining({
          text: 'selected code',
          fileName: '/test/file.ts',
        }),
      }),
    );
  });

  it('should register showLogs and configure commands', () => {
    registerChatCommands(context, getPanel as any);

    const registeredCommands = mockRegisterCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(registeredCommands).toContain('enterprise-ai.showLogs');
    expect(registeredCommands).toContain('enterprise-ai.configure');
  });
});
