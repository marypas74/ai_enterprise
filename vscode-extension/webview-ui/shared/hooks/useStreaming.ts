import { useState, useCallback, useRef } from 'react';

interface StreamState {
  isStreaming: boolean;
  content: string;
  error: string | null;
}

export function useStreaming() {
  const [state, setState] = useState<StreamState>({
    isStreaming: false,
    content: '',
    error: null,
  });
  const contentRef = useRef('');

  const startStream = useCallback(() => {
    contentRef.current = '';
    setState({ isStreaming: true, content: '', error: null });
  }, []);

  const appendChunk = useCallback((text: string) => {
    contentRef.current += text;
    setState((prev) => ({ ...prev, content: contentRef.current }));
  }, []);

  const endStream = useCallback(() => {
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, isStreaming: false, error }));
  }, []);

  return { ...state, startStream, appendChunk, endStream, setError };
}
