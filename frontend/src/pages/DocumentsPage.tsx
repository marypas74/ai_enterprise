import React, { useEffect, useRef } from 'react';
import { Upload, FolderOpen, FileText, Trash2, RefreshCw, CheckCircle2, Clock, AlertCircle, X, FilePen, MessageSquare } from 'lucide-react';
import { useDocumentStore, UserDocument } from '../hooks/useDocumentStore';
import { Link } from 'react-router-dom';

// ─── File icon by mime type ──────────────────────────────────────────────────
function FileIcon({ mimeType }: { mimeType: string }) {
    if (mimeType === 'application/pdf') {
        return <span className="text-red-500 font-bold text-xs px-1 py-0.5 bg-red-50 rounded border border-red-200">PDF</span>;
    }
    if (mimeType.includes('word') || mimeType.includes('docx')) {
        return <span className="text-blue-500 font-bold text-xs px-1 py-0.5 bg-blue-50 rounded border border-blue-200">DOC</span>;
    }
    return <span className="text-gray-500 font-bold text-xs px-1 py-0.5 bg-gray-50 rounded border border-gray-200">TXT</span>;
}

// ─── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: UserDocument['status'] }) {
    if (status === 'ready') {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                Pronto
            </span>
        );
    }
    if (status === 'processing') {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                <Clock className="w-3 h-3" />
                Elaborazione…
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="w-3 h-3" />
            Errore
        </span>
    );
}

// ─── Drag & Drop Upload Zone ─────────────────────────────────────────────────
function DocumentUploadZone() {
    const { uploadDocument, isUploading, uploadError } = useDocumentStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = React.useState(false);

    const handleFiles = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        for (const file of Array.from(files)) {
            uploadDocument(file);
        }
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
    };

    return (
        <div className="space-y-3">
            <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                className={`
          relative flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed cursor-pointer
          transition-all duration-200 select-none
          ${isDragging
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 scale-[1.01]'
                        : 'border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }
        `}
            >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors
          ${isDragging ? 'bg-indigo-100 dark:bg-indigo-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                    {isUploading
                        ? <RefreshCw className="w-7 h-7 text-indigo-500 animate-spin" />
                        : <Upload className="w-7 h-7 text-gray-400 dark:text-gray-500" />
                    }
                </div>
                <div className="text-center">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        {isUploading ? 'Caricamento in corso…' : 'Trascina i file qui o clicca per selezionare'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">PDF, DOCX, TXT — max 50 MB</p>
                </div>
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
            {uploadError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {uploadError}
                </div>
            )}
        </div>
    );
}

// ─── Document row ─────────────────────────────────────────────────────────────
function DocumentRow({ doc }: { doc: UserDocument }) {
    const { deleteDocument } = useDocumentStore();
    const [confirmDelete, setConfirmDelete] = React.useState(false);

    const fmt = (bytes: number) => bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(0)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

    return (
        <tr className="group border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/80 dark:hover:bg-gray-800/50 transition-colors">
            <td className="py-3 px-4">
                <div className="flex items-center gap-3">
                    <FileIcon mimeType={doc.mimeType} />
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-xs" title={doc.originalName}>
                            {doc.originalName}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {fmt(doc.size)} · {doc.status === 'ready' ? `${doc.chunksCount} chunks` : ''}
                        </p>
                    </div>
                </div>
            </td>
            <td className="py-3 px-4">
                <StatusBadge status={doc.status} />
                {doc.status === 'failed' && doc.error && (
                    <p className="text-xs text-red-500 mt-1 max-w-xs truncate" title={doc.error}>{doc.error}</p>
                )}
            </td>
            <td className="py-3 px-4 text-xs text-gray-400">
                {new Date(doc.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
            </td>
            <td className="py-3 px-4 text-right">
                {confirmDelete ? (
                    <div className="inline-flex items-center gap-1">
                        <button
                            onClick={() => deleteDocument(doc.id)}
                            className="text-xs text-red-600 font-semibold hover:underline"
                        >Elimina</button>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            className="text-xs text-gray-400 ml-2 hover:text-gray-600"
                        ><X className="w-3.5 h-3.5" /></button>
                    </div>
                ) : (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
                        title="Elimina documento"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                )}
            </td>
        </tr>
    );
}

// ─── DocumentsPage ───────────────────────────────────────────────────────────
export default function DocumentsPage() {
    const { documents, isLoading, fetchDocuments } = useDocumentStore();

    useEffect(() => {
        fetchDocuments();
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
            <div className="max-w-4xl mx-auto px-6 py-10">
                {/* Back to Chat Button */}
                <div className="mb-6">
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                    >
                        <MessageSquare className="w-4 h-4" />
                        Torna alla Chat
                    </Link>
                </div>

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg">
                            <FolderOpen className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Documenti</h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Carica file per interrogarli con la modalità <strong>Chiedi ai Documenti</strong>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={fetchDocuments}
                        disabled={isLoading}
                        className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Aggiorna lista"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* Upload zone */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 mb-6">
                    <DocumentUploadZone />
                </div>

                {/* Document list */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                    {isLoading && documents.length === 0 ? (
                        <div className="flex items-center justify-center py-16">
                            <RefreshCw className="w-6 h-6 text-gray-300 animate-spin" />
                        </div>
                    ) : documents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                                <FilePen className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                            </div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Nessun documento caricato</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Carica un PDF, DOCX o TXT per iniziare</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                                    <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Documento</th>
                                    <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stato</th>
                                    <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Data</th>
                                    <th className="py-3 px-4" />
                                </tr>
                            </thead>
                            <tbody>
                                {documents.map(doc => <DocumentRow key={doc.id} doc={doc} />)}
                            </tbody>
                        </table>
                    )}
                </div>

                {documents.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-right">
                        {documents.length} documento{documents.length !== 1 ? 'i' : ''}
                    </p>
                )}
            </div>
        </div>
    );
}
