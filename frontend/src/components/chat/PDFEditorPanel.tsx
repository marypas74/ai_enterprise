import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Image as ImageExtension } from '@tiptap/extension-image';
import { Table as TableExtension } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Underline as UnderlineExtension } from '@tiptap/extension-underline';
import { TextAlign } from '@tiptap/extension-text-align';
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

  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await convertPdfToHtml(attachmentId);
        if (!cancelled && editorRef.current) {
          editorRef.current.commands.setContent(result.html);
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
    load();
    return () => { cancelled = true; };
  }, [attachmentId]);

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
