/**
 * DocumentTypeDetector — Rileva se un documento è testuale o scansionato.
 */

export type DocumentPath = 'text' | 'vision' | 'hybrid';

export interface DetectionResult {
  path: DocumentPath;
  textDensity: number;
  pageCount: number;
}

const TEXT_DENSITY_THRESHOLD = 50;
const HYBRID_DENSITY_THRESHOLD = 10;

const PDF_MAGIC = '%PDF-';

export class DocumentTypeDetector {
  static async detect(buffer: Buffer, mimeType: string): Promise<DetectionResult> {
    if (mimeType !== 'application/pdf') {
      return { path: 'text', textDensity: 9999, pageCount: 1 };
    }

    // Magic-byte check: prevent MIME spoofing
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== PDF_MAGIC) {
      return { path: 'vision', textDensity: 0, pageCount: 1 };
    }

    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();

      const pageCount = result.pages?.length ?? 1;
      const density = result.text.length / Math.max(pageCount, 1);

      const path: DocumentPath =
        density >= TEXT_DENSITY_THRESHOLD ? 'text' :
        density >= HYBRID_DENSITY_THRESHOLD ? 'hybrid' :
        'vision';

      return { path, textDensity: density, pageCount };
    } catch {
      return { path: 'vision', textDensity: 0, pageCount: 1 };
    }
  }
}
