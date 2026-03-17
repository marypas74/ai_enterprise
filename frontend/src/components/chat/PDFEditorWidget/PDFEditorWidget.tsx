import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PDFToolbar } from './PDFToolbar';
import { usePDFEditor } from './usePDFEditor';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { Loader2, AlertCircle, FileText } from 'lucide-react';

interface PDFEditorWidgetProps {
  attachmentId: number;
  filename?: string;
}

/**
 * PDFEditorWidget — renders a PDF inline in chat with page navigation,
 * zoom controls, mode switching, and save capability.
 *
 * Rendering strategy: fetches per-page images from the backend
 * (which uses mupdf WASM server-side) to avoid bundling heavy WASM in the frontend.
 */
export const PDFEditorWidget: React.FC<PDFEditorWidgetProps> = ({
  attachmentId,
  filename = 'document.pdf',
}) => {
  const editor = usePDFEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);

  // Fetch PDF info (page count) on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchPdfInfo() {
      editor.setLoading(true);
      editor.setError(null);
      try {
        const token = useAuthStore.getState().accessToken;
        const res = await api.get(`/tools/pdf-info/${attachmentId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled) {
          const info = res.data?.data ?? res.data;
          editor.setTotalPages(info.totalPages ?? info.pageCount ?? 1);
          editor.setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          // Fallback: if info endpoint doesn't exist, assume 1 page and load it
          editor.setTotalPages(1);
          editor.setLoading(false);
        }
      }
    }

    fetchPdfInfo();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId]);

  // Fetch page image whenever currentPage or zoom changes
  useEffect(() => {
    let cancelled = false;
    // Clean up previous blob URL
    if (pageImageUrl) {
      URL.revokeObjectURL(pageImageUrl);
    }

    async function fetchPageImage() {
      try {
        const token = useAuthStore.getState().accessToken;
        const res = await api.get(
          `/tools/pdf-page/${attachmentId}/${editor.currentPage}`,
          {
            params: { zoom: editor.zoom },
            responseType: 'blob',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!cancelled) {
          const url = URL.createObjectURL(res.data);
          setPageImageUrl(url);
        }
      } catch {
        if (!cancelled) {
          setPageImageUrl(null);
        }
      }
    }

    if (!editor.isLoading && editor.totalPages > 0) {
      fetchPageImage();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId, editor.currentPage, editor.zoom, editor.isLoading, editor.totalPages]);

  // Draw image on canvas
  useEffect(() => {
    if (!pageImageUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = pageImageUrl;
  }, [pageImageUrl]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (pageImageUrl) {
        URL.revokeObjectURL(pageImageUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = useCallback(async () => {
    // Save triggers re-upload of the modified PDF as a new attachment
    try {
      const token = useAuthStore.getState().accessToken;
      await api.post(
        `/tools/pdf-save/${attachmentId}`,
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      editor.setDirty(false);
    } catch (err: any) {
      editor.setError(err.message || 'Save failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId]);

  if (editor.error) {
    return (
      <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Errore caricamento PDF
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{editor.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden my-2 max-w-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <FileText className="w-4 h-4 text-blue-500" />
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 truncate">
          {filename}
        </span>
      </div>

      {/* Toolbar */}
      <PDFToolbar
        currentPage={editor.currentPage}
        totalPages={editor.totalPages}
        zoom={editor.zoom}
        mode={editor.mode}
        isDirty={editor.isDirty}
        onPageChange={editor.setCurrentPage}
        onZoomChange={editor.setZoom}
        onModeChange={editor.setMode}
        onSave={handleSave}
      />

      {/* Canvas / Loading */}
      <div className="relative bg-gray-200 dark:bg-gray-900 flex items-center justify-center overflow-auto"
        style={{ minHeight: 300, maxHeight: 600 }}
      >
        {editor.isLoading ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Caricamento PDF...
            </span>
          </div>
        ) : pageImageUrl ? (
          <canvas
            ref={canvasRef}
            className="max-w-full"
            style={{ imageRendering: 'auto' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
            <FileText className="w-12 h-12" />
            <span className="text-sm">Nessuna anteprima disponibile</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFEditorWidget;
