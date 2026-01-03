"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAutoScroll = useAutoScroll;
exports.useScrollOnChange = useScrollOnChange;
const react_1 = require("react");
/**
 * Hook for smart auto-scrolling behavior
 * - Auto-scrolls when user is at bottom
 * - Preserves scroll position when user scrolls up
 * - Shows "scroll to bottom" indicator when needed
 */
function useAutoScroll(options = {}) {
    const { threshold = 100, smooth = true } = options;
    const containerRef = (0, react_1.useRef)(null);
    const [isAtBottom, setIsAtBottom] = (0, react_1.useState)(true);
    const isUserScrollingRef = (0, react_1.useRef)(false);
    const scrollTimeoutRef = (0, react_1.useRef)(null);
    const checkIfAtBottom = (0, react_1.useCallback)(() => {
        const container = containerRef.current;
        if (!container)
            return true;
        const { scrollTop, scrollHeight, clientHeight } = container;
        return scrollHeight - scrollTop - clientHeight < threshold;
    }, [threshold]);
    const scrollToBottom = (0, react_1.useCallback)(() => {
        const container = containerRef.current;
        if (!container)
            return;
        container.scrollTo({
            top: container.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
        setIsAtBottom(true);
    }, [smooth]);
    const handleScroll = (0, react_1.useCallback)(() => {
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
    const autoScrollIfAtBottom = (0, react_1.useCallback)(() => {
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
    (0, react_1.useEffect)(() => {
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
function useScrollOnChange(containerRef, dependency, isAtBottom) {
    (0, react_1.useEffect)(() => {
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
//# sourceMappingURL=useAutoScroll.js.map