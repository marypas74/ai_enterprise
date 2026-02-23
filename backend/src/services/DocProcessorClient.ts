/**
 * DocProcessorClient — HTTP client for the doc-processor microservice
 * Provides methods to call the external document processing service.
 * Falls back to local processing if the service is unavailable.
 */

const DOC_PROCESSOR_URL = process.env.DOC_PROCESSOR_URL || 'http://doc-processor:3001';

interface ExtractResult {
  text: string;
  method: string;
  charCount: number;
  filename: string;
}

/**
 * Check if the doc-processor service is available
 */
export async function isDocProcessorAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${DOC_PROCESSOR_URL}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Extract text from a document buffer via doc-processor service
 */
export async function extractTextRemote(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ExtractResult> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);

  const response = await fetch(`${DOC_PROCESSOR_URL}/extract`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`doc-processor extract failed: ${(error as any).error}`);
  }

  return await response.json() as ExtractResult;
}

/**
 * Generate a DOCX document via doc-processor service
 */
export async function generateDocxRemote(
  content: string,
  title: string
): Promise<Buffer> {
  const response = await fetch(`${DOC_PROCESSOR_URL}/generate/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, title }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`doc-processor generate/docx failed: ${(error as any).error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generate an Excel document via doc-processor service
 */
export async function generateXlsxRemote(
  data: Record<string, any>[],
  sheetName?: string
): Promise<Buffer> {
  const response = await fetch(`${DOC_PROCESSOR_URL}/generate/xlsx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, sheetName }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`doc-processor generate/xlsx failed: ${(error as any).error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generate a PowerPoint document via doc-processor service
 */
export async function generatePptxRemote(
  slides: { title: string; content: string }[],
  title?: string
): Promise<Buffer> {
  const response = await fetch(`${DOC_PROCESSOR_URL}/generate/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slides, title }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`doc-processor generate/pptx failed: ${(error as any).error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Convert an Office document to PDF via doc-processor service
 */
export async function convertToPdfRemote(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<Buffer> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);

  const response = await fetch(`${DOC_PROCESSOR_URL}/convert/pdf`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`doc-processor convert/pdf failed: ${(error as any).error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
