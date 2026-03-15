import { useCallback, useEffect, useRef } from 'react';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (!api) { api = acquireVsCodeApi(); }
  return api;
}

export function useVsCodeMessage<T>(handler: (message: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      handlerRef.current(event.data as T);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}

export function usePostMessage(): (message: unknown) => void {
  return useCallback((message: unknown) => {
    getVsCodeApi().postMessage(message);
  }, []);
}
