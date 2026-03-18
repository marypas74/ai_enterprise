/**
 * PDFConversionService — PDF conversion operations using mupdf WASM
 * Provides: PDF→Images, PDF→DOCX (smart/OCR/layout), PDF→XLSX, PDF→PPTX, Images→PDF
 */
import * as mupdf from 'mupdf';
import { PDFDocument } from 'pdf-lib';
import { parsePagesSpec } from './PDFManipulationService.js';
import { generateDocxBuffer } from './DocumentGenerationService.js';

// --- Types ---

export interface PageImage {
  pageNumber: number;
  buffer: Buffer;
  format: 'png' | 'jpg';
}

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  isBold: boolean;
  pageNumber: number;
}

export interface ImageInput {
  buffer: Buffer;
  mimeType: string;
}

// --- PDF → Images ---

/**
 * Render a single PDF page to an image buffer using mupdf WASM.
 * @param pageIndex - 0-based page index
 * @param format - 'png' or 'jpg'
 * @param dpi - Resolution (default 150)
 */
export async function renderPageToImage(
  pdfBuffer: Buffer,
  pageIndex: number,
  format: 'png' | 'jpg' = 'png',
  dpi: number = 150
): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  try {
    const page = doc.loadPage(pageIndex);
    const scale = dpi / 72;
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    const imageBuffer = format === 'png'
      ? pixmap.asPNG()
      : pixmap.asJPEG(85);

    return Buffer.from(imageBuffer);
  } finally {
    doc.destroy();
  }
}

/**
 * Convert PDF pages to images.
 * @param pagesSpec - Optional page spec like "1,3-5". If omitted, all pages.
 */
export async function convertPdfToImages(
  pdfBuffer: Buffer,
  format: 'png' | 'jpg' = 'png',
  dpi: number = 150,
  pagesSpec?: string
): Promise<PageImage[]> {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const totalPages = doc.countPages();
  doc.destroy();

  const indices = pagesSpec
    ? parsePagesSpec(pagesSpec, totalPages)
    : Array.from({ length: totalPages }, (_, i) => i);

  const images: PageImage[] = [];
  for (const idx of indices) {
    const buffer = await renderPageToImage(pdfBuffer, idx, format, dpi);
    images.push({ pageNumber: idx + 1, buffer, format });
  }

  return images;
}

// --- Structured Text Extraction ---

/**
 * Extract structured text from a PDF page with position and font info.
 */
export async function extractStructuredText(pdfBuffer: Buffer, pageIndex: number): Promise<TextBlock[]> {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  try {
    const page = doc.loadPage(pageIndex);
    const json = page.toStructuredText('preserve-whitespace').asJSON();
    const data = JSON.parse(json);
    const blocks: TextBlock[] = [];

    for (const block of data.blocks || []) {
      for (const line of block.lines || []) {
        const lineText = line.text || '';
        const fontSize = line.font?.size || 12;
        const isBold = line.font?.weight === 'bold' || /bold/i.test(line.font?.name || '');

        if (lineText.trim()) {
          blocks.push({
            text: lineText.trim(),
            x: line.bbox?.x ?? line.x ?? 0,
            y: line.bbox?.y ?? line.y ?? 0,
            fontSize,
            isBold,
            pageNumber: pageIndex + 1,
          });
        }
      }
    }

    return blocks;
  } finally {
    doc.destroy();
  }
}

// --- PDF → DOCX (Smart) ---

/**
 * Convert PDF to DOCX using smart extraction (structure-aware).
 * Extracts text with font/position info and rebuilds DOCX with headings and paragraphs.
 * Optionally enhances with Ollama Vision for improved layout reconstruction.
 */
export async function convertPdfToDocxSmart(
  pdfBuffer: Buffer,
  title?: string,
  enableVisionEnhancement?: boolean,
): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const totalPages = doc.countPages();
  doc.destroy();

  const allBlocks: TextBlock[] = [];
  for (let i = 0; i < totalPages; i++) {
    const pageBlocks = await extractStructuredText(pdfBuffer, i);
    allBlocks.push(...pageBlocks);
  }

  const lines: string[] = [];
  let currentPage = 0;

  for (const block of allBlocks) {
    if (block.pageNumber !== currentPage) {
      if (currentPage > 0) lines.push('');
      currentPage = block.pageNumber;
    }

    if (block.isBold && block.fontSize >= 14) {
      lines.push(`## ${block.text}`);
    } else if (block.fontSize >= 16) {
      lines.push(`# ${block.text}`);
    } else {
      lines.push(block.text);
    }
  }

  let textContent = lines.join('\n');

  // Optional: Ollama Vision enhancement pass for layout accuracy
  if (enableVisionEnhancement !== false) {
    try {
      const { analyzeImageWithVision } = await import('./OllamaVisionHelper.js');

      // Only process first 5 pages to avoid excessive API calls
      const maxPages = Math.min(totalPages, 5);
      const visionInsights: string[] = [];

      for (let i = 0; i < maxPages; i++) {
        const pageImage = await renderPageToImage(pdfBuffer, i, 'png', 150);
        const result = await analyzeImageWithVision(
          pageImage,
          'Analyze this document page. Describe the layout structure: identify headers, paragraphs, lists, tables, columns, footnotes, and any special formatting. For tables, describe the column headers and row structure. Respond concisely.',
        );

        if (!result.available) {
          console.warn('[convertPdfToDocxSmart] Ollama Vision not available — skipping enhancement');
          break;
        }

        if (result.text) {
          visionInsights.push(`--- Page ${i + 1} Layout ---\n${result.text}`);
        }
      }

      // If vision provided layout insights, append as metadata
      if (visionInsights.length > 0) {
        textContent += '\n\n[Document layout analysis (AI-enhanced)]\n';
        textContent += visionInsights.join('\n\n');
      }
    } catch (err) {
      console.warn('[convertPdfToDocxSmart] Vision enhancement failed:', err);
    }
  }

  return generateDocxBuffer(textContent, title || 'Converted Document');
}

// --- PDF → DOCX (OCR) ---

/**
 * Convert PDF to DOCX using OCR pipeline.
 * Renders pages as images, runs OCR, rebuilds DOCX from OCR text.
 */
export async function convertPdfToDocxOcr(pdfBuffer: Buffer, title?: string): Promise<Buffer> {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const totalPages = doc.countPages();
  doc.destroy();

  const allText: string[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageImage = await renderPageToImage(pdfBuffer, i, 'png', 300);

    try {
      const { processDocument } = await import('../DocumentProcessorService.js');
      const result = await processDocument(pageImage, 'image/png', `page_${i + 1}.png`);
      allText.push(result.text);
    } catch {
      allText.push(`[Page ${i + 1}: OCR failed]`);
    }
  }

  return generateDocxBuffer(allText.join('\n\n--- Page Break ---\n\n'), title || 'OCR Converted Document');
}

// --- PDF → DOCX (Layout) ---

/**
 * Convert PDF to DOCX using layout mode.
 * Each page becomes a full-page image in the DOCX with OCR text below.
 */
export async function convertPdfToDocxLayout(pdfBuffer: Buffer, title?: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, ImageRun, HeadingLevel, TextRun } = await import('docx');

  const mupdfDoc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const totalPages = mupdfDoc.countPages();
  mupdfDoc.destroy();

  const sections: InstanceType<typeof Paragraph>[] = [];

  if (title) {
    sections.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  }

  for (let i = 0; i < totalPages; i++) {
    const pageImage = await renderPageToImage(pdfBuffer, i, 'png', 200);

    sections.push(new Paragraph({
      children: [
        new ImageRun({
          data: pageImage,
          transformation: { width: 595, height: 842 },
          type: 'png',
        }),
      ],
    }));

    try {
      const blocks = await extractStructuredText(pdfBuffer, i);
      const pageText = blocks.map(b => b.text).join(' ');
      if (pageText.trim()) {
        sections.push(new Paragraph({
          children: [new TextRun({ text: pageText, size: 2, color: 'FFFFFF' })],
        }));
      }
    } catch {
      // Skip OCR text if extraction fails
    }
  }

  const docxDoc = new Document({ sections: [{ children: sections }] });
  const buffer = await Packer.toBuffer(docxDoc);
  return Buffer.from(buffer);
}

// --- PDF → XLSX ---

/**
 * Convert PDF to XLSX by extracting text in a grid-like structure.
 * Uses coordinate-based clustering to detect table rows and columns.
 */
export async function convertPdfToXlsx(
  pdfBuffer: Buffer,
  pagesSpec?: string
): Promise<Buffer> {
  const ExcelJS = await import('exceljs');

  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const totalPages = doc.countPages();
  doc.destroy();

  const indices = pagesSpec
    ? parsePagesSpec(pagesSpec, totalPages)
    : Array.from({ length: totalPages }, (_, i) => i);

  const workbook = new ExcelJS.default.Workbook();

  for (const idx of indices) {
    const blocks = await extractStructuredText(pdfBuffer, idx);
    const sheet = workbook.addWorksheet(`Page ${idx + 1}`);

    // Simple clustering: group by Y coordinate (within 5pt tolerance)
    const rows = new Map<number, TextBlock[]>();
    for (const block of blocks) {
      const roundedY = Math.round(block.y / 5) * 5;
      if (!rows.has(roundedY)) rows.set(roundedY, []);
      rows.get(roundedY)!.push(block);
    }

    const sortedRows = [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, cells]) => cells.sort((a, b) => a.x - b.x));

    for (const row of sortedRows) {
      sheet.addRow(row.map(cell => cell.text));
    }

    sheet.columns.forEach(col => {
      let maxLen = 10;
      col.eachCell?.(cell => {
        const len = String(cell.value || '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// --- PDF → PPTX ---

/**
 * Convert PDF to PPTX. Each page becomes a slide with the page rendered as background image.
 */
export async function convertPdfToPptx(pdfBuffer: Buffer, title?: string): Promise<Buffer> {
  const pptxMod = await import('pptxgenjs');
  const PptxGenJS = pptxMod.default as any;

  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const totalPages = doc.countPages();
  doc.destroy();

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  if (title) {
    pptx.title = title;
    pptx.author = 'Enterprise AI Chat';
  }

  for (let i = 0; i < totalPages; i++) {
    const pageImage = await renderPageToImage(pdfBuffer, i, 'png', 150);
    const base64 = pageImage.toString('base64');

    const slide = pptx.addSlide();
    slide.addImage({
      data: `image/png;base64,${base64}`,
      x: 0,
      y: 0,
      w: '100%',
      h: '100%',
    });

    const blocks = await extractStructuredText(pdfBuffer, i);
    const noteText = blocks.map(b => b.text).join('\n');
    if (noteText.trim()) {
      slide.addNotes(noteText);
    }
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(buffer as Buffer);
}

// --- Images → PDF ---

/**
 * Convert one or more images to a single PDF.
 * Each image becomes one page.
 */
export async function convertImagesToPdf(images: ImageInput[]): Promise<Buffer> {
  if (images.length === 0) throw new Error('At least one image required');

  const pdfDoc = await PDFDocument.create();

  for (const img of images) {
    let pdfImage;
    if (img.mimeType === 'image/png') {
      pdfImage = await pdfDoc.embedPng(img.buffer);
    } else if (img.mimeType === 'image/jpeg' || img.mimeType === 'image/jpg') {
      pdfImage = await pdfDoc.embedJpg(img.buffer);
    } else {
      const sharp = (await import('sharp')).default;
      const pngBuffer = await sharp(img.buffer).png().toBuffer();
      pdfImage = await pdfDoc.embedPng(pngBuffer);
    }

    const { width, height } = pdfImage;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(pdfImage, { x: 0, y: 0, width, height });
  }

  return Buffer.from(await pdfDoc.save());
}
