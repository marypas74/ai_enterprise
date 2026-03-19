import { api } from './api';

export async function convertPdfToHtml(attachmentId: number): Promise<{ html: string; filename: string }> {
  const response = await api.post('/tools/pdf-editor/convert', { attachmentId });
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
