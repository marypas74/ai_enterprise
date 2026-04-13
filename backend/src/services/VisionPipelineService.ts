/**
 * VisionPipelineService — Orchestratore pipeline vision per documenti.
 * Coordina DocumentTypeDetector → PdfPageRenderer con timeout adattivo
 * e fallback automatico al path testuale in caso di errore.
 */
import { DocumentTypeDetector, type DocumentPath } from './DocumentTypeDetector.js';
import { PdfPageRenderer } from './PdfPageRenderer.js';

export interface VisionPipelineResult {
  pages: string[];
  path: DocumentPath;
  pageCount: number;
  fallbackUsed: boolean;
}

const TIMEOUT_PER_PAGE_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PAGES = 50;
const RENDER_DPI = 150;

export class VisionPipelineService {
  static async prepare(
    buffer: Buffer,
    mimeType: string,
  ): Promise<VisionPipelineResult> {
    const detection = await DocumentTypeDetector.detect(buffer, mimeType);

    if (detection.path === 'text') {
      return {
        pages: [],
        path: 'text',
        pageCount: detection.pageCount,
        fallbackUsed: false,
      };
    }

    const renderTimeout = Math.min(
      detection.pageCount * TIMEOUT_PER_PAGE_MS,
      MAX_TIMEOUT_MS,
    );

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const pages = await Promise.race<string[]>([
        PdfPageRenderer.renderToBase64(buffer, MAX_PAGES, RENDER_DPI).finally(() => {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`render timeout after ${renderTimeout}ms`)),
            renderTimeout,
          );
        }),
      ]);

      return {
        pages,
        path: detection.path,
        pageCount: detection.pageCount,
        fallbackUsed: false,
      };
    } catch {
      return {
        pages: [],
        path: 'text',
        pageCount: detection.pageCount,
        fallbackUsed: true,
      };
    }
  }
}
