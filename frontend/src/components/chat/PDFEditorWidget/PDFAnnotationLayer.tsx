import React, { useState, useCallback } from 'react';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { Loader2 } from 'lucide-react';

type AnnotationType = 'highlight' | 'note' | 'underline' | 'strikethrough' | 'stamp' | 'draw';

interface PDFAnnotationLayerProps {
  attachmentId: number;
  currentPage: number;
  zoom: number;
  activeAnnotation: AnnotationType | null;
  onAnnotationComplete: () => void;
  onDirty: () => void;
}

interface PendingAnnotation {
  type: AnnotationType;
  x: number;
  y: number;
}

/**
 * PDFAnnotationLayer — overlay for placing annotations on the PDF canvas.
 * All operations are server-side via API calls to the pdf_annotate tool.
 * Click coordinates on the rendered page image are scaled back to PDF coordinates.
 */
export const PDFAnnotationLayer: React.FC<PDFAnnotationLayerProps> = ({
  attachmentId,
  currentPage,
  zoom,
  activeAnnotation,
  onAnnotationComplete,
  onDirty,
}) => {
  const [pending, setPending] = useState<PendingAnnotation | null>(null);
  const [noteText, setNoteText] = useState('');
  const [stampType, setStampType] = useState<string>('Approved');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeAnnotation) return;

      const rect = e.currentTarget.getBoundingClientRect();
      // Convert screen coords to PDF coords (approximate: 72 DPI base)
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;

      if (activeAnnotation === 'note' || activeAnnotation === 'stamp') {
        setPending({ type: activeAnnotation, x, y });
      } else {
        // highlight/underline/strikethrough need search text — prompt for it
        setPending({ type: activeAnnotation, x, y });
      }
    },
    [activeAnnotation, zoom],
  );

  const executeAnnotation = useCallback(
    async (searchText?: string) => {
      if (!pending) return;
      setIsProcessing(true);
      setError(null);

      try {
        const token = useAuthStore.getState().accessToken;
        const body: Record<string, unknown> = {
          action: pending.type === 'note' ? 'sticky_note' : pending.type,
          attachment_id: attachmentId,
          page: currentPage - 1, // 0-based
        };

        if (pending.type === 'note') {
          body.x = pending.x;
          body.y = pending.y;
          body.text = noteText || 'Note';
        } else if (pending.type === 'stamp') {
          body.x = pending.x;
          body.y = pending.y;
          body.stamp_type = stampType;
        } else if (searchText) {
          // highlight, underline, strikethrough
          body.search_text = searchText;
        }

        await api.post('/tools/pdf-annotate', body, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        onDirty();
        onAnnotationComplete();
      } catch (err: any) {
        setError(err?.response?.data?.error || err.message || 'Annotation failed');
      } finally {
        setIsProcessing(false);
        setPending(null);
        setNoteText('');
      }
    },
    [pending, attachmentId, currentPage, noteText, stampType, onDirty, onAnnotationComplete],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const formData = new FormData(form);
      const searchText = formData.get('searchText') as string;
      executeAnnotation(searchText || undefined);
    },
    [executeAnnotation],
  );

  if (!activeAnnotation) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'auto' }}>
      {/* Click capture layer */}
      <div
        className="absolute inset-0 cursor-crosshair"
        onClick={handleCanvasClick}
      />

      {/* Pending annotation dialog */}
      {pending && (
        <div
          className="absolute z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 p-3 min-w-[220px]"
          style={{ left: pending.x * zoom, top: pending.y * zoom }}
          onClick={(e) => e.stopPropagation()}
        >
          {isProcessing ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Applicazione...</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {(pending.type === 'highlight' || pending.type === 'underline' || pending.type === 'strikethrough') && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    Testo da {pending.type === 'highlight' ? 'evidenziare' : pending.type === 'underline' ? 'sottolineare' : 'barrare'}:
                  </label>
                  <input
                    name="searchText"
                    type="text"
                    autoFocus
                    className="mt-1 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    placeholder="Inserisci testo..."
                  />
                </div>
              )}

              {pending.type === 'note' && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Nota:</label>
                  <textarea
                    autoFocus
                    className="mt-1 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    rows={3}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Scrivi nota..."
                  />
                </div>
              )}

              {pending.type === 'stamp' && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Tipo timbro:</label>
                  <select
                    className="mt-1 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    value={stampType}
                    onChange={(e) => setStampType(e.target.value)}
                  >
                    <option value="Approved">Approvato</option>
                    <option value="NotApproved">Non Approvato</option>
                    <option value="Draft">Bozza</option>
                    <option value="Confidential">Riservato</option>
                    <option value="Final">Definitivo</option>
                  </select>
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Applica
                </button>
                <button
                  type="button"
                  className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300"
                  onClick={() => setPending(null)}
                >
                  Annulla
                </button>
              </div>
            </form>
          )}

          {error && (
            <p className="text-xs text-red-500 mt-1">{error}</p>
          )}
        </div>
      )}
    </div>
  );
};
