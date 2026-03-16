import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDocumentCommands } from '../../../src/modules/documents/DocumentCommands';
import type { DocumentService } from '../../../src/modules/documents/DocumentService';

const mockShowQuickPick = vi.fn();
const mockShowInputBox = vi.fn();
const mockShowSaveDialog = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockRegisterCommand = vi.fn().mockReturnValue({ dispose: () => {} });
const mockExecuteCommand = vi.fn();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (...args: unknown[]) => mockRegisterCommand(...args),
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
  window: {
    showQuickPick: (...args: unknown[]) => mockShowQuickPick(...args),
    showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
    showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args),
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
    withProgress: (...args: unknown[]) => mockWithProgress(...args),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((_k: string, d: unknown) => d),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
    fs: {
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
    },
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
  },
  ProgressLocation: {
    Notification: 15,
  },
}));

describe('DocumentCommands integration', () => {
  let documentService: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    documentService = {
      generateDocument: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      loadDocuments: vi.fn().mockResolvedValue([]),
      searchDocuments: vi.fn().mockReturnValue([]),
      invalidateCache: vi.fn(),
      dispose: vi.fn(),
    } as unknown as DocumentService;

    // Default: withProgress executes the task callback
    mockWithProgress.mockImplementation((_opts: unknown, task: () => Promise<void>) => task());
  });

  it('should register generateDocument command', () => {
    const disposables = registerDocumentCommands(documentService);

    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'enterprise-ai.generateDocument',
      expect.any(Function),
    );
    expect(disposables.length).toBeGreaterThan(0);
  });

  it('should prompt for format and content', async () => {
    mockShowQuickPick.mockResolvedValue({
      label: 'DOCX',
      description: 'Microsoft Word document',
      format: 'docx',
      extension: 'docx',
    });
    mockShowInputBox.mockResolvedValue('Generate a monthly report');
    mockShowSaveDialog.mockResolvedValue({ fsPath: '/tmp/report.docx' });

    registerDocumentCommands(documentService);
    const handler = mockRegisterCommand.mock.calls[0][1];
    await handler();

    expect(mockShowQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'DOCX' }),
      ]),
      expect.objectContaining({
        placeHolder: expect.any(String),
        title: expect.any(String),
      }),
    );
    expect(mockShowInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('DOCX'),
      }),
    );
  });

  it('should abort if user cancels format selection', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    registerDocumentCommands(documentService);
    const handler = mockRegisterCommand.mock.calls[0][1];
    await handler();

    expect(mockShowInputBox).not.toHaveBeenCalled();
    expect(documentService.generateDocument).not.toHaveBeenCalled();
  });

  it('should abort if user cancels content input', async () => {
    mockShowQuickPick.mockResolvedValue({
      label: 'PDF',
      description: 'PDF document',
      format: 'pdf',
      extension: 'pdf',
    });
    mockShowInputBox.mockResolvedValue(undefined);

    registerDocumentCommands(documentService);
    const handler = mockRegisterCommand.mock.calls[0][1];
    await handler();

    expect(mockShowSaveDialog).not.toHaveBeenCalled();
    expect(documentService.generateDocument).not.toHaveBeenCalled();
  });

  it('should show error on API failure', async () => {
    mockShowQuickPick.mockResolvedValue({
      label: 'DOCX',
      description: 'Microsoft Word document',
      format: 'docx',
      extension: 'docx',
    });
    mockShowInputBox.mockResolvedValue('Generate report');
    mockShowSaveDialog.mockResolvedValue({ fsPath: '/tmp/report.docx' });
    (documentService.generateDocument as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API connection failed'),
    );

    registerDocumentCommands(documentService);
    const handler = mockRegisterCommand.mock.calls[0][1];
    await handler();

    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('API connection failed'),
    );
  });
});
