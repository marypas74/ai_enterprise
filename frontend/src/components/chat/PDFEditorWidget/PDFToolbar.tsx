import React from 'react';
import type { EditorMode } from './usePDFEditor';
import { Undo2, Redo2 } from 'lucide-react';

interface PDFToolbarProps {
  currentPage: number;
  totalPages: number;
  zoom: number;
  mode: EditorMode;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onModeChange: (mode: EditorMode) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface ModeGroup {
  label: string;
  modes: { mode: EditorMode; label: string }[];
}

const MODE_GROUPS: ModeGroup[] = [
  {
    label: 'Base',
    modes: [
      { mode: 'select', label: 'Select' },
      { mode: 'text', label: 'Text' },
      { mode: 'image', label: 'Image' },
    ],
  },
  {
    label: 'Annotazioni',
    modes: [
      { mode: 'highlight', label: 'Highlight' },
      { mode: 'note', label: 'Note' },
      { mode: 'draw', label: 'Draw' },
      { mode: 'stamp', label: 'Stamp' },
    ],
  },
  {
    label: 'Form/Sicurezza',
    modes: [
      { mode: 'form', label: 'Form' },
      { mode: 'redact', label: 'Redact' },
      { mode: 'lock', label: 'Lock' },
    ],
  },
  {
    label: 'Firma',
    modes: [
      { mode: 'sign', label: 'Sign' },
    ],
  },
];

export const PDFToolbar: React.FC<PDFToolbarProps> = ({
  currentPage,
  totalPages,
  zoom,
  mode,
  isDirty,
  canUndo,
  canRedo,
  onPageChange,
  onZoomChange,
  onModeChange,
  onSave,
  onUndo,
  onRedo,
}) => {
  return (
    <div className="flex items-center gap-1.5 p-2 bg-gray-100 dark:bg-gray-800 rounded-t-lg border-b border-gray-200 dark:border-gray-700 flex-wrap">
      {/* Page Navigation */}
      <div className="flex items-center gap-1">
        <button
          className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-xs"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          &larr;
        </button>
        <span className="text-xs px-1.5">
          {currentPage} / {totalPages}
        </span>
        <button
          className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-xs"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          &rarr;
        </button>
      </div>

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <button
          className="px-1.5 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs"
          onClick={() => onZoomChange(zoom - 0.25)}
        >
          &minus;
        </button>
        <span className="text-xs px-1 min-w-[2.5rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="px-1.5 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs"
          onClick={() => onZoomChange(zoom + 0.25)}
        >
          +
        </button>
      </div>

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />

      {/* Mode Buttons — grouped */}
      {MODE_GROUPS.map((group, gi) => (
        <React.Fragment key={group.label}>
          {gi > 0 && <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />}
          <div className="flex items-center gap-0.5">
            {group.modes.map(m => (
              <button
                key={m.mode}
                className={`px-2 py-1 rounded text-xs ${
                  mode === m.mode
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
                onClick={() => onModeChange(m.mode)}
                title={m.label}
              >
                {m.label}
              </button>
            ))}
          </div>
        </React.Fragment>
      ))}

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <button
          className="p-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-30"
          disabled={!canUndo}
          onClick={onUndo}
          title="Annulla"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-30"
          disabled={!canRedo}
          onClick={onRedo}
          title="Ripeti"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1" />

      {/* Save */}
      <button
        className={`px-3 py-1 rounded text-xs font-medium ${
          isDirty
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
        disabled={!isDirty}
        onClick={onSave}
      >
        Salva
      </button>
    </div>
  );
};
