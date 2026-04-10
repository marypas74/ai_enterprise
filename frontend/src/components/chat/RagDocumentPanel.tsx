import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Trash2,
  X,
  Check,
  FolderOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useDocumentStore, UserDocument } from '../../hooks/useDocumentStore';

// ─── Compact file icon ───────────────────────────────────────────────────────
function FileTypeBadge({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') {
    return <span className="text-[10px] font-bold text-red-400 bg-red-900/30 px-1 py-0.5 rounded">PDF</span>;
  }
  if (mimeType.includes('word') || mimeType.includes('docx')) {
    return <span className="text-[10px] font-bold text-blue-400 bg-blue-900/30 px-1 py-0.5 rounded">DOC</span>;
  }
  return <span className="text-[10px] font-bold text-gray-400 bg-gray-800 px-1 py-0.5 rounded">TXT</span>;
}

// ─── Status indicator ────────────────────────────────────────────────────────
function StatusDot({ status }: { status: UserDocument['status'] }) {
  if (status === 'ready') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'processing') return <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />;
  return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
}

// ─── Compact upload zone ─────────────────────────────────────────────────────
function CompactUploadZone() {
  const { uploadDocument, isUploading } = useDocumentStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      uploadDocument(file);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
      className={`
        flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed cursor-pointer
        transition-all text-xs select-none
        ${isDragging
          ? 'border-indigo-500 bg-indigo-950/30'
          : 'border-surface-700 hover:border-indigo-500 hover:bg-surface-800/50'
        }
      `}
    >
      {isUploading
        ? <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />
        : <Upload className="w-4 h-4 text-surface-500 flex-shrink-0" />
      }
      <span className="text-surface-400">
        {isUploading ? 'Caricamento…' : 'Trascina file o clicca per caricare'}
      </span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.doc,.txt,.md"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
        disabled={isUploading}
      />
    </div>
  );
}

// ─── Document row with selection ─────────────────────────────────────────────
function DocItem({ doc }: { doc: UserDocument }) {
  const { selectedDocumentIds, toggleDocumentId, deleteDocument } = useDocumentStore();
  const isSelected = selectedDocumentIds.includes(doc.id);
  const isReady = doc.status === 'ready';
  const [showDelete, setShowDelete] = React.useState(false);

  const fmt = (bytes: number) => bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div
      className={`
        flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors group cursor-pointer
        ${isSelected
          ? 'bg-indigo-950/40 border border-indigo-700/50'
          : 'hover:bg-surface-800/50 border border-transparent'
        }
      `}
      onClick={() => isReady && toggleDocumentId(doc.id)}
    >
      {/* Selection checkbox */}
      <div className={`
        w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors
        ${isReady ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}
        ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-surface-600'}
      `}>
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </div>

      <FileTypeBadge mimeType={doc.mimeType} />

      <div className="flex-1 min-w-0">
        <p className="text-xs text-surface-200 truncate" title={doc.originalName}>
          {doc.originalName}
        </p>
        <p className="text-[10px] text-surface-500">
          {fmt(doc.size)}
          {isReady && ` · ${doc.chunksCount} chunks`}
        </p>
      </div>

      <StatusDot status={doc.status} />

      {/* Delete button */}
      {showDelete ? (
        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => deleteDocument(doc.id)}
            className="text-[10px] text-red-400 font-semibold hover:underline px-1"
          >Elimina</button>
          <button
            onClick={() => setShowDelete(false)}
            className="text-surface-500 hover:text-surface-300"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-900/30 text-surface-500 hover:text-red-400"
          title="Elimina"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────
export default function RagDocumentPanel() {
  const {
    documents,
    isLoading,
    fetchDocuments,
    selectedDocumentIds,
    selectAllDocuments,
    clearSelection,
    uploadError,
  } = useDocumentStore();

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const readyDocs = documents.filter(d => d.status === 'ready');
  const allSelected = readyDocs.length > 0 && readyDocs.every(d => selectedDocumentIds.includes(d.id));

  return (
    <div className="bg-surface-900/80 border border-surface-700 rounded-xl p-3 mb-3 space-y-0 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(prev => !prev)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-surface-300 uppercase tracking-wider">
            Documenti
          </span>
          {documents.length > 0 && (
            <span className="text-[10px] text-surface-500">
              {selectedDocumentIds.length}/{readyDocs.length} selezionati
            </span>
          )}
          {collapsed
            ? <ChevronDown className="w-3.5 h-3.5 text-surface-500" />
            : <ChevronUp className="w-3.5 h-3.5 text-surface-500" />
          }
        </button>
        <div className="flex items-center gap-1">
          {readyDocs.length > 0 && (
            <button
              onClick={() => allSelected ? clearSelection() : selectAllDocuments()}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-surface-800 transition-colors"
            >
              {allSelected ? 'Deseleziona' : 'Seleziona tutti'}
            </button>
          )}
          <button
            onClick={fetchDocuments}
            disabled={isLoading}
            className="p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
            title="Aggiorna"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Collapsible content */}
      {!collapsed && (
        <div className="space-y-3 mt-3">
          {/* Upload zone */}
          <CompactUploadZone />

          {uploadError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-2.5 py-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {uploadError}
            </div>
          )}

          {/* Document list */}
          {isLoading && documents.length === 0 ? (
            <div className="flex justify-center py-4">
              <RefreshCw className="w-5 h-5 text-surface-600 animate-spin" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-4">
              <FileText className="w-6 h-6 text-surface-700 mx-auto mb-1.5" />
              <p className="text-xs text-surface-500">Nessun documento</p>
              <p className="text-[10px] text-surface-600 mt-0.5">Carica PDF, DOCX o TXT per iniziare</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {documents.map(doc => (
                <DocItem key={doc.id} doc={doc} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
