import { api } from './api';

// Legacy TipTap-based PDF editing (kept for backward compatibility)
export async function convertPdfToHtml(attachmentId: number): Promise<{ html: string; filename: string; method?: string }> {
  const response = await api.post('/tools/pdf-editor/convert', { attachmentId }, {
    timeout: 20 * 60 * 1000,
  });
  return response.data;
}

export async function saveEditedPdf(
  attachmentId: number,
  html: string,
  filename?: string
): Promise<{ attachmentId: number; filename: string; size: number }> {
  const response = await api.post('/tools/pdf-editor/save', { attachmentId, html, filename }, {
    maxBodyLength: 100 * 1024 * 1024,
    maxContentLength: 100 * 1024 * 1024,
  });
  return response.data;
}

// OnlyOffice-based PDF editing
export interface OnlyOfficeSessionResponse {
  editorConfig: Record<string, unknown>;
  publicUrl: string;
  documentKey: string;
}

export async function createOnlyOfficeSession(attachmentId: number): Promise<OnlyOfficeSessionResponse> {
  const response = await api.post('/tools/pdf-editor/onlyoffice-session', { attachmentId });
  return response.data;
}

export interface OnlyOfficeSessionStatus {
  status: 'editing' | 'saved' | 'error';
  newAttachmentId?: number;
  newFilename?: string;
}

export async function getOnlyOfficeSessionStatus(documentKey: string): Promise<OnlyOfficeSessionStatus> {
  const response = await api.get(`/tools/pdf-editor/onlyoffice-session/${documentKey}/status`);
  return response.data;
}
