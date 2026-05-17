import { api } from './api';

// OnlyOffice-based PDF editing
export type SaveMode = 'draft' | 'download';

export interface OnlyOfficeSessionResponse {
  editorConfig: Record<string, unknown>;
  publicUrl: string;
  documentKey: string;
  saveMode: SaveMode;
  textChars: number;
}

export async function createOnlyOfficeSession(
  attachmentId: number,
  saveMode: SaveMode = 'draft',
): Promise<OnlyOfficeSessionResponse> {
  const response = await api.post('/tools/pdf-editor/onlyoffice-session', { attachmentId, saveMode });
  return response.data;
}

export interface OnlyOfficeSessionStatus {
  status: 'editing' | 'saved' | 'error';
  saveMode?: SaveMode;
  newAttachmentId?: number;
  newFilename?: string;
  downloadToken?: string | null;
}

export async function getOnlyOfficeSessionStatus(documentKey: string): Promise<OnlyOfficeSessionStatus> {
  const response = await api.get(`/tools/pdf-editor/onlyoffice-session/${documentKey}/status`);
  return response.data;
}

export function buildOneShotDownloadUrl(token: string): string {
  // Returned by status endpoint when saveMode='download' and status='saved'
  return `/api/tools/pdf-editor/download/${token}`;
}
