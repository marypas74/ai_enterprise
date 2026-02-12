/**
 * Chunking Service
 * Splits documents into semantic chunks for RAG and efficient context injection
 */

export interface ChunkOptions {
    /** Maximum characters per chunk (default: 1000) */
    chunkSize?: number;
    /** Overlap between chunks in characters (default: 200) */
    overlap?: number;
    /** Minimum chunk size to keep (default: 50) */
    minChunkSize?: number;
}

export interface DocumentChunk {
    index: number;
    content: string;
    charCount: number;
    metadata: {
        startOffset: number;
        endOffset: number;
        sectionTitle?: string;
    };
}

/**
 * Split text into semantic chunks with overlap.
 * Tries to split on paragraph/section boundaries first, then sentence boundaries.
 */
export function chunkDocument(
    text: string,
    options: ChunkOptions = {}
): DocumentChunk[] {
    const {
        chunkSize = 1000,
        overlap = 200,
        minChunkSize = 50,
    } = options;

    if (!text || text.trim().length === 0) {
        return [];
    }

    // If text is small enough, return as single chunk
    if (text.length <= chunkSize) {
        const sectionTitle = detectSectionTitle(text);
        return [{
            index: 0,
            content: text,
            charCount: text.length,
            metadata: {
                startOffset: 0,
                endOffset: text.length,
                sectionTitle: sectionTitle || undefined,
            },
        }];
    }

    const chunks: DocumentChunk[] = [];
    let currentPos = 0;
    let chunkIndex = 0;

    while (currentPos < text.length) {
        let endPos = Math.min(currentPos + chunkSize, text.length);

        // If we're not at the end, try to find a good break point
        if (endPos < text.length) {
            endPos = findBreakPoint(text, currentPos, endPos);
        }

        const content = text.substring(currentPos, endPos).trim();

        if (content.length >= minChunkSize) {
            // Try to detect section title from the beginning of the chunk
            const sectionTitle = detectSectionTitle(content);

            chunks.push({
                index: chunkIndex,
                content,
                charCount: content.length,
                metadata: {
                    startOffset: currentPos,
                    endOffset: endPos,
                    sectionTitle: sectionTitle || undefined,
                },
            });
            chunkIndex++;
        }

        // Move forward by (chunkSize - overlap), ensuring we make progress
        const step = Math.max(endPos - currentPos - overlap, minChunkSize);
        currentPos = currentPos + step;
    }

    return chunks;
}

/**
 * Find the best break point near the target position.
 * Priority: paragraph break > sentence end > word boundary
 */
function findBreakPoint(text: string, start: number, target: number): number {
    const lookback = Math.min(200, target - start);
    const searchRegion = text.substring(target - lookback, target);

    // 1. Try to break at paragraph boundary (double newline)
    const paragraphBreak = searchRegion.lastIndexOf('\n\n');
    if (paragraphBreak !== -1) {
        return target - lookback + paragraphBreak + 2;
    }

    // 2. Try to break at single newline
    const newlineBreak = searchRegion.lastIndexOf('\n');
    if (newlineBreak !== -1) {
        return target - lookback + newlineBreak + 1;
    }

    // 3. Try to break at sentence end (. ! ?)
    const sentenceEnd = Math.max(
        searchRegion.lastIndexOf('. '),
        searchRegion.lastIndexOf('! '),
        searchRegion.lastIndexOf('? ')
    );
    if (sentenceEnd !== -1) {
        return target - lookback + sentenceEnd + 2;
    }

    // 4. Try to break at word boundary (space)
    const spaceBreak = searchRegion.lastIndexOf(' ');
    if (spaceBreak !== -1) {
        return target - lookback + spaceBreak + 1;
    }

    // 5. Fall back to target position
    return target;
}

/**
 * Detect if a chunk starts with a section title (heading-like pattern)
 */
function detectSectionTitle(content: string): string | null {
    const firstLine = content.split('\n')[0]?.trim();
    if (!firstLine) return null;

    // Markdown headings: # Title, ## Title, etc.
    const mdMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
    if (mdMatch) return mdMatch[1];

    // ALL CAPS titles (common in PDFs)
    if (firstLine.length < 100 && firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine)) {
        return firstLine;
    }

    // Numbered sections: 1. Title, 1.2 Title, etc.
    const numberedMatch = firstLine.match(/^\d+(\.\d+)*\.?\s+(.+)$/);
    if (numberedMatch && firstLine.length < 100) return numberedMatch[2];

    return null;
}

/**
 * Select the most relevant chunks for a given query using simple keyword matching.
 * This is the Layer 2 approach (no vector DB needed).
 */
export function selectRelevantChunks(
    chunks: DocumentChunk[],
    query: string,
    maxChunks: number = 5
): DocumentChunk[] {
    if (chunks.length <= maxChunks) return chunks;

    // Tokenize query into keywords (lowercased, > 2 chars)
    const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2)
        .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(w => w.length > 0);

    if (keywords.length === 0) {
        // No meaningful keywords → return first N chunks
        return chunks.slice(0, maxChunks);
    }

    // Score each chunk by keyword frequency
    const scored = chunks.map(chunk => {
        const lowerContent = chunk.content.toLowerCase();
        let score = 0;

        for (const keyword of keywords) {
            // Count occurrences
            let idx = 0;
            let count = 0;
            while ((idx = lowerContent.indexOf(keyword, idx)) !== -1) {
                count++;
                idx += keyword.length;
            }
            score += count;
        }

        return { chunk, score };
    });

    // Sort by score (descending), then by index (ascending) for tie-breaking
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.chunk.index - b.chunk.index;
    });

    // Take top chunks and re-sort by document order
    const selected = scored
        .slice(0, maxChunks)
        .sort((a, b) => a.chunk.index - b.chunk.index)
        .map(s => s.chunk);

    return selected;
}
