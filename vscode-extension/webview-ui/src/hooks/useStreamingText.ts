import { useState, useCallback, useRef } from 'react';

interface StreamingOptions {
  /** Characters per chunk (1-5 for realistic effect) */
  chunkSize?: number;
  /** Delay between chunks in ms */
  delayMs?: number;
  /** Randomize delay for natural feel */
  randomizeDelay?: boolean;
  /** Callback when streaming completes */
  onComplete?: () => void;
}

interface UseStreamingTextReturn {
  streamedText: string;
  isStreaming: boolean;
  startStreaming: (text: string) => void;
  stopStreaming: () => void;
  appendChunk: (chunk: string) => void;
}

/**
 * Hook for simulating streaming text like Claude Code
 * Supports both simulated streaming and real SSE chunks
 */
export function useStreamingText(options: StreamingOptions = {}): UseStreamingTextReturn {
  const {
    chunkSize = 3,
    delayMs = 20,
    randomizeDelay = true,
    onComplete
  } = options;

  const [streamedText, setStreamedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  const stopStreaming = useCallback(() => {
    abortRef.current = true;
    setIsStreaming(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startStreaming = useCallback((fullText: string) => {
    abortRef.current = false;
    setIsStreaming(true);
    setStreamedText('');

    let currentIndex = 0;

    const streamNextChunk = () => {
      if (abortRef.current || currentIndex >= fullText.length) {
        setIsStreaming(false);
        if (!abortRef.current) {
          onComplete?.();
        }
        return;
      }

      // Calculate chunk size with some variation
      const variableChunkSize = randomizeDelay
        ? chunkSize + Math.floor(Math.random() * 3) - 1
        : chunkSize;

      const endIndex = Math.min(currentIndex + variableChunkSize, fullText.length);
      const chunk = fullText.slice(currentIndex, endIndex);

      setStreamedText(prev => prev + chunk);
      currentIndex = endIndex;

      // Calculate delay with variation for natural feel
      const variableDelay = randomizeDelay
        ? delayMs + Math.floor(Math.random() * delayMs * 0.5)
        : delayMs;

      // Pause longer at punctuation for natural reading
      const lastChar = chunk[chunk.length - 1];
      const punctuationDelay = ['.', '!', '?', '\n'].includes(lastChar) ? 150 : 0;

      timeoutRef.current = window.setTimeout(
        streamNextChunk,
        variableDelay + punctuationDelay
      );
    };

    streamNextChunk();
  }, [chunkSize, delayMs, randomizeDelay, onComplete]);

  // For real SSE streaming - append chunks directly
  const appendChunk = useCallback((chunk: string) => {
    setIsStreaming(true);
    setStreamedText(prev => prev + chunk);
  }, []);

  return {
    streamedText,
    isStreaming,
    startStreaming,
    stopStreaming,
    appendChunk
  };
}

/**
 * Async generator for streaming text (alternative approach)
 */
export async function* streamText(
  text: string,
  chunkSize = 3,
  delayMs = 20
): AsyncGenerator<string, void, unknown> {
  let currentIndex = 0;

  while (currentIndex < text.length) {
    const endIndex = Math.min(currentIndex + chunkSize, text.length);
    const chunk = text.slice(currentIndex, endIndex);

    yield chunk;
    currentIndex = endIndex;

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
