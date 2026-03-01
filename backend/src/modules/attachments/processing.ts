/**
 * Attachment Processing
 * Handles async processing/extraction of uploaded attachments
 */

import { FastifyInstance } from 'fastify';
import { findOne, insertOne, updateOne } from '../../database/index.js';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { PDFParse } from 'pdf-parse';
import {
  extractWithOCR,
  extractPdfWithOCR,
  extractOfficeContent,
  extractExcelContent,
} from '../../services/DocumentProcessorService.js';
import { chunkDocument } from '../../services/ChunkingService.js';
import { indexChunks } from '../../services/VectorStoreService.js';
import { eventBus } from '../../services/EventBusService.js';
import type { ChatAttachment } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Extract text from a PDF buffer using multiple methods
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  console.log(`[Attachments] Starting PDF extraction, size: ${buffer.length}`);

  // Method 1: pdf-parse library (primary -- works everywhere)
  try {
    console.log(`[Attachments] Trying pdf-parse library...`);
    const pdfParser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await pdfParser.getText();
    const text = result.text || '';
    await pdfParser.destroy().catch(() => { });

    if (text.trim().length > 0) {
      console.log(`[Attachments] pdf-parse extracted ${text.length} chars`);
      return text;
    }
    console.log(`[Attachments] pdf-parse returned empty text, trying fallback...`);
  } catch (parseErr: any) {
    console.warn(`[Attachments] pdf-parse failed: ${parseErr.message}, trying pdftotext fallback...`);
  }

  // Method 2: pdftotext CLI fallback (available in Docker with poppler-utils)
  const tmpId = crypto.randomBytes(8).toString('hex');
  const tmpFile = path.join(os.tmpdir(), `pdf_${tmpId}.pdf`);
  const txtFile = path.join(os.tmpdir(), `pdf_${tmpId}.txt`);

  try {
    await fs.writeFile(tmpFile, buffer);
    console.log(`[Attachments] Trying pdftotext CLI fallback...`);
    await execFileAsync('pdftotext', ['-layout', tmpFile, txtFile], { timeout: 30000 });

    const text = await fs.readFile(txtFile, 'utf-8');
    if (text.trim().length > 0) {
      console.log(`[Attachments] pdftotext extracted ${text.length} chars`);
      return text;
    }
  } catch (execErr: any) {
    console.warn(`[Attachments] pdftotext CLI not available or failed: ${execErr.message}`);
  } finally {
    await fs.unlink(tmpFile).catch(() => { });
    await fs.unlink(txtFile).catch(() => { });
  }

  console.log(`[Attachments] All text extraction methods returned empty`);
  return '';
}

/**
 * Process attachment content based on processor type
 */
async function processAttachmentContent(
  attachment: ChatAttachment,
  processor: string,
  log: { info: (...args: any[]) => void; warn: (...args: any[]) => void }
): Promise<string | null> {
  switch (processor) {
    case 'text-read':
    case 'code-read': {
      let content = await fs.readFile(attachment.file_path, 'utf-8');
      if (content.length > 50000) {
        content = content.substring(0, 50000) + '\n... [contenuto troncato per dimensione]';
      }
      return content;
    }

    case 'json-parse': {
      const jsonContent = await fs.readFile(attachment.file_path, 'utf-8');
      try {
        const parsed = JSON.parse(jsonContent);
        let content = JSON.stringify(parsed, null, 2);
        if (content.length > 50000) {
          content = content.substring(0, 50000) + '\n... [JSON troncato]';
        }
        return content;
      } catch {
        return jsonContent.substring(0, 50000);
      }
    }

    case 'csv-parse': {
      const csvContent = await fs.readFile(attachment.file_path, 'utf-8');
      const lines = csvContent.split('\n').slice(0, 100);
      let content = lines.join('\n');
      if (csvContent.split('\n').length > 100) {
        content += '\n... [altre righe omesse]';
      }
      return content;
    }

    case 'image-ocr': {
      try {
        const imgBuffer = await fs.readFile(attachment.file_path);
        let ocrText = await extractWithOCR(imgBuffer);
        if (ocrText.length > 50000) {
          ocrText = ocrText.substring(0, 50000) + '\n... [testo OCR troncato per dimensione]';
        }
        return ocrText.trim()
          ? `[OCR da immagine: ${attachment.original_name}]\n${ocrText}`
          : `[Immagine: ${attachment.original_name}] - Nessun testo rilevato dall'OCR.`;
      } catch (ocrError: any) {
        return `[Immagine: ${attachment.original_name}] - Errore OCR: ${ocrError.message}`;
      }
    }

    case 'pdf-extract': {
      try {
        const pdfBuffer = await fs.readFile(attachment.file_path);
        let pdfText = await extractPdfText(pdfBuffer);

        // Robust check: If pdf-parse returns empty text or only markers
        const markerPattern = /-- \d+ of \d+ --/g;
        const cleanedText = pdfText.replace(markerPattern, '').trim();

        if (cleanedText.length < 20) {
          log.info(`[Attachments] PDF text too sparse (${cleanedText.length} chars) for ${attachment.original_name}, trying OCR...`);
          try {
            pdfText = await extractPdfWithOCR(pdfBuffer);
          } catch (ocrFallbackError: any) {
            log.warn(`[Attachments] OCR fallback failed: ${ocrFallbackError.message}`);
          }
        }

        if (pdfText.length > 50000) {
          pdfText = pdfText.substring(0, 50000) + '\n... [contenuto PDF troncato per dimensione]';
        }
        return pdfText.trim()
          ? pdfText
          : `[Documento PDF: ${attachment.original_name}] - Il PDF non contiene testo estraibile.`;
      } catch (pdfError: any) {
        return `[Documento PDF: ${attachment.original_name}] - Errore estrazione testo: ${pdfError.message}`;
      }
    }

    case 'office-extract': {
      try {
        const officeBuffer = await fs.readFile(attachment.file_path);
        let officeText = await extractOfficeContent(officeBuffer, attachment.mime_type);
        if (officeText.length > 50000) {
          officeText = officeText.substring(0, 50000) + '\n... [contenuto troncato per dimensione]';
        }
        return officeText.trim()
          ? officeText
          : `[Documento Office: ${attachment.original_name}] - Nessun testo estraibile.`;
      } catch (officeError: any) {
        return `[Documento Office: ${attachment.original_name}] - Errore estrazione: ${officeError.message}`;
      }
    }

    case 'excel-extract': {
      try {
        const xlsBuffer = await fs.readFile(attachment.file_path);
        let xlsText = await extractExcelContent(xlsBuffer);
        if (xlsText.length > 50000) {
          xlsText = xlsText.substring(0, 50000) + '\n... [dati Excel troncati per dimensione]';
        }
        return xlsText.trim()
          ? xlsText
          : `[Excel: ${attachment.original_name}] - Nessun dato estraibile.`;
      } catch (xlsError: any) {
        return `[Excel: ${attachment.original_name}] - Errore estrazione: ${xlsError.message}`;
      }
    }

    case 'audio-transcribe':
      return `[File audio: ${attachment.original_name}]\nDimensione: ${Math.round(attachment.file_size / 1024)} KB\n[Per trascrizione audio, integrare Whisper o servizio esterno]`;

    default:
      return `[File: ${attachment.original_name}]\nTipo: ${attachment.mime_type}\nDimensione: ${Math.round(attachment.file_size / 1024)} KB`;
  }
}

/**
 * Chunk and index processed content for smart retrieval
 */
async function chunkAndIndex(
  fastify: FastifyInstance,
  attachmentId: number,
  attachment: ChatAttachment,
  content: string
): Promise<void> {
  if (!content || content.length <= 100) return;

  try {
    const chunks = chunkDocument(content, {
      chunkSize: 1000,
      overlap: 200,
      minChunkSize: 50
    });

    if (chunks.length === 0) return;

    // Delete any previous chunks for this attachment
    await fastify.db.execute(
      'DELETE FROM document_chunks WHERE attachment_id = ?',
      [attachmentId]
    );

    // Insert chunks in batch
    for (const chunk of chunks) {
      await insertOne(
        fastify.db,
        'INSERT INTO document_chunks (attachment_id, chunk_index, content, char_count, metadata) VALUES (?, ?, ?, ?, ?)',
        [attachmentId, chunk.index, chunk.content, chunk.charCount, JSON.stringify(chunk.metadata)]
      );
    }

    fastify.log.info(`[Attachments] Chunked ${attachment.original_name}: ${chunks.length} chunks`);

    // Hook: on_document_chunked
    eventBus.emit('on_document_chunked', {
      attachmentId, originalName: attachment.original_name,
      chunksCount: chunks.length, userId: attachment.user_id,
    }, { userId: attachment.user_id }).catch(() => {});

    // Attempt vector indexing (Layer 3) -- async, non-blocking
    indexChunks(fastify.db, attachmentId, chunks).then(indexed => {
      if (indexed) {
        fastify.log.info(`[Attachments] Vector indexed ${attachment.original_name}`);
      }
    }).catch(vecErr => {
      fastify.log.warn(`[Attachments] Vector indexing skipped/failed: ${vecErr.message}`);
    });
  } catch (chunkError: any) {
    // Chunking failure should not prevent processing from completing
    fastify.log.warn(`[Attachments] Chunking failed for ${attachment.original_name}: ${chunkError.message}`);
  }
}

/**
 * Queue attachment for async processing
 */
export function queueAttachmentProcessing(fastify: FastifyInstance, attachmentId: number, processor: string): void {
  console.log(`[Attachments] queueAttachmentProcessing called: id=${attachmentId}, processor=${processor}`);
  setImmediate(() => {
    (async () => {
      try {
        // Mark as processing
        await updateOne(
          fastify.db,
          'UPDATE chat_attachments SET processing_status = ? WHERE id = ?',
          ['processing', attachmentId]
        );

        // Get attachment
        const attachment = await findOne<ChatAttachment>(
          fastify.db,
          'SELECT * FROM chat_attachments WHERE id = ?',
          [attachmentId]
        );

        if (!attachment) return;

        // Process based on type
        const content = await processAttachmentContent(attachment, processor, fastify.log);

        // Update with processed content
        await updateOne(
          fastify.db,
          'UPDATE chat_attachments SET processing_status = ?, processed_content = ?, processed_at = NOW() WHERE id = ?',
          ['completed', content, attachmentId]
        );

        // Chunk and index for smart retrieval
        if (content) {
          await chunkAndIndex(fastify, attachmentId, attachment, content);
        }

        fastify.log.info(`[Attachments] Processed: ${attachment.original_name} with ${processor}`);

      } catch (error: any) {
        fastify.log.error(`[Attachments] Processing error: ${error.message}`);

        await updateOne(
          fastify.db,
          'UPDATE chat_attachments SET processing_status = ?, processing_error = ? WHERE id = ?',
          ['failed', error.message, attachmentId]
        );
      }
    })().catch((fatalErr: any) => {
      console.error(`[Attachments] FATAL unhandled error processing attachment ${attachmentId}: ${fatalErr.message}`, fatalErr.stack);
      updateOne(
        fastify.db,
        'UPDATE chat_attachments SET processing_status = ?, processing_error = ? WHERE id = ?',
        ['failed', `Unhandled: ${fatalErr.message}`, attachmentId]
      ).catch(() => { });
    });
  });
}
