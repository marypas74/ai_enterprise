import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDocumentCommands } from '../../../src/modules/documents/DocumentCommands';
import { DocumentService } from '../../../src/modules/documents/DocumentService';
import { createMockOutputChannel } from '../../setup';
import { EventBus } from '../../../src/core/EventBus';

const mockShowQuickPick = vi.fn();
const mockShowInputBox = vi.fn();
const mockShowSaveDialog = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockRegisterCommand = vi.fn().mockReturnValue({ dispose: () => {} });

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (...args: unknown[]) => mockRegisterCommand(...args),
    executeCommand: vi.fn(),
  },
  window: {
    showQuickPick: (...args: unknown[]) => mockShowQuickPick(...args),
    showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
    showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args),
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
    withProgress: vi.fn((_opts: unknown, task: () => Promise<void>) => task()),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    fs: {
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
  },
  ProgressLocation: {
    Notification: 15,
  },
}));

describe('DocumentCommands', () => {
  let documentService: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    const eventBus = new EventBus();
    const apiClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    } as unknown as Parameters<typeof DocumentService['prototype']['constructor']>[0];
    const outputChannel = createMockOutputChannel();
    documentService = new DocumentService(apiClient as any, eventBus, outputChannel);
  });

  it('should register generateDocument command', () => {
    const disposables = registerDocumentCommands(documentService);
    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'enterprise-ai.generateDocument',
      expect.any(Function),
    );
    expect(disposables.length).toBeGreaterThan(0);
  });

  it('should show format quick pick when command is invoked', async () => {
    mockShowQuickPick.mockResolvedValue({ label: 'DOCX', format: 'docx' });
    mockShowInputBox.mockResolvedValue('Generate a monthly report');
    mockShowSaveDialog.mockResolvedValue({ fsPath: '/tmp/report.docx' });

    registerDocumentCommands(documentService);
    const commandHandler = mockRegisterCommand.mock.calls[0][1];
    await commandHandler();

    expect(mockShowQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'DOCX' }),
        expect.objectContaining({ label: 'Excel' }),
        expect.objectContaining({ label: 'PowerPoint' }),
        expect.objectContaining({ label: 'PDF' }),
      ]),
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
  });

  it('should abort if user cancels format selection', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    registerDocumentCommands(documentService);
    const commandHandler = mockRegisterCommand.mock.calls[0][1];
    await commandHandler();

    expect(mockShowInputBox).not.toHaveBeenCalled();
  });

  it('should abort if user cancels content input', async () => {
    mockShowQuickPick.mockResolvedValue({ label: 'DOCX', format: 'docx' });
    mockShowInputBox.mockResolvedValue(undefined);

    registerDocumentCommands(documentService);
    const commandHandler = mockRegisterCommand.mock.calls[0][1];
    await commandHandler();

    expect(mockShowSaveDialog).not.toHaveBeenCalled();
  });
});
