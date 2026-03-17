import React from 'react';
import type { EditorMode } from './usePDFEditor';

interface PDFToolbarProps {
  currentPage: number;
  totalPages: number;
  zoom: number;
  mode: EditorMode;
  isDirty: boolean;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onModeChange: (mode: EditorMode) => void;
  onSave: () => void;
}

export const PDFToolbar: React.FC<PDFToolbarProps> = ({
  currentPage,
  totalPages,
  zoom,
  mode,
  isDirty,
  onPageChange,
  onZoomChange,
  onModeChange,
  onSave,
}) => {
  return (
    <div className="flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-800 rounded-t-lg border-b border-gray-200 dark:border-gray-700 flex-wrap">
      {/* Page Navigation */}
      <div className="flex items-center gap-1">
        <button
          className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ←
        </button>
        <span className="text-sm px-2">
          {currentPage} / {totalPages}
        </span>
        <button
          className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          →
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <button
          className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
          onClick={() => onZoomChange(zoom - 0.25)}
        >
          −
        </button>
        <span className="text-sm px-1 min-w-[3rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
          onClick={() => onZoomChange(zoom + 0.25)}
        >
          +
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

      {/* Mode Buttons */}
      <div className="flex items-center gap-1">
        {(['select', 'text'] as EditorMode[]).map(m => (
          <button
            key={m}
            className={`px-3 py-1 rounded text-sm capitalize ${
              mode === m
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
            onClick={() => onModeChange(m)}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Save */}
      <button
        className={`px-4 py-1 rounded text-sm font-medium ${
          isDirty
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
        disabled={!isDirty}
        onClick={onSave}
      >
        Save
      </button>
    </div>
  );
};
