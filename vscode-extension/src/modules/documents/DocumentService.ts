import * as vscode from 'vscode';
import type { ApiClient } from '../../core/ApiClient';
import type { EventBus } from '../../core/EventBus';
import type { Document, DocumentGenerateRequest } from '../../core/types';
import { API_PATHS } from '../../utils/constants';

const FORMAT_TO_PATH: Record<DocumentGenerateRequest['format'], string> = {
  docx: API_PATHS.TOOLS_GENERATE_DOCX,
  excel: API_PATHS.TOOLS_GENERATE_EXCEL,
  pptx: API_PATHS.TOOLS_GENERATE_PPTX,
  pdf: API_PATHS.TOOLS_CONVERT_PDF,
};

export class DocumentService {
  private cachedDocuments: Document[] | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async loadDocuments(): Promise<Document[]> {
    if (this.cachedDocuments !== null) {
      return this.cachedDocuments;
    }

    try {
      const documents = await this.apiClient.get<Document[]>(API_PATHS.DOCUMENTS);
      this.cachedDocuments = documents;
      this.outputChannel.appendLine(`[Documents] Loaded ${documents.length} documents`);
      return documents;
    } catch (error) {
      this.outputChannel.appendLine(`[Documents] Failed to load documents: ${error}`);
      return [];
    }
  }

  invalidateCache(): void {
    this.cachedDocuments = null;
    this.outputChannel.appendLine('[Documents] Cache invalidated');
  }

  searchDocuments(query: string): Document[] {
    if (!this.cachedDocuments) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    return this.cachedDocuments.filter((doc) => {
      const lowerName = doc.name.toLowerCase();
      // Fuzzy match: every character in query appears in order in name
      let queryIndex = 0;
      for (let i = 0; i < lowerName.length && queryIndex < lowerQuery.length; i++) {
        if (lowerName[i] === lowerQuery[queryIndex]) {
          queryIndex++;
        }
      }
      return queryIndex === lowerQuery.length;
    }).sort((a, b) => {
      // Prefer matches that start with the query
      const aStartsWith = a.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1;
      const bStartsWith = b.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1;
      if (aStartsWith !== bStartsWith) {
        return aStartsWith - bStartsWith;
      }
      // Then prefer substring matches over fuzzy matches
      const aIncludes = a.name.toLowerCase().includes(lowerQuery) ? 0 : 1;
      const bIncludes = b.name.toLowerCase().includes(lowerQuery) ? 0 : 1;
      return aIncludes - bIncludes;
    });
  }

  async generateDocument(request: DocumentGenerateRequest): Promise<Uint8Array> {
    const path = FORMAT_TO_PATH[request.format];
    const body: Record<string, unknown> = { content: request.content };
    if (request.fileName) {
      body.fileName = request.fileName;
    }

    this.outputChannel.appendLine(`[Documents] Generating ${request.format}: ${request.fileName ?? 'unnamed'}`);
    const result = await this.apiClient.post<Uint8Array>(path, body);
    this.outputChannel.appendLine(`[Documents] Generated ${request.format} successfully`);
    return result;
  }

  dispose(): void {
    this.cachedDocuments = null;
  }
}
