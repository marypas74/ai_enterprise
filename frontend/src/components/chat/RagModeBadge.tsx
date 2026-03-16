import { Library, Lightbulb, X } from 'lucide-react';
import { useDocumentStore } from '../../hooks/useDocumentStore';

/**
 * Compact badge shown in chat header when RAG or Brainstorm mode is active.
 */
export function RagModeBadge() {
    const { chatMode, setChatMode, selectedDocumentIds, documents } = useDocumentStore();

    if (chatMode === 'rag') {
        const readyDocs = documents.filter(d => d.status === 'ready');
        const selectedCount = selectedDocumentIds.length;

        return (
            <div
                id="rag-mode-badge"
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50
                     border border-indigo-200 dark:border-indigo-800 rounded-full text-xs font-medium
                     text-indigo-700 dark:text-indigo-300 animate-fade-in"
            >
                <Library className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                    Modalità Documenti
                    {readyDocs.length > 0 && (
                        <span className="ml-1 text-indigo-500 dark:text-indigo-400">
                            · {selectedCount > 0 ? `${selectedCount} selezionato${selectedCount > 1 ? 'i' : ''}` : `${readyDocs.length} disponibile${readyDocs.length > 1 ? 'i' : ''}`}
                        </span>
                    )}
                </span>
                <button
                    onClick={() => setChatMode('free')}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                    title="Torna a Chat Libera"
                    aria-label="Disattiva modalità documenti"
                >
                    <X className="w-3 h-3" />
                </button>
            </div>
        );
    }

    if (chatMode === 'brainstorm') {
        return (
            <div
                id="brainstorm-mode-badge"
                className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/50
                     border border-amber-200 dark:border-amber-800 rounded-full text-xs font-medium
                     text-amber-700 dark:text-amber-300 animate-fade-in"
            >
                <Lightbulb className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Modalità Brainstorming</span>
                <button
                    onClick={() => setChatMode('free')}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
                    title="Torna a Chat Libera"
                    aria-label="Disattiva modalità brainstorming"
                >
                    <X className="w-3 h-3" />
                </button>
            </div>
        );
    }

    return null;
}