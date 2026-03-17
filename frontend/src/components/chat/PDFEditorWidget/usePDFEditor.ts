import { useState, useCallback } from 'react';

export type EditorMode = 'select' | 'text' | 'image';

interface PDFEditorState {
  currentPage: number;
  totalPages: number;
  zoom: number;
  mode: EditorMode;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
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
  });

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

  return {
    ...state,
    setCurrentPage,
    setTotalPages,
    setZoom,
    setMode,
    setDirty,
    setLoading,
    setError,
  };
}
