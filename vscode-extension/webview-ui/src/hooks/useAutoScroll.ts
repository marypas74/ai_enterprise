import { useRef, useCallback, useEffect, useState } from 'react';

interface UseAutoScrollOptions {
  /** Threshold in pixels to consider "at bottom" */
  threshold?: number;
  /** Smooth scroll animation */
  smooth?: boolean;
}

interface UseAutoScrollReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  handleScroll: () => void;
}

/**
 * Hook for smart auto-scrolling behavior
 * - Auto-scrolls when user is at bottom
 * - Preserves scroll position when user scrolls up
 * - Shows "scroll to bottom" indicator when needed
 */
export function useAutoScroll(options: UseAutoScrollOptions = {}): UseAutoScrollReturn {
  const { threshold = 100, smooth = true } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });

    setIsAtBottom(true);
  }, [smooth]);

  const handleScroll = useCallback(() => {
    // Mark as user-initiated scroll
    isUserScrollingRef.current = true;

    // Clear previous timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Debounce the check
    scrollTimeoutRef.current = window.setTimeout(() => {
      const atBottom = checkIfAtBottom();
      setIsAtBottom(atBottom);
      isUserScrollingRef.current = false;
    }, 100);
  }, [checkIfAtBottom]);

  // Auto-scroll when content changes (if at bottom)
  const autoScrollIfAtBottom = useCallback(() => {
    if (isAtBottom && !isUserScrollingRef.current) {
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, [isAtBottom]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return {
    containerRef,
    isAtBottom,
    scrollToBottom,
    handleScroll
  };
}

/**
 * Hook to trigger auto-scroll on dependency changes
 */
export function useScrollOnChange(
  containerRef: React.RefObject<HTMLDivElement>,
  dependency: any,
  isAtBottom: boolean
) {
  useEffect(() => {
    if (isAtBottom && containerRef.current) {
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, [dependency, isAtBottom, containerRef]);
}
