import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, FileText, AlertTriangle, CheckCircle, Download } from 'lucide-react';
import { createOnlyOfficeSession, getOnlyOfficeSessionStatus } from '../../services/pdfEditorApi';
import type { OnlyOfficeSessionResponse } from '../../services/pdfEditorApi';
import { PDFEditorWidget } from './PDFEditorWidget/PDFEditorWidget';
import { downloadFile } from '../../utils/fileDownload';
import { useAuthStore } from '../../hooks/useAuthStore';

interface PDFEditorPanelProps {
  attachmentId: number;
  filename: string;
  onClose: () => void;
  onSaved: (newAttachmentId: number, newFilename: string) => void;
}

export default function PDFEditorPanel({ attachmentId, filename, onClose, onSaved }: PDFEditorPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<OnlyOfficeSessionResponse | null>(null);
  const [saveStatus, setSaveStatus] = useState<'editing' | 'saved' | 'error'>('editing');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scriptLoadedRef = useRef(false);

  // Create OnlyOffice session on mount
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        setLoading(true);
        setError(null);
        const sessionData = await createOnlyOfficeSession(attachmentId);
        if (!cancelled) {
          setSession(sessionData);
        }
      } catch (err: any) {
        if (!cancelled) {
          const status = err.response?.status;
          const serverMsg = err.response?.data?.error;
          const serverCode = err.response?.data?.code;
          if (status === 503) {
            setError('OnlyOffice non è configurato sul server.');
          } else if (status === 404) {
            setError(serverMsg || 'Allegato non trovato.');
          } else if (status === 413) {
            setError(serverMsg || 'Il file è troppo grande (max 50MB).');
          } else if (status === 400) {
            setError(serverMsg || 'Il file non è un PDF.');
          } else if (status === 422 && serverCode === 'NO_TEXT') {
            setError(serverMsg || 'PDF scansionato o privo di testo: usa la visualizzazione con annotazioni.');
          } else if (status === 422) {
            setError(serverMsg || 'PDF non convertibile in formato editabile.');
          } else if (status === 504) {
            setError(serverMsg || 'Conversione PDF troppo lenta. Riprova o usa un file più piccolo.');
          } else {
            setError(serverMsg || 'Errore durante la creazione della sessione di editing.');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [attachmentId]);

  // Load OnlyOffice editor script and initialize when session is ready
  useEffect(() => {
    if (!session) return;

    const publicUrl = session.publicUrl;
    const scriptUrl = `${publicUrl}/web-apps/apps/api/documents/api.js`;

    const initEditor = () => {
      try {
        const editorContainer = document.getElementById('onlyoffice-editor-container');
        if (!editorContainer) return;

        // Clear previous editor instance safely (no untrusted content)
        while (editorContainer.firstChild) {
          editorContainer.removeChild(editorContainer.firstChild);
        }

        const config = {
          ...session.editorConfig,
          events: {
            onDocumentStateChange: (event: { data: boolean }) => {
              // data === true means document has unsaved changes
              if (!event.data) {
                // Document was saved, start polling for save status
                startPolling();
              }
            },
            onError: (event: { data: string }) => {
              console.error('[OnlyOffice] Editor error:', event.data);
            },
          },
        };

        // @ts-expect-error DocsAPI is loaded from external script
        new window.DocsAPI.DocEditor('onlyoffice-editor-container', config);
      } catch (err) {
        console.error('[OnlyOffice] Failed to initialize editor:', err);
        setError('Errore durante l\'inizializzazione dell\'editor OnlyOffice.');
      }
    };

    // Check if script is already loaded
    // @ts-expect-error DocsAPI is loaded from external script
    if (window.DocsAPI) {
      initEditor();
      return;
    }

    // Load the OnlyOffice API script
    if (!scriptLoadedRef.current) {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => {
        scriptLoadedRef.current = true;
        initEditor();
      };
      script.onerror = () => {
        setError('Impossibile caricare lo script di OnlyOffice. Verifica che il server sia raggiungibile.');
      };
      document.head.appendChild(script);
    }
  }, [session]);

  // Poll for save status
  const startPolling = useCallback(() => {
    if (!session || pollRef.current) return;

    pollRef.current = setInterval(async () => {
      try {
        const status = await getOnlyOfficeSessionStatus(session.documentKey);
        if (status.status === 'saved' && status.newAttachmentId && status.newFilename) {
          setSaveStatus('saved');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          onSaved(status.newAttachmentId, status.newFilename);
        } else if (status.status === 'error') {
          setSaveStatus('error');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Polling error, will retry on next interval
      }
    }, 2000);
  }, [session, onSaved]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    if (saveStatus === 'editing') {
      if (!window.confirm('Se chiudi ora, le modifiche non salvate andranno perse. Vuoi chiudere?')) return;
    }
    onClose();
  }, [saveStatus, onClose]);

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
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Salvato
            </span>
          )}
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

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
            <p className="text-sm text-surface-400">Preparazione editor PDF...</p>
          </div>
        ) : error && !session ? (
          /* Fallback: use inline PDF viewer/editor when OnlyOffice is unavailable */
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-900/20 border-b border-amber-800/30 text-amber-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Editor avanzato non disponibile — visualizzazione PDF con annotazioni</span>
              <button
                onClick={() => downloadFile(`/api/tools/download/${filename}`, filename, useAuthStore.getState().accessToken || undefined)}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-primary-600 hover:bg-primary-500 text-white text-xs transition-colors"
                title="Scarica PDF"
              >
                <Download className="w-3 h-3" />
                Scarica
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <PDFEditorWidget attachmentId={attachmentId} filename={filename} />
            </div>
          </div>
        ) : (
          <div
            id="onlyoffice-editor-container"
            className="w-full h-full"
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-surface-700 text-[10px] text-surface-500">
        <span>
          {saveStatus === 'editing' && 'In modifica'}
          {saveStatus === 'saved' && 'PDF salvato con successo'}
          {saveStatus === 'error' && 'Errore durante il salvataggio'}
        </span>
        <span>{session ? 'OnlyOffice Document Editor' : 'PDF Viewer'}</span>
      </div>
    </div>
  );
}
