/**
 * PDFSecurityService — PDF security operations using mupdf
 * Provides: protectPdf, unlockPdf, redactAreas, smartRedactRegex
 */
import * as mupdf from 'mupdf';

interface PdfPermissions {
  printing?: boolean;
  copying?: boolean;
  modifying?: boolean;
}

/**
 * Encrypt a PDF with user and/or owner passwords.
 */
export async function protectPdf(
  buffer: Buffer,
  userPassword: string,
  ownerPassword?: string,
  permissions?: PdfPermissions,
): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument;

  const parts: string[] = ['encrypt=aes-256'];
  parts.push(`user-password=${userPassword}`);
  if (ownerPassword) {
    parts.push(`owner-password=${ownerPassword}`);
  }

  // Build permission string
  if (permissions) {
    const perms: string[] = [];
    if (permissions.printing) perms.push('print');
    if (permissions.copying) perms.push('copy');
    if (permissions.modifying) perms.push('edit');
    if (perms.length > 0) {
      parts.push(`permissions=${perms.join(',')}`);
    }
  }

  const result = Buffer.from(doc.saveToBuffer(parts.join(',')).asUint8Array());
  doc.destroy();
  return result;
}

/**
 * Unlock a password-protected PDF.
 */
export async function unlockPdf(
  buffer: Buffer,
  password: string,
): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument;

  if (doc.needsPassword()) {
    const ok = doc.authenticatePassword(password);
    if (!ok) {
      doc.destroy();
      throw new Error('Incorrect password');
    }
  }

  // Save without encryption
  const result = Buffer.from(doc.saveToBuffer('').asUint8Array());
  doc.destroy();
  return result;
}

/**
 * Redact rectangular areas on PDF pages (permanent black boxes).
 */
export async function redactAreas(
  buffer: Buffer,
  areas: Array<{ page: number; x: number; y: number; width: number; height: number }>,
): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument;

  for (const area of areas) {
    if (area.page < 0 || area.page >= doc.countPages()) {
      doc.destroy();
      throw new Error(`Page ${area.page} out of range`);
    }

    const page = doc.loadPage(area.page) as mupdf.PDFPage;
    const annot = page.createAnnotation('Redact');
    annot.setRect([area.x, area.y, area.x + area.width, area.y + area.height]);
    annot.update();
    page.applyRedactions(true, 0);
  }

  const result = Buffer.from(doc.saveToBuffer('').asUint8Array());
  doc.destroy();
  return result;
}

/**
 * Smart redaction using regex patterns.
 * Pass 1: Searches for common PII patterns (email, phone, fiscal code, IBAN).
 */
export async function smartRedactRegex(
  buffer: Buffer,
  patterns?: string[],
): Promise<{ buffer: Buffer; redactedCount: number }> {
  const defaultPatterns = [
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',  // email
    '\\+?\\d{1,3}[\\s.-]?\\d{2,4}[\\s.-]?\\d{4,}',       // phone
    '[A-Z]{6}\\d{2}[A-Z]\\d{2}[A-Z]\\d{3}[A-Z]',         // codice fiscale
    'IT\\d{2}[A-Z]\\d{22}',                                // IBAN
  ];

  const regexPatterns = patterns || defaultPatterns;
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument;
  let redactedCount = 0;

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i) as mupdf.PDFPage;
    const st = page.toStructuredText('preserve-whitespace');
    const text = st.asText();

    let hasRedactions = false;

    for (const patternStr of regexPatterns) {
      const regex = new RegExp(patternStr, 'g');
      let match: RegExpMatchArray | null;

      while ((match = regex.exec(text)) !== null) {
        const hits = page.search(match[0]);
        for (const quads of hits) {
          // Convert quad points to bounding rect
          const flat = quads as unknown as number[];
          if (flat.length >= 8) {
            const xs = [flat[0], flat[2], flat[4], flat[6]];
            const ys = [flat[1], flat[3], flat[5], flat[7]];
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);

            const annot = page.createAnnotation('Redact');
            annot.setRect([minX - 2, minY - 2, maxX + 2, maxY + 2]);
            annot.update();
            hasRedactions = true;
            redactedCount++;
          }
        }
      }
    }

    if (hasRedactions) {
      page.applyRedactions(true, 0);
    }
  }

  const result = Buffer.from(doc.saveToBuffer('').asUint8Array());
  doc.destroy();
  return { buffer: result, redactedCount };
}
