import { useState, useCallback, useRef } from 'react';

export type EditorMode =
  | 'select'
  | 'text'
  | 'image'
  | 'highlight'
  | 'note'
  | 'draw'
  | 'stamp'
  | 'form'
  | 'redact'
  | 'lock'
  | 'sign';

/** Snapshot for undo/redo — stores the attachment state before an operation */
interface EditorSnapshot {
  label: string;
  timestamp: number;
}

const MAX_UNDO_STACK = 50;

interface PDFEditorState {
  currentPage: number;
  totalPages: number;
  zoom: number;
  mode: EditorMode;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  showSignatureDialog: boolean;
}

export function usePDFEditor() {
  const [state, setState] = useState<PDFEditorState>({
    currentPage: 1,
    totalPages: 0,
    zoom: 1.0,
    mode: 'select',
    isDirty: false,
    isLoading: true,
    error: null,
    canUndo: false,
    canRedo: false,
    showSignatureDialog: false,
  });

  // Server-side snapshot stacks (store operation labels for tracking)
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);

  const setCurrentPage = useCallback((page: number) => {
    setState(prev => ({
      ...prev,
      currentPage: Math.max(1, Math.min(page, prev.totalPages)),
    }));
  }, []);

  const setTotalPages = useCallback((total: number) => {
    setState(prev => ({ ...prev, totalPages: total }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setState(prev => ({
      ...prev,
      zoom: Math.max(0.25, Math.min(zoom, 4.0)),
    }));
  }, []);

  const setMode = useCallback((mode: EditorMode) => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    setState(prev => ({ ...prev, isDirty: dirty }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error, isLoading: false }));
  }, []);

  const setShowSignatureDialog = useCallback((show: boolean) => {
    setState(prev => ({ ...prev, showSignatureDialog: show }));
  }, []);

  /**
   * Push an undo snapshot before performing an operation.
   * The snapshot label describes what operation is about to happen.
   */
  const pushUndo = useCallback((label: string) => {
    const snapshot: EditorSnapshot = { label, timestamp: Date.now() };
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO_STACK - 1)),
      snapshot,
    ];
    // Clear redo stack when a new operation is performed
    redoStackRef.current = [];
    setState(prev => ({
      ...prev,
      canUndo: true,
      canRedo: false,
      isDirty: true,
    }));
  }, []);

  /**
   * Undo the last operation by calling the server-side undo endpoint.
   * Returns the snapshot label of the undone operation, or null if nothing to undo.
   */
  const undo = useCallback((): string | null => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return null;

    const snapshot = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, snapshot];

    setState(prev => ({
      ...prev,
      canUndo: undoStackRef.current.length > 0,
      canRedo: true,
    }));

    return snapshot.label;
  }, []);

  /**
   * Redo the last undone operation.
   * Returns the snapshot label, or null if nothing to redo.
   */
  const redo = useCallback((): string | null => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return null;

    const snapshot = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, snapshot];

    setState(prev => ({
      ...prev,
      canUndo: true,
      canRedo: redoStackRef.current.length > 0,
    }));

    return snapshot.label;
  }, []);

  /** Clear both stacks (e.g., after save) */
  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setState(prev => ({
      ...prev,
      canUndo: false,
      canRedo: false,
    }));
  }, []);

  return {
    ...state,
    setCurrentPage,
    setTotalPages,
    setZoom,
    setMode,
    setDirty,
    setLoading,
    setError,
    setShowSignatureDialog,
    pushUndo,
    undo,
    redo,
    clearHistory,
  };
}
