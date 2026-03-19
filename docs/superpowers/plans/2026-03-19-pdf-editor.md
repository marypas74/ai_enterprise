# PDF Editor in Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to edit PDF attachments inline in the chat via a slide-in side panel with rich text editing.

**Architecture:** Backend converts PDF to HTML via LibreOffice (reusing existing patterns from `DocumentProcessorService`). Frontend opens a TipTap WYSIWYG editor in a right-side panel. On save, backend converts HTML to PDF and creates a new attachment. Dual trigger: manual button on PDF attachments + automatic AI marker detection.

**Tech Stack:** TipTap (rich text editor), LibreOffice headless (PDF conversion), Fastify (API), React + Zustand (frontend state)

**Spec:** `docs/superpowers/specs/2026-03-19-pdf-editor-design.md`

---

## File Structure

### Backend (new files)
| File | Responsibility |
|---|---|
| `backend/src/modules/tools/pdfEditorRoutes.ts` | Route handlers for convert and save endpoints |
| `backend/src/modules/tools/pdfEditorService.ts` | LibreOffice conversion logic, temp file management, scanned PDF detection |
| `backend/src/modules/tools/__tests__/pdfEditorService.test.ts` | Unit tests for conversion service |

### Backend (modified files)
| File | Change |
|---|---|
| `backend/src/modules/tools/routes.ts` | Register `pdfEditorRoutes` sub-plugin |

### Frontend (new files)
| File | Responsibility |
|---|---|
| `frontend/src/hooks/usePDFEditorStore.ts` | Zustand store: isOpen, attachmentId, filename, openEditor, closeEditor |
| `frontend/src/components/chat/PDFEditorPanel.tsx` | Side panel container: header, TipTap editor, save/close logic |
| `frontend/src/components/chat/PDFEditorToolbar.tsx` | TipTap toolbar: formatting, headings, lists, image, table, undo/redo |
| `frontend/src/services/pdfEditorApi.ts` | API client: convertPdf(), savePdf() |

### Frontend (modified files)
| File | Change |
|---|---|
| `frontend/src/pages/ChatPage.tsx` | Render `PDFEditorPanel` conditionally, adjust chat width |
| `frontend/src/components/chat/ChatMessageList.tsx` | Add "Modifica PDF" button on PDF attachments, detect AI editor markers |

---

## Task 1: Backend — PDF Editor Service

**Files:**
- Create: `backend/src/modules/tools/pdfEditorService.ts`
- Create: `backend/src/modules/tools/__tests__/pdfEditorService.test.ts`

**Context:** The backend already has `convertOfficeToPdf` in `backend/src/services/DocumentProcessorService.ts:704` which runs LibreOffice headless. We need similar functions for PDF-to-HTML and HTML-to-PDF conversions. LibreOffice is already installed in the Docker image. Use `execFile` from `child_process` (NOT `exec`) to avoid shell injection.

- [ ] **Step 1: Write tests for pdfEditorService**

```typescript
// backend/src/modules/tools/__tests__/pdfEditorService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanupOldTempDirs, isScannedPdf } from '../pdfEditorService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('pdfEditorService', () => {
  describe('cleanupOldTempDirs', () => {
    let oldDir: string;

    beforeEach(async () => {
      oldDir = path.join(os.tmpdir(), `pdf-editor-999-${Date.now()}`);
      await fs.mkdir(oldDir, { recursive: true });
      const oldTime = new Date(Date.now() - 3600000);
      await fs.utimes(oldDir, oldTime, oldTime);
    });

    afterEach(async () => {
      await fs.rm(oldDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should remove directories older than maxAgeMs', async () => {
      await cleanupOldTempDirs(1800000);
      const exists = await fs.access(oldDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should keep directories newer than maxAgeMs', async () => {
      const newDir = path.join(os.tmpdir(), `pdf-editor-888-${Date.now()}`);
      await fs.mkdir(newDir, { recursive: true });
      await cleanupOldTempDirs(1800000);
      const exists = await fs.access(newDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      await fs.rm(newDir, { recursive: true, force: true });
    });
  });

  describe('isScannedPdf', () => {
    it('should return true for HTML with only images and < 50 chars text', () => {
      const html = '<html><body><img src="data:image/png;base64,abc"/></body></html>';
      expect(isScannedPdf(html)).toBe(true);
    });

    it('should return false for HTML with substantial text', () => {
      const html = '<html><body><p>Questo e un contratto di servizio tra le parti contraenti per la fornitura.</p></body></html>';
      expect(isScannedPdf(html)).toBe(false);
    });

    it('should return true for empty HTML', () => {
      expect(isScannedPdf('<html><body></body></html>')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/tools/__tests__/pdfEditorService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pdfEditorService**

Use `execFile` from `child_process` (not `exec`) for all LibreOffice invocations. Arguments are passed as an array, preventing shell injection.

```typescript
// backend/src/modules/tools/pdfEditorService.ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);
const SOFFICE_TIMEOUT = 60000;

export async function cleanupOldTempDirs(maxAgeMs: number = 1800000): Promise<void> {
  const tmpBase = os.tmpdir();
  try {
    const entries = await fs.readdir(tmpBase);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith('pdf-editor-')) continue;
      const fullPath = path.join(tmpBase, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && (now - stat.mtimeMs) > maxAgeMs) {
          await fs.rm(fullPath, { recursive: true, force: true });
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

export function isScannedPdf(html: string): boolean {
  const textOnly = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return textOnly.length < 50;
}

async function runSoffice(args: string[], timeout: number = SOFFICE_TIMEOUT): Promise<void> {
  await execFileAsync('soffice', args, { timeout });
}

export async function convertPdfToHtml(
  pdfPath: string,
  userId: number
): Promise<{ html: string; tempDir: string }> {
  await cleanupOldTempDirs();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-editor-${userId}-`));

  try {
    const pdfCopy = path.join(tempDir, 'input.pdf');
    await fs.copyFile(pdfPath, pdfCopy);

    // PDF -> DOCX
    await runSoffice([
      '--headless',
      '--infilter=writer_pdf_import',
      '--convert-to', 'docx',
      '--outdir', tempDir,
      pdfCopy,
    ]);
    const docxPath = path.join(tempDir, 'input.docx');
    await fs.access(docxPath);

    // DOCX -> HTML
    await runSoffice([
      '--headless',
      '--convert-to', 'html',
      '--outdir', tempDir,
      docxPath,
    ]);
    const htmlPath = path.join(tempDir, 'input.html');
    await fs.access(htmlPath);

    let html = await fs.readFile(htmlPath, 'utf-8');

    // Convert local image refs to base64 data URIs
    const imgRegex = /src="([^"]+)"/g;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const imgSrc = match[1];
      if (imgSrc.startsWith('data:')) continue;
      const imgPath = path.resolve(tempDir, imgSrc);
      try {
        const imgBuffer = await fs.readFile(imgPath);
        const ext = path.extname(imgPath).slice(1) || 'png';
        const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        html = html.replace(imgSrc, `data:${mimeType};base64,${imgBuffer.toString('base64')}`);
      } catch { /* skip */ }
    }

    if (isScannedPdf(html)) {
      await fs.rm(tempDir, { recursive: true, force: true });
      const err = new Error('Il PDF sembra essere una scansione e non contiene testo editabile');
      (err as any).statusCode = 422;
      throw err;
    }

    return { html, tempDir };
  } catch (error: any) {
    if (error.statusCode === 422) throw error;
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Conversione PDF fallita: ${error.message}`);
  }
}

export async function convertHtmlToPdf(
  html: string,
  userId: number
): Promise<{ pdfBuffer: Buffer; tempDir: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-editor-${userId}-`));

  try {
    const htmlPath = path.join(tempDir, 'edited.html');
    await fs.writeFile(htmlPath, html, 'utf-8');

    // HTML -> DOCX
    await runSoffice([
      '--headless',
      '--convert-to', 'docx',
      '--outdir', tempDir,
      htmlPath,
    ]);
    const docxPath = path.join(tempDir, 'edited.docx');
    await fs.access(docxPath);

    // DOCX -> PDF
    await runSoffice([
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tempDir,
      docxPath,
    ]);
    const pdfPath = path.join(tempDir, 'edited.pdf');
    await fs.access(pdfPath);

    const pdfBuffer = await fs.readFile(pdfPath);
    return { pdfBuffer, tempDir };
  } catch (error: any) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Conversione HTML-PDF fallita: ${error.message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/tools/__tests__/pdfEditorService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tools/pdfEditorService.ts backend/src/modules/tools/__tests__/pdfEditorService.test.ts
git commit -m "feat: add PDF editor conversion service (LibreOffice PDF<->HTML)"
```

---

## Task 2: Backend — PDF Editor Routes

**Files:**
- Create: `backend/src/modules/tools/pdfEditorRoutes.ts`
- Modify: `backend/src/modules/tools/routes.ts` (register sub-plugin)

**Context:** Routes follow the pattern in `backend/src/modules/tools/routes.ts`. Auth uses `(fastify as any).authenticate` as onRequest handler. Database helpers `findOne`, `insertOne` are in `backend/src/database/index.js`. Attachments are stored on disk with paths in `chat_attachments` table (see `backend/src/modules/attachments/types.ts` for `ChatAttachment` interface). The `STORAGE_ROOT` env var points to the base storage directory.

- [ ] **Step 1: Create pdfEditorRoutes**

```typescript
// backend/src/modules/tools/pdfEditorRoutes.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findOne, insertOne } from '../../database/index.js';
import { convertPdfToHtml, convertHtmlToPdf } from './pdfEditorService.js';
import fs from 'fs/promises';
import path from 'path';

const convertSchema = z.object({
  attachmentId: z.number().int().positive(),
});

const saveSchema = z.object({
  attachmentId: z.number().int().positive(),
  html: z.string().min(1),
  filename: z.string().optional(),
});

export async function pdfEditorRoutes(fastify: FastifyInstance) {

  // POST /tools/pdf-editor/convert
  fastify.post('/tools/pdf-editor/convert', {
    onRequest: [(fastify as any).authenticate],
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const body = convertSchema.parse(request.body);

    const attachment = await findOne(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [body.attachmentId, userId, userId]
    );

    if (!attachment) {
      return reply.status(404).send({ error: 'Allegato non trovato' });
    }
    if (attachment.mime_type !== 'application/pdf') {
      return reply.status(400).send({ error: 'Il file non e un PDF' });
    }

    const stat = await fs.stat(attachment.file_path).catch(() => null);
    if (!stat) {
      return reply.status(404).send({ error: 'File non trovato su disco' });
    }
    if (stat.size > 50 * 1024 * 1024) {
      return reply.status(413).send({ error: 'Il file e troppo grande (max 50MB)' });
    }

    try {
      const { html, tempDir } = await convertPdfToHtml(attachment.file_path, userId);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return { html, filename: attachment.original_name };
    } catch (error: any) {
      const status = error.statusCode || 500;
      return reply.status(status).send({ error: error.message || 'Errore di conversione' });
    }
  });

  // POST /tools/pdf-editor/save
  fastify.post('/tools/pdf-editor/save', {
    onRequest: [(fastify as any).authenticate],
    bodyLimit: 100 * 1024 * 1024,
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    const body = saveSchema.parse(request.body);

    const original = await findOne(
      fastify.db,
      `SELECT a.*, c.user_id as conv_user_id FROM chat_attachments a
       JOIN conversations c ON a.conversation_id = c.id
       WHERE a.id = ? AND (a.user_id = ? OR c.user_id = ?)`,
      [body.attachmentId, userId, userId]
    );

    if (!original) {
      return reply.status(404).send({ error: 'Allegato originale non trovato' });
    }

    try {
      // Sanitize HTML: strip script tags and event handlers to prevent XSS
      const sanitizedHtml = body.html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');

      const { pdfBuffer, tempDir } = await convertHtmlToPdf(sanitizedHtml, userId);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

      const baseName = body.filename
        ? path.basename(body.filename, '.pdf')
        : path.basename(original.original_name, '.pdf');
      const newFileName = `${baseName}_edited_${Date.now()}.pdf`;
      const dir = path.dirname(original.file_path);
      const newFilePath = path.join(dir, newFileName);

      await fs.writeFile(newFilePath, pdfBuffer);

      const newId = await insertOne(
        fastify.db,
        `INSERT INTO chat_attachments
         (conversation_id, user_id, file_name, original_name, file_path, file_size, mime_type, content_type, processing_status)
         VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', 'document', 'completed')`,
        [original.conversation_id, userId, newFileName, `${baseName}_edited.pdf`, newFilePath, pdfBuffer.length]
      );

      fastify.log.info(`[PDFEditor] Saved edited PDF: ${newFileName} (${pdfBuffer.length} bytes)`);

      return { attachmentId: newId, filename: `${baseName}_edited.pdf`, size: pdfBuffer.length };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Errore di salvataggio' });
    }
  });
}
```

- [ ] **Step 2: Register pdfEditorRoutes in tools/routes.ts**

At top of `backend/src/modules/tools/routes.ts`, add import:
```typescript
import { pdfEditorRoutes } from './pdfEditorRoutes.js';
```

Inside the `toolsRoutes` function (after line 23 `export async function toolsRoutes(fastify: FastifyInstance) {`), add:
```typescript
  await fastify.register(pdfEditorRoutes);
```

- [ ] **Step 3: Verify build compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/tools/pdfEditorRoutes.ts backend/src/modules/tools/routes.ts
git commit -m "feat: add PDF editor API endpoints (convert + save)"
```

---

## Task 3: Frontend — Install TipTap Dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install TipTap packages**

```bash
cd frontend && npm install --legacy-peer-deps @tiptap/react @tiptap/starter-kit @tiptap/extension-image @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-underline @tiptap/extension-text-align @tiptap/pm
```

- [ ] **Step 2: Verify build still works**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

- [ ] **Step 3: Commit**

```bash
cd frontend && git add package.json package-lock.json
git commit -m "chore: install TipTap editor dependencies for PDF editing"
```

---

## Task 4: Frontend — PDF Editor API Client and Store

**Files:**
- Create: `frontend/src/services/pdfEditorApi.ts`
- Create: `frontend/src/hooks/usePDFEditorStore.ts`

- [ ] **Step 1: Create API client**

```typescript
// frontend/src/services/pdfEditorApi.ts
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
```

- [ ] **Step 2: Create Zustand store**

```typescript
// frontend/src/hooks/usePDFEditorStore.ts
import { create } from 'zustand';

interface PDFEditorState {
  isOpen: boolean;
  attachmentId: number | null;
  filename: string;
  openEditor: (attachmentId: number, filename: string) => void;
  closeEditor: () => void;
}

export const usePDFEditorStore = create<PDFEditorState>((set) => ({
  isOpen: false,
  attachmentId: null,
  filename: '',
  openEditor: (attachmentId, filename) => set({ isOpen: true, attachmentId, filename }),
  closeEditor: () => set({ isOpen: false, attachmentId: null, filename: '' }),
}));
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/pdfEditorApi.ts frontend/src/hooks/usePDFEditorStore.ts
git commit -m "feat: add PDF editor API client and Zustand store"
```

---

## Task 5: Frontend — PDF Editor Toolbar

**Files:**
- Create: `frontend/src/components/chat/PDFEditorToolbar.tsx`

**Context:** TipTap editor instance is passed via prop. Toolbar buttons call `editor.chain().focus().<command>().run()`. Use the same Tailwind classes as the rest of the app (bg-surface-*, text-surface-*, etc.). Lucide icons are already available in the project.

- [ ] **Step 1: Create toolbar component**

```typescript
// frontend/src/components/chat/PDFEditorToolbar.tsx
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  Image, Table,
  Undo2, Redo2,
} from 'lucide-react';
import clsx from 'clsx';

interface PDFEditorToolbarProps {
  editor: Editor | null;
}

export default function PDFEditorToolbar({ editor }: PDFEditorToolbarProps) {
  if (!editor) return null;

  const btnClass = (active: boolean) => clsx(
    'p-1.5 rounded transition-colors',
    active
      ? 'bg-primary-600 text-white'
      : 'bg-surface-700 text-surface-300 hover:bg-surface-600 hover:text-white'
  );

  const separator = <div className="w-px h-6 bg-surface-600 mx-1" />;

  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          editor.chain().focus().setImage({ src: reader.result }).run();
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="flex items-center gap-1 p-2 border-b border-surface-700 flex-wrap">
      <button className={btnClass(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Grassetto">
        <Bold className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Corsivo">
        <Italic className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sottolineato">
        <Underline className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Barrato">
        <Strikethrough className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Titolo 1">
        <Heading1 className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Titolo 2">
        <Heading2 className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Titolo 3">
        <Heading3 className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista puntata">
        <List className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerata">
        <ListOrdered className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Allinea a sinistra">
        <AlignLeft className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Centra">
        <AlignCenter className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive({ textAlign: 'right' }))} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Allinea a destra">
        <AlignRight className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(false)} onClick={addImage} title="Inserisci immagine">
        <Image className="w-4 h-4" />
      </button>
      <button className={btnClass(false)} onClick={addTable} title="Inserisci tabella">
        <Table className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(false)} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Annulla"
        style={{ opacity: editor.can().undo() ? 1 : 0.4 }}>
        <Undo2 className="w-4 h-4" />
      </button>
      <button className={btnClass(false)} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Ripeti"
        style={{ opacity: editor.can().redo() ? 1 : 0.4 }}>
        <Redo2 className="w-4 h-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/PDFEditorToolbar.tsx
git commit -m "feat: add PDF editor toolbar component"
```

---

## Task 6: Frontend — PDF Editor Panel

**Files:**
- Create: `frontend/src/components/chat/PDFEditorPanel.tsx`

**Context:** This is the main side panel component. It fetches HTML from the convert API on mount, renders TipTap editor, handles save. Uses the same dark theme as the rest of the app. On mobile (<768px), renders at full width as overlay.

- [ ] **Step 1: Create PDFEditorPanel component**

```typescript
// frontend/src/components/chat/PDFEditorPanel.tsx
import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import TableExtension from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import UnderlineExtension from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { X, Save, Loader2, FileText, AlertTriangle } from 'lucide-react';
import PDFEditorToolbar from './PDFEditorToolbar';
import { convertPdfToHtml, saveEditedPdf } from '../../services/pdfEditorApi';

interface PDFEditorPanelProps {
  attachmentId: number;
  filename: string;
  onClose: () => void;
  onSaved: (newAttachmentId: number, newFilename: string) => void;
}

export default function PDFEditorPanel({ attachmentId, filename, onClose, onSaved }: PDFEditorPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExtension,
      ImageExtension.configure({ inline: false, allowBase64: true }),
      TableExtension.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '<p>Caricamento...</p>',
    onUpdate: () => setDirty(true),
    editable: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await convertPdfToHtml(attachmentId);
        if (!cancelled && editor) {
          editor.commands.setContent(result.html);
          setDirty(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.response?.data?.error || err.message || 'Errore di conversione');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (editor) load();
    return () => { cancelled = true; };
  }, [attachmentId, editor]);

  const handleSave = useCallback(async () => {
    if (!editor || saving) return;
    try {
      setSaving(true);
      setError(null);
      const html = editor.getHTML();
      const result = await saveEditedPdf(attachmentId, html, filename);
      setDirty(false);
      onSaved(result.attachmentId, result.filename);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Errore di salvataggio');
    } finally {
      setSaving(false);
    }
  }, [editor, attachmentId, filename, saving, onSaved]);

  const handleClose = useCallback(() => {
    if (dirty && !window.confirm('Hai modifiche non salvate. Vuoi chiudere comunque?')) return;
    onClose();
  }, [dirty, onClose]);

  return (
    <div className="flex flex-col h-full bg-surface-950 border-l border-surface-700 w-full md:w-[55%] absolute md:relative right-0 top-0 bottom-0 z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-primary-400">Editor PDF</span>
          <span className="text-xs text-surface-400 truncate">{filename}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty || saving || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salva PDF
          </button>
          <button onClick={handleClose} className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors" title="Chiudi editor">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Toolbar */}
      {!loading && !error && <PDFEditorToolbar editor={editor} />}

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto p-6 bg-surface-900">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
            <p className="text-sm text-surface-400">Conversione PDF in corso...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-surface-400">{error}</p>
          </div>
        ) : (
          <div className="max-w-[800px] mx-auto bg-white rounded shadow-lg p-10 min-h-[600px] prose prose-sm max-w-none
                          [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[500px]
                          [&_.ProseMirror_p]:text-gray-800 [&_.ProseMirror_p]:leading-relaxed
                          [&_.ProseMirror_h1]:text-gray-900 [&_.ProseMirror_h2]:text-gray-900 [&_.ProseMirror_h3]:text-gray-900
                          [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded
                          [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-gray-300 [&_.ProseMirror_td]:p-2
                          [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-gray-300 [&_.ProseMirror_th]:p-2 [&_.ProseMirror_th]:bg-gray-100">
            <EditorContent editor={editor} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-surface-700 text-[10px] text-surface-500">
        <span>{dirty ? 'Modificato' : 'Nessuna modifica'}</span>
        <span>Formato originale: PDF (convertito via LibreOffice)</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/PDFEditorPanel.tsx
git commit -m "feat: add PDF editor side panel with TipTap WYSIWYG"
```

---

## Task 7: Frontend — Integration in ChatPage and ChatMessageList

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/src/components/chat/ChatMessageList.tsx`

**Context:** `ChatPage.tsx` is 442 lines, renders `ChatSidebar`, `ChatMessageList`, and `ChatInputArea`. `ChatMessageList.tsx` is 250 lines, renders messages with ReactMarkdown. PDF attachments appear in message content as text like `[Allegato: filename.pdf (document)]` or `[Allegato ID=X: filename.pdf]`. The AI trigger marker is `<!-- pdf_editor:attachmentId=X,filename=Y -->`.

- [ ] **Step 1: Add PDF editor panel rendering in ChatPage.tsx**

Add imports at top of `frontend/src/pages/ChatPage.tsx`:
```typescript
import { usePDFEditorStore } from '../hooks/usePDFEditorStore';
import { lazy, Suspense } from 'react';

const PDFEditorPanel = lazy(() => import('../components/chat/PDFEditorPanel'));
```

Add `Loader2` to the existing lucide-react import.

Inside `ChatPage` component function, after existing hooks add:
```typescript
const pdfEditor = usePDFEditorStore();
```

Wrap the main chat content area with a flex container that includes the editor panel. The chat area should get a dynamic width class:
```tsx
className={clsx('flex-1 flex flex-col min-w-0', pdfEditor.isOpen && 'md:w-[45%]')}
```

After the chat content area (still inside the main flex wrapper), add:
```tsx
{pdfEditor.isOpen && pdfEditor.attachmentId && (
  <Suspense fallback={<div className="w-[55%] bg-surface-950 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>}>
    <PDFEditorPanel
      attachmentId={pdfEditor.attachmentId}
      filename={pdfEditor.filename}
      onClose={pdfEditor.closeEditor}
      onSaved={(newId, newFilename) => {
        pdfEditor.closeEditor();
        // Add a system message showing the saved PDF
        chatMessages.addLocalMessage(`PDF salvato con successo: **${newFilename}** (ID: ${newId})`);
      }}
    />
  </Suspense>
)}
```

- [ ] **Step 2: Add PDF edit button and AI marker detection in ChatMessageList.tsx**

Add imports at top of `frontend/src/components/chat/ChatMessageList.tsx`:
```typescript
import React, { useEffect } from 'react';
import { Edit3 } from 'lucide-react';
import { usePDFEditorStore } from '../../hooks/usePDFEditorStore';
```

Before `const markdownComponents` (around line 94), add:
```typescript
const PDF_EDITOR_MARKER = /<!-- pdf_editor:attachmentId=(\d+),filename=(.+?) -->/;
const PDF_ATTACHMENT_REF = /\[Allegato(?:\s+ID=(\d+))?:\s*([^\]]*?\.pdf)\s*(?:\([^)]*\))?\s*\]/gi;
```

Inside the `ChatMessageList` component function, before the return statement, add:
```typescript
const openPdfEditor = usePDFEditorStore(s => s.openEditor);

// Auto-detect AI editor markers
useEffect(() => {
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === 'assistant' && !isStreaming) {
    const match = PDF_EDITOR_MARKER.exec(lastMsg.content);
    if (match) {
      openPdfEditor(parseInt(match[1], 10), match[2]);
    }
  }
}, [messages, isStreaming, openPdfEditor]);
```

After the ReactMarkdown block (after line 200), inside the message content div, add PDF edit buttons for user messages with PDF attachments:
```tsx
{message.role === 'user' && message.content && (() => {
  const pdfMatches: { id: string; name: string }[] = [];
  let m;
  const regex = /\[Allegato(?:\s+ID=(\d+))?:\s*([^\]]*?\.pdf)\s*(?:\([^)]*\))?\s*\]/gi;
  while ((m = regex.exec(message.content)) !== null) {
    if (m[1]) pdfMatches.push({ id: m[1], name: m[2].trim() });
  }
  if (pdfMatches.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {pdfMatches.map(pdf => (
        <button
          key={pdf.id}
          onClick={() => openPdfEditor(parseInt(pdf.id, 10), pdf.name)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors"
          title={`Modifica ${pdf.name}`}
        >
          <Edit3 className="w-3 h-3" />
          Modifica PDF
        </button>
      ))}
    </div>
  );
})()}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/components/chat/ChatMessageList.tsx
git commit -m "feat: integrate PDF editor in chat with dual triggers"
```

---

## Task 8: Build Verification

**Files:** All modified files

- [ ] **Step 1: Run backend build**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run backend tests**

Run: `cd backend && npx vitest run src/modules/tools/__tests__/pdfEditorService.test.ts`
Expected: All tests pass

- [ ] **Step 4: Final commit if cleanup needed**

```bash
git status  # Review changes before committing
# git add <specific files> && git commit -m "chore: PDF editor build verification and cleanup"
```
