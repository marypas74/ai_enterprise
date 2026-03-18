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
 * Smart redaction using regex patterns + optional Ollama Vision AI pass.
 * Pass 1: Searches for common PII patterns (email, phone, fiscal code, IBAN).
 * Pass 2 (if Ollama available): Uses vision model on each page image to detect residual PII.
 */
export async function smartRedactRegex(
  buffer: Buffer,
  patterns?: string[],
  enableVisionPass?: boolean,
): Promise<{ buffer: Buffer; redactedCount: number; visionUsed: boolean }> {
  const defaultPatterns = [
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',  // email
    '\\+?\\d{1,3}[\\s.-]?\\d{2,4}[\\s.-]?\\d{4,}',       // phone
    '[A-Z]{6}\\d{2}[A-Z]\\d{2}[A-Z]\\d{3}[A-Z]',         // codice fiscale
    'IT\\d{2}[A-Z]\\d{22}',                                // IBAN
  ];

  const regexPatterns = patterns || defaultPatterns;
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument;
  let redactedCount = 0;

  // --- Pass 1: Regex-based redaction ---
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

  // Save after Pass 1
  let resultBuffer = Buffer.from(doc.saveToBuffer('').asUint8Array());
  doc.destroy();

  // --- Pass 2: Ollama Vision AI (optional, graceful fallback) ---
  let visionUsed = false;
  if (enableVisionPass !== false) {
    try {
      const { analyzeImageWithVision } = await import('./OllamaVisionHelper.js');
      const { renderPageToImage } = await import('./PDFConversionService.js');

      const doc2 = mupdf.Document.openDocument(resultBuffer, 'application/pdf') as mupdf.PDFDocument;
      const totalPages = doc2.countPages();
      doc2.destroy();

      for (let i = 0; i < totalPages; i++) {
        const pageImage = await renderPageToImage(resultBuffer, i, 'png', 200);
        const visionResult = await analyzeImageWithVision(
          pageImage,
          'Analyze this document page image. List ALL remaining personally identifiable information (PII) you can see: names, addresses, phone numbers, email addresses, ID numbers, dates of birth, signatures, photos of people, account numbers, license plates, or any other identifying information. For each item found, describe its approximate location on the page (top/middle/bottom, left/center/right) and the exact text. If no PII is found, respond with "NONE".',
        );

        if (!visionResult.available) {
          console.warn('[smartRedact] Ollama Vision not available — skipping Pass 2');
          break;
        }

        visionUsed = true;

        if (visionResult.text && !visionResult.text.toUpperCase().includes('NONE')) {
          // Extract PII text from vision response and search for it in the page
          const piiLines = visionResult.text.split('\n').filter(l => l.trim().length > 3);
          const doc3 = mupdf.Document.openDocument(resultBuffer, 'application/pdf') as mupdf.PDFDocument;
          const page = doc3.loadPage(i) as mupdf.PDFPage;
          let pageHasRedactions = false;

          for (const line of piiLines) {
            // Try to extract quoted text or text after a colon
            const quotedMatch = line.match(/"([^"]+)"|'([^']+)'|:\s*(.+?)(?:\s*\(|$)/);
            const searchText = quotedMatch?.[1] || quotedMatch?.[2] || quotedMatch?.[3]?.trim();
            if (!searchText || searchText.length < 3) continue;

            const hits = page.search(searchText);
            for (const quads of hits) {
              const flat = quads as unknown as number[];
              if (flat.length >= 8) {
                const xs = [flat[0], flat[2], flat[4], flat[6]];
                const ys = [flat[1], flat[3], flat[5], flat[7]];
                const annot = page.createAnnotation('Redact');
                annot.setRect([
                  Math.min(...xs) - 2, Math.min(...ys) - 2,
                  Math.max(...xs) + 2, Math.max(...ys) + 2,
                ]);
                annot.update();
                pageHasRedactions = true;
                redactedCount++;
              }
            }
          }

          if (pageHasRedactions) {
            page.applyRedactions(true, 0);
          }
          resultBuffer = Buffer.from(doc3.saveToBuffer('').asUint8Array());
          doc3.destroy();
        }
      }
    } catch (err) {
      console.warn('[smartRedact] Vision Pass 2 failed, returning regex-only result:', err);
    }
  }

  return { buffer: resultBuffer, redactedCount, visionUsed };
}
