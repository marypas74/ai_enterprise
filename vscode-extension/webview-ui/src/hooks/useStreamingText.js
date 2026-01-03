"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useStreamingText = useStreamingText;
exports.streamText = streamText;
const react_1 = require("react");
/**
 * Hook for simulating streaming text like Claude Code
 * Supports both simulated streaming and real SSE chunks
 */
function useStreamingText(options = {}) {
    const { chunkSize = 3, delayMs = 20, randomizeDelay = true, onComplete } = options;
    const [streamedText, setStreamedText] = (0, react_1.useState)('');
    const [isStreaming, setIsStreaming] = (0, react_1.useState)(false);
    const abortRef = (0, react_1.useRef)(false);
    const timeoutRef = (0, react_1.useRef)(null);
    const stopStreaming = (0, react_1.useCallback)(() => {
        abortRef.current = true;
        setIsStreaming(false);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);
    const startStreaming = (0, react_1.useCallback)((fullText) => {
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
            timeoutRef.current = window.setTimeout(streamNextChunk, variableDelay + punctuationDelay);
        };
        streamNextChunk();
    }, [chunkSize, delayMs, randomizeDelay, onComplete]);
    // For real SSE streaming - append chunks directly
    const appendChunk = (0, react_1.useCallback)((chunk) => {
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
async function* streamText(text, chunkSize = 3, delayMs = 20) {
    let currentIndex = 0;
    while (currentIndex < text.length) {
        const endIndex = Math.min(currentIndex + chunkSize, text.length);
        const chunk = text.slice(currentIndex, endIndex);
        yield chunk;
        currentIndex = endIndex;
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
}
//# sourceMappingURL=useStreamingText.js.map