import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../../../src/modules/documents/DocumentService';
import type { ApiClient } from '../../../src/core/ApiClient';
import { EventBus } from '../../../src/core/EventBus';
import { createMockOutputChannel } from '../../setup';

describe('DocumentService', () => {
  let documentService: DocumentService;
  let apiClient: ApiClient;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as ApiClient;
    const outputChannel = createMockOutputChannel();
    documentService = new DocumentService(apiClient, eventBus, outputChannel);
  });

  it('should fetch documents from backend', async () => {
    const docs = [
      { id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' },
      { id: 2, name: 'Manual.docx', type: 'docx', size: 2048, createdAt: '', updatedAt: '' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    const result = await documentService.loadDocuments();
    expect(result).toEqual(docs);
    expect(apiClient.get).toHaveBeenCalledWith('/api/documents');
  });

  it('should cache documents after first load', async () => {
    const docs = [{ id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await documentService.loadDocuments();
    const cached = await documentService.loadDocuments();
    expect(cached).toEqual(docs);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache on event', async () => {
    const docs = [{ id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await documentService.loadDocuments();
    documentService.invalidateCache();
    await documentService.loadDocuments();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('should fuzzy search documents by name', async () => {
    const docs = [
      { id: 1, name: 'Annual Report 2026.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' },
      { id: 2, name: 'User Manual.docx', type: 'docx', size: 2048, createdAt: '', updatedAt: '' },
      { id: 3, name: 'API Reference.pdf', type: 'pdf', size: 512, createdAt: '', updatedAt: '' },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await documentService.loadDocuments();
    const results = documentService.searchDocuments('rep');
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Annual Report 2026.pdf');
    expect(results[1].name).toBe('API Reference.pdf');
  });

  it('should generate DOCX document', async () => {
    const blob = new Uint8Array([1, 2, 3]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'docx',
      content: 'Test content',
      fileName: 'test',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/generate-docx', {
      content: 'Test content',
      fileName: 'test',
    });
    expect(result).toEqual(blob);
  });

  it('should generate Excel document', async () => {
    const blob = new Uint8Array([4, 5, 6]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'excel',
      content: 'Spreadsheet data',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/generate-excel', {
      content: 'Spreadsheet data',
    });
    expect(result).toEqual(blob);
  });

  it('should generate PPTX document', async () => {
    const blob = new Uint8Array([7, 8, 9]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'pptx',
      content: 'Slides content',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/generate-pptx', {
      content: 'Slides content',
    });
    expect(result).toEqual(blob);
  });

  it('should generate PDF document', async () => {
    const blob = new Uint8Array([10, 11, 12]);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(blob);

    const result = await documentService.generateDocument({
      format: 'pdf',
      content: 'PDF content',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/tools/convert-to-pdf', {
      content: 'PDF content',
    });
    expect(result).toEqual(blob);
  });

  it('should handle API error on loadDocuments and return empty array', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await documentService.loadDocuments();
    expect(result).toEqual([]);
  });

  it('should not cache documents after API error', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
    await documentService.loadDocuments();

    const docs = [{ id: 1, name: 'Report.pdf', type: 'pdf', size: 1024, createdAt: '', updatedAt: '' }];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(docs);
    const result = await documentService.loadDocuments();
    expect(result).toEqual(docs);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('should return empty array when searching without loaded documents', () => {
    const results = documentService.searchDocuments('test');
    expect(results).toEqual([]);
  });
});
