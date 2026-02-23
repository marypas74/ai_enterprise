/**
 * DocumentGeneratorService - Generates DOCX documents from AI-translated text
 * Temporary storage with in-memory registry and auto-cleanup
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DOCUMENTS_DIR = process.env.GENERATED_DOCS_DIR || '/app/attachments/generated';
const DOCUMENT_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

interface GeneratedDocument {
  id: string;
  filePath: string;
  fileName: string;
  createdAt: number;
  userId: number;
}

const documentRegistry = new Map<string, GeneratedDocument>();

// Cleanup expired documents every 15 minutes
setInterval(async () => {
  const now = Date.now();
  for (const [id, doc] of documentRegistry.entries()) {
    if (now - doc.createdAt > DOCUMENT_EXPIRY_MS) {
      try { await fs.unlink(doc.filePath); } catch { /* already deleted */ }
      documentRegistry.delete(id);
    }
  }
}, 15 * 60 * 1000);

async function ensureDocumentsDir(): Promise<void> {
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
}

/**
 * Parse markdown-formatted text into docx Paragraphs
 */
function parseTextToParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      paragraphs.push(new Paragraph({ text: '' }));
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: trimmed.slice(4), font: 'Calibri' })],
      }));
    } else if (trimmed.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: trimmed.slice(3), font: 'Calibri' })],
      }));
    } else if (trimmed.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: trimmed.slice(2), font: 'Calibri' })],
      }));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: trimmed.slice(2), font: 'Calibri', size: 24 })],
      }));
    } else {
      // Regular paragraph with bold (**text**) support
      const runs: TextRun[] = [];
      const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
      for (const part of parts) {
        if (part.startsWith('**') && part.endsWith('**')) {
          runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: 'Calibri', size: 24 }));
        } else if (part) {
          runs.push(new TextRun({ text: part, font: 'Calibri', size: 24 }));
        }
      }
      paragraphs.push(new Paragraph({ children: runs }));
    }
  }

  return paragraphs;
}

/**
 * Generate a DOCX document from translated text
 */
export async function generateDocument(options: {
  title: string;
  content: string;
  userId: number;
  originalFileName?: string;
}): Promise<{ id: string; fileName: string; downloadUrl: string }> {
  await ensureDocumentsDir();

  const { title, content, userId, originalFileName } = options;
  const id = crypto.randomBytes(16).toString('hex');

  const baseName = originalFileName
    ? path.basename(originalFileName, path.extname(originalFileName))
    : 'documento';
  const fileName = `${baseName}_tradotto.docx`;

  const paragraphs = parseTextToParagraphs(content);

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: title, bold: true, font: 'Calibri', size: 48, color: '2B579A' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
          children: [new TextRun({
            text: `Generato il ${new Date().toLocaleDateString('it-IT')}`,
            font: 'Calibri', size: 20, color: '999999',
          })],
        }),
        ...paragraphs,
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const filePath = path.join(DOCUMENTS_DIR, `${id}.docx`);
  await fs.writeFile(filePath, buffer);

  documentRegistry.set(id, { id, filePath, fileName, createdAt: Date.now(), userId });

  return { id, fileName, downloadUrl: `/downloads/document/${id}` };
}

/**
 * Get a generated document by ID (verifies user ownership and expiry)
 */
export function getDocument(id: string, userId: number): GeneratedDocument | null {
  const doc = documentRegistry.get(id);
  if (!doc || doc.userId !== userId) return null;

  if (Date.now() - doc.createdAt > DOCUMENT_EXPIRY_MS) {
    documentRegistry.delete(id);
    return null;
  }

  return doc;
}
